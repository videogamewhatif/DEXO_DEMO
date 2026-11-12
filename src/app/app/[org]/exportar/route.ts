import { NextResponse, type NextRequest } from "next/server";
import { getSessionIdentity } from "@/lib/auth/session";
import { getMyOrganizations, getOrgDetails } from "@/lib/orgs/context";
import { can } from "@/lib/authz/permissions";
import { createDbRepository } from "@/lib/reports/db-repository";
import { csvResponse } from "@/lib/reports/export-response";
import { withUserDb } from "@/lib/db/user-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const identity = await getSessionIdentity();
  if (!identity) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { org: slug } = await params;
  const org = (await getMyOrganizations(identity)).find((o) => o.slug === slug && o.status === "active");
  // La verificación de permiso se repite en la BD: has_org_permission + RLS en cada consulta.
  if (!org || !can(org.role, "reports.export")) return NextResponse.json({ error: "Sin permiso de exportación" }, { status: 403 });
  const allowed = await withUserDb(identity, async (db) => (await db.query<{ ok: boolean }>("select nexo.has_org_permission($1, 'reports.export') ok", [org.id])).rows[0]?.ok);
  if (!allowed) return NextResponse.json({ error: "Sin permiso de exportación" }, { status: 403 });
  const details = await getOrgDetails(identity, org.id);
  const res = await csvResponse(createDbRepository(identity, org.id), details?.timezone ?? "UTC", new URL(request.url), slug);
  if (res instanceof NextResponse) return res;
  await withUserDb(identity, (db) =>
    db.query("select nexo.log_user_event($1, 'report.exported', $2::jsonb)", [org.id, JSON.stringify({ kind: res.kind, rows: res.rows, from: res.range.from, to: res.range.to })]),
  );
  return res.response;
}
