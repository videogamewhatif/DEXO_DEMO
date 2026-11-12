import "server-only";
import { getPool } from "./pool";
import type { Queryable, SessionIdentity } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` en una transacción con el rol `authenticated` y los claims del
 * usuario verificado, exactamente como lo hace PostgREST en Supabase. Todas las
 * políticas RLS aplican. Es la ÚNICA vía de acceso a datos para peticiones de
 * usuarios.
 *
 * `identity` debe provenir de un JWT verificado (ver src/lib/auth/session.ts),
 * nunca de datos enviados por el cliente.
 */
export async function withUserDb<T>(identity: SessionIdentity, fn: (db: Queryable) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(identity.userId)) throw new Error("Identidad inválida");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: identity.userId, role: "authenticated", email: identity.email }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
