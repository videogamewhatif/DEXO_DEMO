import { SettingsView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { getOrgDetails, requireOrgContext } from "@/lib/orgs/context";
import { loadAudit } from "@/lib/orgs/queries";
import { updateSettingsAction } from "../actions";

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrgContext(slug);
  if (ctx.org.status !== "active") return null;
  if (!can(ctx.org.role, "settings.manage")) return <Forbidden permission="settings.manage" />;
  const details = await getOrgDetails(ctx.identity, ctx.org.id);
  if (!details) return <Forbidden permission="settings.manage" />;
  const audit = can(ctx.org.role, "audit.view") ? await loadAudit(ctx.identity, ctx.org.id) : null;
  return <SettingsView orgSlug={slug} demo={false} settings={details} audit={audit} timezone={details.timezone} action={updateSettingsAction} />;
}
