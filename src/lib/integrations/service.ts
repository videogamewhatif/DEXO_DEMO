import "server-only";
import { serverEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { withPrivilegedDb } from "@/lib/db/privileged";
import { withUserDb } from "@/lib/db/user-db";
import type { Queryable, SessionIdentity } from "@/lib/db/types";
import { assertPermission } from "@/lib/authz/server";
import { pkceChallengeS256, randomToken } from "@/lib/security/crypto";
import { safeErrorMessage } from "@/lib/security/redact";
import type { Connector, OAuthTokens, ProviderAccountInfo } from "./contract";
import { ProviderError } from "./errors";
import { createProviderHttp, type FetchLike } from "./http";
import { assertConsumed, consumeOAuthState, createOAuthState } from "./oauth-state";
import { deleteCredentials, loadCredentials, saveCredentials } from "./credentials";
import { getConnector } from "./registry";

/**
 * Ciclo de vida de conexiones. Toda operación verifica primero sesión y permiso
 * con withUserDb; solo después usa acceso privilegiado para credenciales.
 */

let fetchOverride: FetchLike | undefined;
/** Solo pruebas: sustituye fetch para simular respuestas del proveedor. */
export function __setProviderFetchForTests(f: FetchLike | undefined) {
  fetchOverride = f;
}

export function providerHttp(connector: Connector) {
  return createProviderHttp({ provider: connector.descriptor.id, allowedHosts: connector.allowedHosts, fetchImpl: fetchOverride });
}

export function redirectUriFor(provider: string): string {
  return new URL(`/api/integrations/${provider}/callback`, serverEnv().APP_URL).toString();
}

function requireConnector(provider: string): Connector {
  const c = getConnector(provider);
  if (!c) throw new AppError("validation", "Integración desconocida.");
  const status = c.configStatus(serverEnv());
  if (!status.configured) {
    throw new AppError("integration_not_configured", `La integración no está configurada en el servidor (faltan: ${status.missing.join(", ")}).`);
  }
  return c;
}

async function audit(db: Queryable, orgId: string | null, actor: string | null, action: string, targetType: string, targetId: string, metadata: object) {
  await db.query("select nexo.write_audit($1, $2, 'user', $3, $4, $5, $6::jsonb)", [orgId, actor, action, targetType, targetId, JSON.stringify(metadata)]);
}

/** Paso 1: crea el state y devuelve la URL de autorización del proveedor. */
export async function startOAuth(identity: SessionIdentity, organizationId: string, provider: string): Promise<string> {
  const connector = requireConnector(provider);
  await assertPermission(identity, organizationId, "integrations.manage");
  const env = serverEnv();
  const verifier = connector.usesPkce(env) ? randomToken(48) : undefined;
  const state = await withPrivilegedDb((db) =>
    createOAuthState(db, { organizationId, userId: identity.userId, provider, pkceVerifier: verifier }),
  );
  return connector.buildAuthorizationUrl(env, {
    state,
    redirectUri: redirectUriFor(provider),
    codeChallenge: verifier ? pkceChallengeS256(verifier) : undefined,
  });
}

export async function upsertAccounts(db: Queryable, organizationId: string, integrationId: string, provider: string, accounts: ProviderAccountInfo[]) {
  for (const a of accounts) {
    await db.query(
      `insert into nexo.provider_accounts (organization_id, integration_id, provider, account_type, external_id, name, currency, timezone, external_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (organization_id, provider, external_id) do update set
         integration_id = excluded.integration_id,
         name = excluded.name,
         currency = coalesce(excluded.currency, nexo.provider_accounts.currency),
         timezone = coalesce(excluded.timezone, nexo.provider_accounts.timezone),
         external_status = excluded.external_status`,
      [organizationId, integrationId, provider, a.accountType, a.externalId, a.name.slice(0, 300), a.currency, a.timezone, a.externalStatus],
    );
  }
}

/** Paso 2: callback. Valida state, permisos actuales, intercambia el código y guarda credenciales cifradas. */
export async function completeOAuth(
  identity: SessionIdentity,
  provider: string,
  params: URLSearchParams,
): Promise<{ organizationId: string; integrationId: string; accounts: number }> {
  const connector = requireConnector(provider);
  const state = params.get("state") ?? "";
  // El state se consume siempre (incluso si el usuario canceló) para que no pueda reutilizarse.
  // La transacción se confirma antes de validar: un state inválido queda quemado.
  const consumed = assertConsumed(await withPrivilegedDb((db) => consumeOAuthState(db, { state, provider, userId: identity.userId })));

  if (params.get("error")) {
    throw new AppError("oauth_denied", "La autorización fue cancelada o rechazada en el proveedor.");
  }
  const code = params.get("code");
  if (!code || code.length > 2048) throw new AppError("oauth_state_invalid", "Falta el código de autorización.");

  // Los permisos se vuelven a comprobar al completar (pudieron cambiar durante el flujo).
  await assertPermission(identity, consumed.organizationId, "integrations.manage");

  const env = serverEnv();
  const http = providerHttp(connector);
  let tokens: OAuthTokens;
  try {
    tokens = await connector.exchangeCode(env, http, { code, redirectUri: redirectUriFor(provider), codeVerifier: consumed.pkceVerifier });
  } catch (err) {
    throw new AppError("oauth_exchange_failed", `No se pudo completar la conexión: ${safeErrorMessage(err, 300)}`);
  }

  const integrationId = await withPrivilegedDb(async (db) => {
    const existing = await db.query<{ id: string }>(
      `select id from nexo.integrations where organization_id = $1 and provider = $2 and status <> 'disconnected' for update`,
      [consumed.organizationId, provider],
    );
    let id = existing.rows[0]?.id;
    if (id) {
      await db.query(
        `update nexo.integrations set status = 'connected', external_user_label = $2, granted_scopes = $3, connected_by = $4,
           connected_at = now(), token_expires_at = $5, last_error_code = null, last_error_message = null, last_validated_at = now()
         where id = $1`,
        [id, tokens.externalUserLabel ?? null, tokens.scopes, identity.userId, tokens.expiresAt ?? null],
      );
    } else {
      const ins = await db.query<{ id: string }>(
        `insert into nexo.integrations (organization_id, provider, status, external_user_label, granted_scopes, connected_by, token_expires_at, last_validated_at)
         values ($1, $2, 'connected', $3, $4, $5, $6, now()) returning id`,
        [consumed.organizationId, provider, tokens.externalUserLabel ?? null, tokens.scopes, identity.userId, tokens.expiresAt ?? null],
      );
      id = ins.rows[0]!.id;
    }
    await saveCredentials(db, { integrationId: id, organizationId: consumed.organizationId, tokens });
    await audit(db, consumed.organizationId, identity.userId, "integration.connected", "integration", id, { provider, scopes: tokens.scopes });
    return id;
  });

  let accounts: ProviderAccountInfo[] = [];
  try {
    accounts = await connector.listAccounts(env, http, tokens);
    await withPrivilegedDb((db) => upsertAccounts(db, consumed.organizationId, integrationId, provider, accounts));
  } catch (err) {
    await withPrivilegedDb((db) =>
      db.query(`update nexo.integrations set last_error_code = 'list_accounts_failed', last_error_message = $2 where id = $1`, [
        integrationId,
        safeErrorMessage(err),
      ]),
    );
  }
  return { organizationId: consumed.organizationId, integrationId, accounts: accounts.length };
}

async function loadIntegration(identity: SessionIdentity, integrationId: string) {
  // Lectura bajo RLS: si el usuario no puede ver la integración, no existe para él.
  const row = await withUserDb(identity, async (db) => {
    const { rows } = await db.query<{ id: string; organization_id: string; provider: string; status: string }>(
      "select id, organization_id, provider, status from nexo.integrations where id = $1",
      [integrationId],
    );
    return rows[0];
  });
  if (!row) throw new AppError("forbidden");
  await assertPermission(identity, row.organization_id, "integrations.manage");
  return row;
}

export async function refreshAccountList(identity: SessionIdentity, integrationId: string): Promise<number> {
  const integ = await loadIntegration(identity, integrationId);
  if (integ.status !== "connected") throw new AppError("integration_not_connected");
  const connector = requireConnector(integ.provider);
  const tokens = await withPrivilegedDb((db) => getUsableTokens(db, connector, integ));
  const accounts = await connector.listAccounts(serverEnv(), providerHttp(connector), tokens);
  await withPrivilegedDb(async (db) => {
    await upsertAccounts(db, integ.organization_id, integ.id, integ.provider, accounts);
    await audit(db, integ.organization_id, identity.userId, "integration.accounts_refreshed", "integration", integ.id, { count: accounts.length });
  });
  return accounts.length;
}

/** Desconecta: intenta revocar en el proveedor, elimina credenciales y detiene sincronizaciones. */
export async function disconnectIntegration(identity: SessionIdentity, integrationId: string): Promise<{ revoked: boolean }> {
  const integ = await loadIntegration(identity, integrationId);
  const connector = getConnector(integ.provider);
  let revoked = false;
  let revokeError: string | null = null;
  const tokens = await withPrivilegedDb((db) => loadCredentials(db, integ.id, integ.organization_id)).catch(() => null);
  if (tokens && connector?.revoke && connector.configStatus(serverEnv()).configured) {
    try {
      await connector.revoke(serverEnv(), providerHttp(connector), tokens);
      revoked = true;
    } catch (err) {
      revokeError = safeErrorMessage(err, 200);
    }
  }
  await withPrivilegedDb(async (db) => {
    await deleteCredentials(db, integ.id);
    await db.query(
      `update nexo.integrations set status = 'disconnected', disconnected_at = now(), token_expires_at = null,
         last_error_code = null, last_error_message = null where id = $1`,
      [integ.id],
    );
    await db.query(`update nexo.provider_accounts set is_selected = false where integration_id = $1`, [integ.id]);
    await db.query(
      `update nexo.sync_jobs set status = 'cancelled', finished_at = now(), error_code = 'integration_disconnected'
        where status = 'pending' and provider_account_id in (select id from nexo.provider_accounts where integration_id = $1)`,
      [integ.id],
    );
    await audit(db, integ.organization_id, identity.userId, "integration.disconnected", "integration", integ.id, {
      provider: integ.provider,
      revoked_at_provider: revoked,
      revoke_error: revokeError,
    });
  });
  return { revoked };
}

/**
 * Devuelve tokens utilizables: renueva si el proveedor lo permite; si no, exige reconexión.
 * Lanza ProviderError("auth") cuando no hay credenciales o están caducadas.
 */
export async function getUsableTokens(
  db: Queryable,
  connector: Connector,
  integ: { id: string; organization_id: string },
): Promise<OAuthTokens> {
  const tokens = await loadCredentials(db, integ.id, integ.organization_id);
  if (!tokens) throw new ProviderError("auth", connector.descriptor.id, "No hay credenciales almacenadas (integración desconectada).");
  const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : undefined;
  const expiringSoon = expiresAt !== undefined && expiresAt - Date.now() < 2 * 60_000;
  if (!expiringSoon) return tokens;
  if (connector.refreshTokens && tokens.refreshToken) {
    const refreshed = await connector.refreshTokens(serverEnv(), providerHttp(connector), tokens);
    await saveCredentials(db, { integrationId: integ.id, organizationId: integ.organization_id, tokens: refreshed });
    await db.query(`update nexo.integrations set token_expires_at = $2 where id = $1`, [integ.id, refreshed.expiresAt ?? null]);
    return refreshed;
  }
  throw new ProviderError("auth", connector.descriptor.id, "El token caducó y este proveedor no permite renovarlo sin el usuario. Reconecta la integración.");
}

export async function markIntegrationNeedsReauth(db: Queryable, integrationId: string, err: unknown) {
  await db.query(
    `update nexo.integrations set status = 'needs_reauth', last_error_code = $2, last_error_message = $3 where id = $1 and status = 'connected'`,
    [integrationId, err instanceof ProviderError ? err.code : "auth", safeErrorMessage(err)],
  );
}
