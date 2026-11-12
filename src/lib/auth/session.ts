import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isAuthConfigured } from "@/config/env";
import type { SessionIdentity } from "@/lib/db/types";
import { createSupabaseServerClient } from "./supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identidad verificada del usuario. getClaims() valida la firma del JWT
 * (JWKS para claves asimétricas o el servidor de Auth para simétricas).
 * Nunca se usa getSession() en el servidor para decisiones de acceso.
 */
export const getSessionIdentity = cache(async (): Promise<SessionIdentity | null> => {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const sub = data.claims.sub;
    const email = typeof data.claims.email === "string" ? data.claims.email.toLowerCase() : "";
    if (typeof sub !== "string" || !UUID_RE.test(sub)) return null;
    return { userId: sub, email };
  } catch {
    return null;
  }
});

export async function requireIdentity(nextPath?: string): Promise<SessionIdentity> {
  const id = await getSessionIdentity();
  if (!id) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return id;
}

/** Solo rutas internas relativas (evita redirecciones abiertas). */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
