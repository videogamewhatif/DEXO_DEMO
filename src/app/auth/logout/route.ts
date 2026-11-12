import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import { isAuthConfigured } from "@/config/env";

export async function POST(request: NextRequest) {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
