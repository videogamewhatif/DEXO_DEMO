"use server";
import { cookies } from "next/headers";
import { isOrgRole } from "@/lib/authz/permissions";
import { DEMO_ROLE_COOKIE } from "@/lib/demo/role";
import { isDemoEnabled } from "@/config/env";

export async function setDemoRole(formData: FormData) {
  if (!isDemoEnabled()) return;
  const role = formData.get("role");
  if (!isOrgRole(role)) return;
  (await cookies()).set(DEMO_ROLE_COOKIE, role, { path: "/demo", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 });
}
