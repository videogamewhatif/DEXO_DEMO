import { notFound } from "next/navigation";
import { SettingsView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { getDemoOrg } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";
import { can } from "@/lib/authz/permissions";

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  if (!can(await getDemoRole(), "settings.manage")) return <Forbidden permission="settings.manage" />;
  return (
    <SettingsView orgSlug={slug} demo timezone={org.timezone}
      settings={{ name: org.name, logoUrl: null, displayCurrency: org.displayCurrency, timezone: org.timezone, ga4LeadEventName: org.settings.ga4LeadEventName, metaLeadActionType: org.settings.metaLeadActionType, metaPurchaseActionType: org.settings.metaPurchaseActionType, syncFrequencyHours: 24, attributionRefreshDays: 7 }}
      audit={[{ id: "1", createdAt: new Date().toISOString(), actor: org.members[0]!.email, actorType: "user", action: "integration.connected", target: "integration", details: "provider: google_analytics (ejemplo)" }]} />
  );
}
