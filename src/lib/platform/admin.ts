import "server-only";
import { notFound } from "next/navigation";
import { requireIdentity } from "@/lib/auth/session";
import { getIsPlatformAdmin } from "@/lib/orgs/context";

/** Exige platform admin; si no lo es, la sección "no existe" (404). La BD lo verifica de nuevo. */
export async function requirePlatformAdmin() {
  const identity = await requireIdentity("/admin/empresas");
  if (!(await getIsPlatformAdmin(identity))) notFound();
  return identity;
}
