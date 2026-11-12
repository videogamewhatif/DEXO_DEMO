import { notFound } from "next/navigation";
import { IntegrationsView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { demoRaw, getDemoOrg, demoNow } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";
import { can } from "@/lib/authz/permissions";
import { listConnectors } from "@/lib/integrations/registry";
import { tokenPolicy } from "@/lib/orgs/queries";

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  const role = await getDemoRole();
  if (!can(role, "integrations.view")) return <Forbidden permission="integrations.view" />;
  const raw = demoRaw(org);
  const now = demoNow();
  return (
    <IntegrationsView
      orgSlug={slug}
      timezone={org.timezone}
      demo
      canManage={can(role, "integrations.manage")}
      canSync={can(role, "sync.trigger")}
      connectors={listConnectors().map((c) => {
        const i = org.integrations.find((x) => x.provider === c.descriptor.id);
        return {
          id: c.descriptor.id, name: c.descriptor.name, description: c.descriptor.shortDescription, accountTypeLabel: c.descriptor.accountTypeLabel,
          scopes: c.descriptor.scopes, configured: true, missing: [], tokenPolicy: tokenPolicy(c.descriptor.capabilities),
          integration: i ? { id: `demo-${i.provider}`, status: i.status, label: i.label, connectedAt: new Date(now - 40 * 86400000).toISOString(), tokenExpiresAt: null, lastErrorCode: i.status === "connected" ? null : "demo", lastErrorMessage: i.status === "connected" ? null : i.note } : null,
        };
      })}
      accounts={raw.accounts.map((a) => ({ id: a.id, provider: a.provider, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, externalStatus: null, isSelected: a.isSelected, lastSuccessfulSyncAt: a.lastSuccessfulSyncAt, integrationConnected: a.integrationStatus === "connected" }))}
      jobs={raw.accounts.flatMap((a, idx) => [
        { id: `${a.id}-j1`, accountName: a.name, kind: "scheduled", status: a.integrationStatus === "connected" ? "completed" : "failed", dateFrom: "2026-11-01", dateTo: "2026-11-08", createdAt: new Date(now - (idx + 2) * 3600000).toISOString(), finishedAt: null, errorCode: null, errorMessage: a.integrationStatus === "connected" ? null : "meta_ads:auth:190 — token caducado (ejemplo)", rowsWritten: a.integrationStatus === "connected" ? 120 : 0, attempts: 1, runAfter: null },
        { id: `${a.id}-j0`, accountName: a.name, kind: "initial", status: "completed", dateFrom: "2026-08-01", dateTo: "2026-10-01", createdAt: new Date(now - 40 * 86400000).toISOString(), finishedAt: null, errorCode: null, errorMessage: null, rowsWritten: 2400, attempts: 1, runAfter: null },
      ])}
    />
  );
}
