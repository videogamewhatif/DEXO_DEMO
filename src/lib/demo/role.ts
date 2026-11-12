import "server-only";
import { cookies } from "next/headers";
import { isOrgRole, type OrgRole } from "@/lib/authz/permissions";

export const DEMO_ROLE_COOKIE = "nexo_demo_role";

/**
 * Rol SIMULADO para recorrer pantallas de la demostración. Solo afecta la
 * presentación de /demo; no autentica ni autoriza nada fuera de la demostración.
 */
export async function getDemoRole(): Promise<OrgRole> {
  const v = (await cookies()).get(DEMO_ROLE_COOKIE)?.value;
  return isOrgRole(v) ? v : "org_admin";
}
