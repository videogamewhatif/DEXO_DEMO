import "server-only";
import { AppError } from "@/lib/errors";
import { withUserDb } from "@/lib/db/user-db";
import type { Queryable, SessionIdentity } from "@/lib/db/types";
import type { Permission } from "./permissions";

/** Verifica el permiso en la base de datos (misma función que usan las políticas RLS). */
export async function hasPermission(db: Queryable, organizationId: string, permission: Permission): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>("select nexo.has_org_permission($1, $2) as ok", [organizationId, permission]);
  return rows[0]?.ok === true;
}

export async function assertPermission(identity: SessionIdentity, organizationId: string, permission: Permission): Promise<void> {
  const ok = await withUserDb(identity, (db) => hasPermission(db, organizationId, permission));
  if (!ok) throw new AppError("forbidden");
}

export async function isPlatformAdmin(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>("select nexo.is_platform_admin() as ok");
  return rows[0]?.ok === true;
}
