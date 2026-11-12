import "server-only";
import { serverEnv } from "@/config/env";
import { decryptString, encryptString, parseKeyRing, type KeyRing } from "@/lib/security/crypto";
import type { Queryable } from "@/lib/db/types";
import type { OAuthTokens } from "./contract";

let ring: KeyRing | null = null;
export function keyRing(): KeyRing {
  if (!ring) {
    const env = serverEnv();
    ring = parseKeyRing(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID);
  }
  return ring;
}
export function resetKeyRingCache() {
  ring = null;
}

const aad = (integrationId: string, organizationId: string) => `integration:${integrationId}:org:${organizationId}`;

export async function saveCredentials(db: Queryable, p: { integrationId: string; organizationId: string; tokens: OAuthTokens }) {
  const k = keyRing();
  const ciphertext = encryptString(k, JSON.stringify(p.tokens), aad(p.integrationId, p.organizationId));
  await db.query(
    `insert into nexo_private.integration_credentials (integration_id, organization_id, key_id, ciphertext)
     values ($1, $2, $3, $4)
     on conflict (integration_id) do update set key_id = excluded.key_id, ciphertext = excluded.ciphertext, updated_at = now()`,
    [p.integrationId, p.organizationId, k.activeKeyId, ciphertext],
  );
}

export async function loadCredentials(db: Queryable, integrationId: string, organizationId: string): Promise<OAuthTokens | null> {
  const { rows } = await db.query<{ ciphertext: string; organization_id: string }>(
    `select ciphertext, organization_id from nexo_private.integration_credentials where integration_id = $1`,
    [integrationId],
  );
  const row = rows[0];
  if (!row || row.organization_id !== organizationId) return null;
  return JSON.parse(decryptString(keyRing(), row.ciphertext, aad(integrationId, organizationId))) as OAuthTokens;
}

export async function deleteCredentials(db: Queryable, integrationId: string) {
  await db.query(`delete from nexo_private.integration_credentials where integration_id = $1`, [integrationId]);
}

/** Recifra todas las credenciales con la clave activa (rotación). */
export async function reencryptAll(db: Queryable): Promise<number> {
  const k = keyRing();
  const { rows } = await db.query<{ integration_id: string; organization_id: string; ciphertext: string; key_id: string }>(
    `select integration_id, organization_id, ciphertext, key_id from nexo_private.integration_credentials for update`,
  );
  let n = 0;
  for (const r of rows) {
    if (r.key_id === k.activeKeyId) continue;
    const plain = decryptString(k, r.ciphertext, aad(r.integration_id, r.organization_id));
    const ct = encryptString(k, plain, aad(r.integration_id, r.organization_id));
    await db.query(`update nexo_private.integration_credentials set ciphertext = $2, key_id = $3, updated_at = now() where integration_id = $1`, [
      r.integration_id,
      ct,
      k.activeKeyId,
    ]);
    n++;
  }
  return n;
}
