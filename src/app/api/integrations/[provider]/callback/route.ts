import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { getSessionIdentity } from "@/lib/auth/session";
import { completeOAuth } from "@/lib/integrations/service";
import { isProviderId } from "@/lib/integrations/registry";
import { withUserDb } from "@/lib/db/user-db";
import { toAppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Callback OAuth. La empresa se obtiene del state almacenado (nunca de la URL),
 * el state es de un solo uso y debe pertenecer a la misma sesión.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const appOrigin = new URL(serverEnv().APP_URL).origin;
  if (!isProviderId(provider)) return NextResponse.json({ error: "Integración desconocida" }, { status: 404 });
  const identity = await getSessionIdentity();
  if (!identity) return NextResponse.redirect(new URL("/login?error=sesion", appOrigin));
  const url = new URL(request.url);
  try {
    const result = await completeOAuth(identity, provider, url.searchParams);
    const slug = await withUserDb(identity, async (db) => (await db.query<{ slug: string }>("select slug from nexo.organizations where id = $1", [result.organizationId])).rows[0]?.slug);
    return NextResponse.redirect(new URL(`/app/${slug}/integraciones?estado=conectado`, appOrigin));
  } catch (err) {
    const e = toAppError(err);
    const dest = new URL("/app", appOrigin);
    dest.searchParams.set("error_integracion", e.code);
    return NextResponse.redirect(dest);
  }
}
