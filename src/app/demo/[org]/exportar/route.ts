import { NextResponse, type NextRequest } from "next/server";
import { createDemoRepository, getDemoOrg } from "@/lib/demo/data";
import { csvResponse } from "@/lib/reports/export-response";
import { getDemoRole } from "@/lib/demo/role";
import { can } from "@/lib/authz/permissions";
import { isDemoEnabled } from "@/config/env";

export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  if (!isDemoEnabled()) return NextResponse.json({ error: "No disponible" }, { status: 404 });
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (!can(await getDemoRole(), "reports.export")) return NextResponse.json({ error: "El rol simulado no puede exportar" }, { status: 403 });
  const res = await csvResponse(createDemoRepository(org), org.timezone, new URL(request.url), `DEMO-${slug}`);
  return res instanceof NextResponse ? res : res.response;
}
