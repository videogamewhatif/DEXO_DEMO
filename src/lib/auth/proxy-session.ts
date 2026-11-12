import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";

/** Renueva la sesión de Supabase en cada petición (patrón oficial de @supabase/ssr). */
export async function updateSession(request: NextRequest) {
  // Lectura en tiempo de ejecución (no inlined en el build): la misma imagen sirve para varios entornos.
  const env = serverEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    await supabase.auth.getClaims();
  } catch {
    // Sin conexión con Auth: las páginas protegidas redirigirán a /login.
  }
  return response;
}
