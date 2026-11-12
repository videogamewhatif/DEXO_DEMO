import "server-only";
import { getPool } from "./pool";
import type { Queryable } from "./types";

/**
 * Acceso privilegiado (propietario de las tablas: ignora RLS).
 *
 * Uso PERMITIDO únicamente en:
 *  - el trabajador de sincronización (src/lib/sync),
 *  - el almacenamiento de credenciales y estados OAuth (src/lib/integrations/service.ts),
 *  - la creación de cuentas durante la aceptación de invitaciones (src/lib/auth/invitations-service.ts),
 *  - scripts administrativos (scripts/).
 * Siempre DESPUÉS de verificar sesión y permisos con withUserDb.
 * ESLint bloquea su importación desde src/app y src/components.
 */
export async function withPrivilegedDb<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
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
