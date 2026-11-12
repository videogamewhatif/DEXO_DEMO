import "server-only";
import { AppError } from "@/lib/errors";
import { randomToken, sha256Hex, encryptString, decryptString } from "@/lib/security/crypto";
import type { Queryable } from "@/lib/db/types";
import { keyRing } from "./credentials";

const STATE_TTL_MINUTES = 10;

/** Crea un state impredecible (256 bits), de un uso y con vencimiento. Solo se guarda su hash. */
export async function createOAuthState(
  db: Queryable,
  p: { organizationId: string; userId: string; provider: string; pkceVerifier?: string },
): Promise<string> {
  const state = randomToken(32);
  const hash = sha256Hex(state);
  const verifierEnc = p.pkceVerifier ? encryptString(keyRing(), p.pkceVerifier, `oauth_state:${hash}`) : null;
  await db.query(
    `insert into nexo_private.oauth_states (state_hash, organization_id, user_id, provider, pkce_verifier_enc, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [hash, p.organizationId, p.userId, p.provider, verifierEnc, STATE_TTL_MINUTES],
  );
  return state;
}

export type ConsumedState =
  | { ok: true; organizationId: string; pkceVerifier?: string }
  | { ok: false; error: AppError };

/**
 * Consume el state de forma atómica: queda marcado como usado AUNQUE la
 * validación posterior falle (otro usuario, vencido, proveedor distinto), para
 * que no pueda reutilizarse. Por eso NO lanza dentro de la transacción: el
 * llamador debe confirmar la transacción y después usar `assertConsumed`.
 * La empresa SIEMPRE se toma del registro del state, nunca de la URL.
 */
export async function consumeOAuthState(db: Queryable, p: { state: string; provider: string; userId: string }): Promise<ConsumedState> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(p.state)) return { ok: false, error: new AppError("oauth_state_invalid", "El estado de autorización no es válido.") };
  const hash = sha256Hex(p.state);
  const { rows } = await db.query<{
    organization_id: string;
    user_id: string;
    provider: string;
    pkce_verifier_enc: string | null;
    expired: boolean;
  }>(
    `update nexo_private.oauth_states set consumed_at = now()
      where state_hash = $1 and consumed_at is null
      returning organization_id, user_id, provider, pkce_verifier_enc, expires_at <= now() as expired`,
    [hash],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: new AppError("oauth_state_invalid", "La autorización ya fue utilizada o no es válida. Inicia la conexión de nuevo.") };
  if (row.expired) return { ok: false, error: new AppError("oauth_state_expired", "La autorización tardó demasiado. Inicia la conexión de nuevo.") };
  if (row.provider !== p.provider) return { ok: false, error: new AppError("oauth_state_invalid", "La autorización no corresponde a esta integración.") };
  if (row.user_id !== p.userId) {
    return { ok: false, error: new AppError("oauth_state_user_mismatch", "La autorización se inició con otra sesión. Inicia la conexión de nuevo.") };
  }
  return {
    ok: true,
    organizationId: row.organization_id,
    pkceVerifier: row.pkce_verifier_enc ? decryptString(keyRing(), row.pkce_verifier_enc, `oauth_state:${hash}`) : undefined,
  };
}

export function assertConsumed(c: ConsumedState): { organizationId: string; pkceVerifier?: string } {
  if (!c.ok) throw c.error;
  return c;
}
