import { notFound } from "next/navigation";
import { ReportPage } from "@/components/views/ReportPage";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { createDemoRepository, getDemoOrg } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";

type Props = { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ params, searchParams }: Props) {
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  const role = await getDemoRole();
  if (!can(role, "reports.view")) return <Forbidden permission="reports.view" />;
  return (
    <ReportPage
      kind="overview"
      repo={createDemoRepository(org)}
      timezone={org.timezone}
      searchParams={await searchParams}
      basePath={`/demo/${slug}`}
      demo
      canManageIntegrations={can(role, "integrations.manage")}
    />
  );
}
