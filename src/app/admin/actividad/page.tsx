import { Card, PageHeader } from "@/components/ui/primitives";
import { AuditTable } from "@/components/views/ManagementViews";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { loadAudit } from "@/lib/orgs/queries";

export const metadata = { title: "Actividad" };

export default async function Page() {
  const identity = await requirePlatformAdmin();
  const rows = await loadAudit(identity, null, 300);
  return (
    <>
      <PageHeader title="Actividad administrativa" description="Últimos 300 eventos de todas las empresas." />
      <Card><AuditTable rows={rows} timezone="America/Mexico_City" showOrg /></Card>
    </>
  );
}
