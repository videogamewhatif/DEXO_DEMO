import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Badge, Card, Field, PageHeader, inputClass } from "@/components/ui/primitives";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { withUserDb } from "@/lib/db/user-db";
import { formatRelative } from "@/lib/format";
import { createOrgAction, inviteOrgAdminAction, setOrgStatusAction, startSupportAction } from "../actions";

export const metadata = { title: "Empresas" };

export default async function Page() {
  const identity = await requirePlatformAdmin();
  const orgs = await withUserDb(identity, async (db) =>
    (
      await db.query(
        `select o.id, o.name, o.slug, o.status::text as status, o.suspended_reason, o.timezone, o.created_at,
                (select count(*) from nexo.organization_members m where m.organization_id = o.id)::int as members,
                (select count(*) from nexo.organization_members m where m.organization_id = o.id and m.role = 'org_admin')::int as admins,
                (select string_agg(i.provider || ':' || i.status, ', ') from nexo.integrations i where i.organization_id = o.id and i.status <> 'disconnected') as integrations,
                (select count(*) from nexo.sync_jobs j where j.organization_id = o.id and j.status = 'failed' and j.created_at > now() - interval '7 days')::int as failed,
                (select max(j.finished_at) from nexo.sync_jobs j where j.organization_id = o.id and j.status in ('completed','partially_completed')) as last_sync
           from nexo.organizations o order by o.name`,
      )
    ).rows,
  );
  return (
    <>
      <PageHeader title="Empresas" description="Alta, suspensión, invitación del administrador y acceso de soporte auditado. El acceso de plataforma no muestra datos de reportes sin una sesión de soporte explícita." />
      <Card title="Crear empresa" className="mb-6">
        <ActionForm action={createOrgAction} className="grid gap-3 md:grid-cols-5 md:items-end">
          <Field label="Nombre" htmlFor="o-name"><input id="o-name" name="name" required className={inputClass} /></Field>
          <Field label="Identificador (URL)" htmlFor="o-slug"><input id="o-slug" name="slug" required pattern="[a-z0-9-]{1,48}" className={inputClass} /></Field>
          <Field label="Zona horaria" htmlFor="o-tz"><input id="o-tz" name="timezone" defaultValue="America/Mexico_City" required className={inputClass} /></Field>
          <Field label="Moneda preferida" htmlFor="o-cur"><input id="o-cur" name="display_currency" defaultValue="MXN" maxLength={3} className={inputClass} /></Field>
          <SubmitButton>Crear</SubmitButton>
        </ActionForm>
      </Card>
      <div className="space-y-4">
        {orgs.length === 0 && <p className="text-sm text-muted">Aún no hay empresas.</p>}
        {orgs.map((o) => (
          <Card key={o.id} title={<span className="flex flex-wrap items-center gap-2">{o.name}<Badge tone={o.status === "active" ? "ok" : "danger"}>{o.status === "active" ? "Activa" : "Suspendida"}</Badge>{o.admins === 0 && <Badge tone="warn">Sin administrador</Badge>}</span>}
            description={`/${o.slug} · ${o.timezone} · ${o.members} miembro(s) · integraciones: ${o.integrations ?? "ninguna"} · última sincronización: ${o.last_sync ? formatRelative(o.last_sync.toISOString()) : "nunca"}${o.failed ? ` · ${o.failed} fallo(s) en 7 días` : ""}`}>
            {o.suspended_reason && <p className="mb-2 text-sm text-danger">Motivo de suspensión: {o.suspended_reason}</p>}
            <div className="grid gap-4 lg:grid-cols-3">
              <ActionForm action={inviteOrgAdminAction} className="space-y-2">
                <input type="hidden" name="org" value={o.id} />
                <Field label="Invitar administrador de empresa" htmlFor={`inv-${o.id}`}><input id={`inv-${o.id}`} name="email" type="email" required className={inputClass} /></Field>
                <SubmitButton variant="secondary" disabledReason={o.status !== "active" ? "La empresa está suspendida" : undefined}>Invitar</SubmitButton>
              </ActionForm>
              <ActionForm action={setOrgStatusAction} className="space-y-2">
                <input type="hidden" name="org" value={o.id} />
                <input type="hidden" name="status" value={o.status === "active" ? "suspended" : "active"} />
                {o.status === "active" && <Field label="Motivo de suspensión" htmlFor={`r-${o.id}`}><input id={`r-${o.id}`} name="reason" minLength={5} required className={inputClass} /></Field>}
                <SubmitButton variant={o.status === "active" ? "danger" : "primary"}>{o.status === "active" ? "Suspender" : "Reactivar"}</SubmitButton>
              </ActionForm>
              <ActionForm action={startSupportAction} className="space-y-2">
                <input type="hidden" name="org" value={o.id} />
                <Field label="Acceso de soporte (solo lectura, auditado)" htmlFor={`s-${o.id}`} hint="La empresa verá este acceso y su motivo en su registro de actividad.">
                  <input id={`s-${o.id}`} name="reason" minLength={10} required placeholder="Motivo (p. ej. ticket #123)" className={inputClass} />
                </Field>
                <select name="minutes" defaultValue="60" aria-label="Duración" className={inputClass}><option value="30">30 min</option><option value="60">60 min</option><option value="120">2 h</option></select>
                <SubmitButton variant="secondary" disabledReason={o.status !== "active" ? "La empresa está suspendida" : undefined}>Iniciar acceso de soporte</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
