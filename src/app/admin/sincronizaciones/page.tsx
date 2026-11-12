import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { JOB_KIND, JOB_STATUS } from "@/components/views/ManagementViews";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { withUserDb } from "@/lib/db/user-db";
import { formatDate, formatRelative } from "@/lib/format";
import { retryJobAction } from "../actions";

export const metadata = { title: "Sincronizaciones" };

export default async function Page() {
  const identity = await requirePlatformAdmin();
  const { jobs, integrations } = await withUserDb(identity, async (db) => ({
    jobs: (
      await db.query(
        `select j.id, o.name as org, pa.name as account, pa.provider, j.kind::text as kind, j.status::text as status, j.date_from, j.date_to,
                j.attempts, j.max_attempts, j.error_code, j.error_message, j.created_at, j.run_after
           from nexo.sync_jobs j join nexo.organizations o on o.id = j.organization_id join nexo.provider_accounts pa on pa.id = j.provider_account_id
          where j.status in ('failed','partially_completed','pending','running') or j.created_at > now() - interval '2 days'
          order by (j.status = 'failed') desc, j.created_at desc limit 200`,
      )
    ).rows,
    integrations: (
      await db.query(
        `select o.name as org, i.provider, i.status::text as status, i.last_error_message, i.token_expires_at
           from nexo.integrations i join nexo.organizations o on o.id = i.organization_id where i.status in ('needs_reauth','error') order by o.name`,
      )
    ).rows,
  }));
  return (
    <>
      <PageHeader title="Estado de sincronizaciones" description="Trabajos recientes, pendientes y fallidos de todas las empresas. Los mensajes de error están depurados de secretos." />
      {integrations.length > 0 && (
        <Card title="Integraciones que requieren atención" className="mb-6">
          <ul className="space-y-1 text-sm">{integrations.map((i, n) => <li key={n}><strong>{i.org}</strong> · {i.provider} · <Badge tone="warn">{i.status}</Badge> {i.last_error_message}</li>)}</ul>
        </Card>
      )}
      <Card>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Trabajos de sincronización">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted"><tr><th className="p-2">Empresa / cuenta</th><th className="p-2">Tipo</th><th className="p-2">Estado</th><th className="p-2">Periodo</th><th className="p-2">Intentos</th><th className="p-2">Error</th><th className="p-2"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-line align-top">
                  <td className="p-2"><p className="font-medium">{j.org}</p><p className="text-xs text-muted">{j.account} · {j.provider} · {formatRelative(j.created_at.toISOString())}</p></td>
                  <td className="p-2">{JOB_KIND[j.kind] ?? j.kind}</td>
                  <td className="p-2"><Badge tone={JOB_STATUS[j.status]?.tone ?? "neutral"}>{JOB_STATUS[j.status]?.label ?? j.status}</Badge></td>
                  <td className="whitespace-nowrap p-2">{formatDate(j.date_from)} – {formatDate(j.date_to)}</td>
                  <td className="p-2">{j.attempts}/{j.max_attempts}</td>
                  <td className="max-w-sm p-2 text-xs text-muted">{j.error_code && <code>{j.error_code}</code>} {j.error_message}</td>
                  <td className="p-2">{["failed", "partially_completed", "cancelled"].includes(j.status) && (
                    <ActionForm action={retryJobAction}><input type="hidden" name="job" value={j.id} /><SubmitButton variant="secondary">Reintentar</SubmitButton></ActionForm>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
