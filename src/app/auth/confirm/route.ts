import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import { safeNextPath } from "@/lib/auth/session";
import { isAuthConfigured } from "@/config/env";

const TYPES: EmailOtpType[] = ["recovery", "invite", "email", "magiclink", "signup", "email_change"];

/** Confirma enlaces de correo de Supabase (token_hash + type, o code PKCE). */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), "/app");
  const fail = NextResponse.redirect(new URL("/login?error=enlace", url.origin));
  if (!isAuthConfigured()) return fail;
  const supabase = await createSupabaseServerClient();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return fail;
}
