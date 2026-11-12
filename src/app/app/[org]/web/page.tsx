import { ReportPage } from "@/components/views/ReportPage";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { getOrgDetails, requireOrgContext } from "@/lib/orgs/context";
import { createDbRepository } from "@/lib/reports/db-repository";

type Props = { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ params, searchParams }: Props) {
  const { org: slug } = await params;
  const ctx = await requireOrgContext(slug);
  if (ctx.org.status !== "active") return null;
  if (!can(ctx.org.role, "reports.view")) return <Forbidden permission="reports.view" />;
  const details = await getOrgDetails(ctx.identity, ctx.org.id);
  if (!details) return <Forbidden permission="reports.view" />;
  return (
    <ReportPage
      kind="web"
      repo={createDbRepository(ctx.identity, ctx.org.id)}
      timezone={details.timezone}
      searchParams={await searchParams}
      basePath={`/app/${slug}`}
      demo={false}
      canManageIntegrations={can(ctx.org.role, "integrations.manage")}
    />
  );
}
