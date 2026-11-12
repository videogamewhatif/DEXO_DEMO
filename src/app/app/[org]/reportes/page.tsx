import { ReportsView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { getOrgDetails, requireOrgContext } from "@/lib/orgs/context";
import { filtersToQuery, parseFilters } from "@/lib/reports/filters";
import { PRESET_LABELS, todayInTimeZone } from "@/lib/metrics/periods";

export default async function Page({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org: slug } = await params;
  const ctx = await requireOrgContext(slug);
  if (ctx.org.status !== "active") return null;
  if (!can(ctx.org.role, "reports.view")) return <Forbidden permission="reports.view" />;
  const details = await getOrgDetails(ctx.identity, ctx.org.id);
  const f = parseFilters(await searchParams, todayInTimeZone(details?.timezone ?? "UTC"));
  return (
    <ReportsView exportBase={`/app/${slug}/exportar`} canExport={can(ctx.org.role, "reports.export")} demo={false}
      query={filtersToQuery(f)} presetLabel={f.preset === "custom" ? `${f.range.from} a ${f.range.to}` : PRESET_LABELS[f.preset]} />
  );
}
