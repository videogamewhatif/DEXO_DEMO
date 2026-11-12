import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { getSessionIdentity } from "@/lib/auth/session";
import { getMyOrganizations } from "@/lib/orgs/context";
import { startOAuth } from "@/lib/integrations/service";
import { isProviderId } from "@/lib/integrations/registry";
import { toAppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Inicia OAuth. Solo POST desde la propia aplicación (verificación de Origin). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const appOrigin = new URL(serverEnv().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== appOrigin) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!isProviderId(provider)) return NextResponse.json({ error: "Integración desconocida" }, { status: 404 });

  const identity = await getSessionIdentity();
  if (!identity) return NextResponse.redirect(new URL("/login", appOrigin), 303);
  const form = await request.formData();
  const slug = String(form.get("org") ?? "");
  const org = (await getMyOrganizations(identity)).find((o) => o.slug === slug && o.status === "active");
  if (!org) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  try {
    const url = await startOAuth(identity, org.id, provider);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    const e = toAppError(err);
    const back = new URL(`/app/${slug}/integraciones`, appOrigin);
    back.searchParams.set("estado", "error");
    back.searchParams.set("detalle", e.message);
    return NextResponse.redirect(back, 303);
  }
}
