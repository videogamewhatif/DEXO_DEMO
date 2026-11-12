import { notFound } from "next/navigation";
import { ReportsView } from "@/components/views/ManagementViews";
import { getDemoOrg } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";
import { can } from "@/lib/authz/permissions";
import { filtersToQuery, parseFilters } from "@/lib/reports/filters";
import { PRESET_LABELS, todayInTimeZone } from "@/lib/metrics/periods";

export default async function Page({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  const role = await getDemoRole();
  const f = parseFilters(await searchParams, todayInTimeZone(org.timezone));
  return <ReportsView exportBase={`/demo/${slug}/exportar`} canExport={can(role, "reports.export")} demo query={filtersToQuery(f)} presetLabel={f.preset === "custom" ? `${f.range.from} a ${f.range.to}` : PRESET_LABELS[f.preset]} />;
}
