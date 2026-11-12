import { ActionForm, SubmitButton, type ActionState } from "@/components/forms/ActionForm";
import { Alert, Badge, Card, ComingSoon, Field, HelpTip, PageHeader, inputClass } from "@/components/ui/primitives";
import { ORG_ROLES, PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS, type EffectiveRole, type OrgRole } from "@/lib/authz/permissions";
import { PLANNED_SOURCES } from "@/lib/integrations/registry";
import { EXPORT_LABELS, type ExportKind } from "@/lib/reports/csv";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { PRESET_LABELS } from "@/lib/metrics/periods";

type Action = (prev: ActionState, data: FormData) => Promise<ActionState>;
const DEMO_REASON = "No disponible en la demostración";

// =============================================================================
// Integraciones
// =============================================================================
export interface ConnectorCardData {
  id: string;
  name: string;
  description: string;
  accountTypeLabel: string;
  scopes: readonly string[];
  configured: boolean;
  missing: string[];
  tokenPolicy: string;
  integration: {
    id: string;
    status: string;
    label: string | null;
    connectedAt: string | null;
    tokenExpiresAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  } | null;
}

export interface AccountData {
  id: string;
  provider: string;
  name: string;
  externalId: string;
  currency: string | null;
  timezone: string | null;
  externalStatus: string | null;
  isSelected: boolean;
  lastSuccessfulSyncAt: string | null;
  integrationConnected: boolean;
}

export interface JobData {
  id: string;
  accountName: string;
  kind: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rowsWritten: number;
  attempts: number;
  runAfter: string | null;
}

const STATUS_BADGE: Record<string, { tone: "ok" | "warn" | "danger" | "neutral" | "info"; label: string }> = {
  connected: { tone: "ok", label: "Conectada" },
  needs_reauth: { tone: "warn", label: "Requiere reconexión" },
  error: { tone: "danger", label: "Con error" },
  disconnected: { tone: "neutral", label: "Desconectada" },
};

export const JOB_STATUS: Record<string, { tone: "ok" | "warn" | "danger" | "neutral" | "info"; label: string }> = {
  pending: { tone: "info", label: "Pendiente" },
  running: { tone: "info", label: "En curso" },
  completed: { tone: "ok", label: "Completada" },
  partially_completed: { tone: "warn", label: "Parcial" },
  failed: { tone: "danger", label: "Fallida" },
  cancelled: { tone: "neutral", label: "Cancelada" },
};
export const JOB_KIND: Record<string, string> = { initial: "Inicial", scheduled: "Programada", manual: "Manual" };

export function IntegrationsView(props: {
  orgSlug: string;
  timezone: string;
  demo: boolean;
  canManage: boolean;
  canSync: boolean;
  connectors: ConnectorCardData[];
  accounts: AccountData[];
  jobs: JobData[];
  flash?: { tone: "ok" | "danger" | "warn"; text: string } | null;
  actions?: { toggleAccount: Action; requestSync: Action; refreshAccounts: Action; disconnect: Action; cancelJob: Action };
}) {
  const { demo, canManage, canSync, actions } = props;
  const manageReason = demo ? DEMO_REASON : !canManage ? "Requiere permiso para gestionar integraciones" : undefined;
  const syncReason = demo ? DEMO_REASON : !canSync ? "Requiere permiso para solicitar actualizaciones" : undefined;
  return (
    <>
      <PageHeader title="Integraciones" description="Conecta fuentes, elige qué cuentas sincronizar y revisa el estado de cada actualización." />
      {props.flash && <div className="mb-4"><Alert tone={props.flash.tone}>{props.flash.text}</Alert></div>}
      <div className="grid gap-4 xl:grid-cols-2">
        {props.connectors.map((c) => {
          const integ = c.integration;
          const st = integ ? STATUS_BADGE[integ.status] : null;
          const connectLabel = !integ || integ.status === "disconnected" ? "Conectar" : integ.status === "connected" ? "Reautorizar" : "Reconectar";
          const connectReason = manageReason ?? (!c.configured ? `Falta configuración del servidor: ${c.missing.join(", ")}` : undefined);
          const accounts = props.accounts.filter((a) => a.provider === c.id);
          return (
            <Card key={c.id} title={<span className="flex items-center gap-2">{c.name}{st && <Badge tone={st.tone}>{st.label}</Badge>}</span>} description={c.description}>
              <dl className="mb-3 grid grid-cols-1 gap-y-1 text-sm">
                <div><dt className="inline text-muted">Permisos solicitados: </dt><dd className="inline break-all font-mono text-xs">{c.scopes.join(", ")}</dd></div>
                <div><dt className="inline text-muted">Renovación: </dt><dd className="inline">{c.tokenPolicy}</dd></div>
                {integ?.label && <div><dt className="inline text-muted">Conectada por: </dt><dd className="inline">{integ.label}</dd></div>}
                {integ?.connectedAt && integ.status !== "disconnected" && <div><dt className="inline text-muted">Desde: </dt><dd className="inline">{formatDateTime(integ.connectedAt, props.timezone)}</dd></div>}
                {integ?.tokenExpiresAt && integ.status === "connected" && c.id === "meta_ads" && (
                  <div className="sm:col-span-2"><dt className="inline text-muted">El token vence: </dt><dd className="inline">{formatDateTime(integ.tokenExpiresAt, props.timezone)} — reconecta antes para no interrumpir la sincronización.</dd></div>
                )}
              </dl>
              {!c.configured && <div className="mb-3"><Alert tone="warn" title="Integración no configurada en el servidor">Faltan variables: {c.missing.join(", ")}. Consulta {c.id === "meta_ads" ? "docs/guia-meta.md" : "docs/guia-google.md"}.</Alert></div>}
              {integ?.status === "needs_reauth" && <div className="mb-3"><Alert tone="warn" title="La autorización caducó o fue revocada">No se consultará al proveedor hasta reconectar. Los datos históricos se conservan.{integ.lastErrorMessage ? ` Detalle: ${integ.lastErrorMessage}` : ""}</Alert></div>}
              {integ?.lastErrorCode && integ.status === "connected" && <div className="mb-3"><Alert tone="warn">Último aviso: {integ.lastErrorMessage ?? integ.lastErrorCode}</Alert></div>}
              <div className="flex flex-wrap gap-2">
                <form action={`/api/integrations/${c.id}/start`} method="post">
                  <input type="hidden" name="org" value={props.orgSlug} />
                  <button type="submit" disabled={Boolean(connectReason)} title={connectReason} className="min-h-10 rounded-md bg-brand px-3.5 text-sm font-medium text-brand-fg disabled:cursor-not-allowed disabled:opacity-50">
                    {connectLabel}
                  </button>
                </form>
                {integ && integ.status !== "disconnected" && (
                  <>
                    {actions ? (
                      <ActionForm action={actions.refreshAccounts}>
                        <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="integration" value={integ.id} />
                        <SubmitButton variant="secondary" disabledReason={manageReason ?? (integ.status !== "connected" ? "La integración no está conectada" : undefined)}>Actualizar lista de cuentas</SubmitButton>
                      </ActionForm>
                    ) : <button disabled title={DEMO_REASON} className="min-h-10 rounded-md border border-line px-3.5 text-sm opacity-50">Actualizar lista de cuentas</button>}
                    {actions ? (
                      <ActionForm action={actions.disconnect}>
                        <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="integration" value={integ.id} />
                        <SubmitButton variant="danger" disabledReason={manageReason}>Desconectar</SubmitButton>
                      </ActionForm>
                    ) : <button disabled title={DEMO_REASON} className="min-h-10 rounded-md border border-danger/40 px-3.5 text-sm text-danger opacity-50">Desconectar</button>}
                  </>
                )}
              </div>
              {connectReason && <p className="mt-2 text-xs text-muted">{connectReason}.</p>}
              {accounts.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">Autorizadas por la cuenta conectada ({c.accountTypeLabel.toLowerCase()})</h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {accounts.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">{a.name}</p>
                          <p className="text-xs text-muted">
                            ID {a.externalId} · {a.currency ?? "moneda por validar"} · {a.timezone ?? "zona horaria por validar"}
                            {a.externalStatus && ` · ${a.externalStatus}`}
                            {" · "}{a.lastSuccessfulSyncAt ? `sincronizada ${formatRelative(a.lastSuccessfulSyncAt)}` : "sin sincronizar"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {actions ? (
                            <ActionForm action={actions.toggleAccount}>
                              <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="account" value={a.id} />
                              <input type="hidden" name="selected" value={a.isSelected ? "false" : "true"} />
                              <SubmitButton variant={a.isSelected ? "secondary" : "primary"} disabledReason={manageReason ?? (!a.integrationConnected && !a.isSelected ? "La integración no está conectada" : undefined)}>
                                {a.isSelected ? "Dejar de sincronizar" : "Sincronizar esta cuenta"}
                              </SubmitButton>
                            </ActionForm>
                          ) : <Badge tone={a.isSelected ? "ok" : "neutral"}>{a.isSelected ? "Seleccionada" : "No seleccionada"}</Badge>}
                          {a.isSelected && (actions ? (
                            <ActionForm action={actions.requestSync}>
                              <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="account" value={a.id} />
                              <SubmitButton variant="secondary" disabledReason={syncReason}>Actualizar ahora</SubmitButton>
                            </ActionForm>
                          ) : <button disabled title={DEMO_REASON} className="min-h-10 rounded-md border border-line px-3 text-sm opacity-50">Actualizar ahora</button>)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">La actualización manual está limitada a una cada 15 minutos por cuenta. La actualización automática es diaria por defecto.</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Historial de sincronizaciones" className="mt-6" description="Últimos trabajos. Los errores se muestran sin datos sensibles.">
        {props.jobs.length === 0 ? <p className="text-sm text-muted">Aún no hay sincronizaciones.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Historial de sincronizaciones">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr><th className="p-2">Cuenta</th><th className="p-2">Tipo</th><th className="p-2">Estado</th><th className="p-2">Periodo</th><th className="p-2">Creada</th><th className="p-2 text-right">Filas</th><th className="p-2">Detalle</th><th className="p-2"><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {props.jobs.map((j) => (
                  <tr key={j.id} className="border-t border-line align-top">
                    <td className="p-2">{j.accountName}</td>
                    <td className="p-2">{JOB_KIND[j.kind] ?? j.kind}</td>
                    <td className="p-2"><Badge tone={JOB_STATUS[j.status]?.tone ?? "neutral"}>{JOB_STATUS[j.status]?.label ?? j.status}</Badge>{j.attempts > 1 && <span className="ml-1 text-xs text-muted">intento {j.attempts}</span>}</td>
                    <td className="p-2 whitespace-nowrap">{formatDate(j.dateFrom)} – {formatDate(j.dateTo)}</td>
                    <td className="p-2 whitespace-nowrap">{formatDateTime(j.createdAt, props.timezone)}</td>
                    <td className="tabular p-2 text-right">{j.rowsWritten}</td>
                    <td className="max-w-xs p-2 text-xs text-muted">{j.errorMessage ?? (j.status === "pending" && j.runAfter ? `Programada para ${formatDateTime(j.runAfter, props.timezone)}` : "")}</td>
                    <td className="p-2">
                      {j.status === "pending" && actions && (
                        <ActionForm action={actions.cancelJob}>
                          <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="job" value={j.id} />
                          <SubmitButton variant="secondary" disabledReason={syncReason}>Cancelar</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-base font-semibold">Próximas integraciones</h2>
      <p className="mb-3 text-sm text-muted">Aún no están implementadas. Se muestran para planificación; no es posible conectarlas.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {PLANNED_SOURCES.filter((s) => s.category !== "reporting").map((s) => <ComingSoon key={s.id} name={s.name} description={s.description} />)}
      </div>
    </>
  );
}

// =============================================================================
// Equipo
// =============================================================================
export interface MemberData { userId: string; email: string; name: string | null; role: OrgRole; createdAt: string }
export interface InvitationData { id: string; email: string; role: OrgRole; expiresAt: string; createdAt: string; status: "pending" | "expired" | "accepted" | "revoked"; delivery: string }

const INV_STATUS = { pending: { tone: "info", label: "Pendiente" }, expired: { tone: "warn", label: "Vencida" }, accepted: { tone: "ok", label: "Aceptada" }, revoked: { tone: "neutral", label: "Revocada" } } as const;
const DELIVERY: Record<string, string> = { sent: "correo enviado", not_configured: "correo no configurado: enlace compartido manualmente", failed: "falló el envío del correo", pending: "envío pendiente" };

export function PermissionMatrix() {
  const roles: EffectiveRole[] = [...ORG_ROLES, "support"];
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Matriz de permisos">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Matriz de permisos por rol</caption>
        <thead className="bg-surface-2 text-xs text-muted"><tr><th className="p-2 text-left">Permiso</th>{roles.map((r) => <th key={r} className="p-2 text-center">{ROLE_LABELS[r]}</th>)}</tr></thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p} className="border-t border-line">
              <th scope="row" className="p-2 text-left font-normal">{PERMISSION_LABELS[p]}</th>
              {roles.map((r) => <td key={r} className="p-2 text-center">{ROLE_PERMISSIONS[r].includes(p) ? <span aria-label="Sí">✓</span> : <span aria-label="No" className="text-muted">—</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamView(props: {
  orgSlug: string;
  timezone: string;
  demo: boolean;
  canManage: boolean;
  currentUserId: string | null;
  emailConfigured: boolean;
  members: MemberData[];
  invitations: InvitationData[];
  actions?: { invite: Action; revoke: Action; changeRole: Action; remove: Action };
}) {
  const { actions, demo, canManage } = props;
  const reason = demo ? DEMO_REASON : !canManage ? "Requiere permiso para gestionar miembros" : undefined;
  const admins = props.members.filter((m) => m.role === "org_admin").length;
  return (
    <>
      <PageHeader title="Equipo" description="Personas con acceso a esta empresa y sus roles." />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title={`Miembros (${props.members.length})`}>
          <ul className="divide-y divide-line">
            {props.members.map((m) => {
              const lastAdmin = m.role === "org_admin" && admins <= 1;
              return (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{m.name ?? m.email}{m.userId === props.currentUserId && <span className="ml-2 text-xs text-muted">(tú)</span>}</p>
                    <p className="text-xs text-muted">{m.email} · desde {formatDate(m.createdAt.slice(0, 10))}</p>
                  </div>
                  {actions && canManage && !demo ? (
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionForm action={actions.changeRole} className="flex items-center gap-2">
                        <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="user" value={m.userId} />
                        <label className="sr-only" htmlFor={`role-${m.userId}`}>Rol de {m.email}</label>
                        <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className={`${inputClass} w-auto`} disabled={lastAdmin} title={lastAdmin ? "Es el último administrador" : undefined}>
                          {ORG_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <SubmitButton variant="secondary" disabledReason={lastAdmin ? "Es el último administrador de la empresa" : undefined}>Cambiar</SubmitButton>
                      </ActionForm>
                      <ActionForm action={actions.remove}>
                        <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="user" value={m.userId} />
                        <SubmitButton variant="danger" disabledReason={lastAdmin ? "Es el último administrador de la empresa" : undefined}>Retirar</SubmitButton>
                      </ActionForm>
                    </div>
                  ) : <Badge>{ROLE_LABELS[m.role]}</Badge>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Invitar a una persona" description="El acceso es solo por invitación. La invitación vence y solo puede usarse una vez por el correo invitado.">
          {!props.emailConfigured && !demo && (
            <div className="mb-3"><Alert tone="warn">El envío de correo no está configurado: al invitar se mostrará un enlace para compartir manualmente por un canal seguro.</Alert></div>
          )}
          {actions ? (
            <ActionForm action={actions.invite} className="space-y-3">
              <input type="hidden" name="org" value={props.orgSlug} />
              <Field label="Correo" htmlFor="inv-email"><input id="inv-email" name="email" type="email" required className={inputClass} disabled={Boolean(reason)} /></Field>
              <Field label="Rol" htmlFor="inv-role">
                <select id="inv-role" name="role" defaultValue="viewer" className={inputClass} disabled={Boolean(reason)}>
                  {ORG_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </Field>
              <Field label="Vigencia" htmlFor="inv-ttl">
                <select id="inv-ttl" name="ttl" defaultValue="168" className={inputClass} disabled={Boolean(reason)}>
                  <option value="24">1 día</option><option value="72">3 días</option><option value="168">7 días</option><option value="336">14 días</option>
                </select>
              </Field>
              <SubmitButton disabledReason={reason}>Crear invitación</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-muted">{DEMO_REASON}.</p>}
          {reason && <p className="mt-2 text-xs text-muted">{reason}.</p>}
        </Card>
      </div>
      {(canManage || demo) && (
        <Card title="Invitaciones" className="mt-6">
          {props.invitations.length === 0 ? <p className="text-sm text-muted">No hay invitaciones.</p> : (
            <ul className="divide-y divide-line">
              {props.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{i.email} <span className="font-normal text-muted">· {ROLE_LABELS[i.role]}</span></p>
                    <p className="text-xs text-muted">Vence {formatDateTime(i.expiresAt, props.timezone)} · {DELIVERY[i.delivery] ?? i.delivery}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={INV_STATUS[i.status].tone}>{INV_STATUS[i.status].label}</Badge>
                    {i.status === "pending" && actions && (
                      <ActionForm action={actions.revoke}>
                        <input type="hidden" name="org" value={props.orgSlug} /><input type="hidden" name="invitation" value={i.id} />
                        <SubmitButton variant="secondary" disabledReason={reason}>Revocar</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card title="Matriz de permisos" className="mt-6"><PermissionMatrix /></Card>
    </>
  );
}

// =============================================================================
// Configuración
// =============================================================================
export interface SettingsData {
  name: string;
  logoUrl: string | null;
  displayCurrency: string | null;
  timezone: string;
  ga4LeadEventName: string | null;
  metaLeadActionType: string | null;
  metaPurchaseActionType: string | null;
  syncFrequencyHours: number;
  attributionRefreshDays: number;
}
export interface AuditData { id: string; createdAt: string; actor: string; actorType: string; action: string; target: string | null; details: string }

const COMMON_TZ = ["America/Mexico_City", "America/Monterrey", "America/Tijuana", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/New_York", "America/Los_Angeles", "Europe/Madrid", "UTC"];

export function SettingsView(props: { orgSlug: string; demo: boolean; settings: SettingsData; audit: AuditData[] | null; timezone: string; action?: Action }) {
  const s = props.settings;
  const reason = props.demo ? DEMO_REASON : undefined;
  const tzs = COMMON_TZ.includes(s.timezone) ? COMMON_TZ : [s.timezone, ...COMMON_TZ];
  return (
    <>
      <PageHeader title="Configuración" description="Preferencias de la empresa. No modifican la moneda ni la zona horaria con que reportan las fuentes." />
      <Card title="Preferencias">
        {props.action ? (
          <ActionForm action={props.action} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="org" value={props.orgSlug} />
            <Field label="Nombre de la empresa" htmlFor="s-name"><input id="s-name" name="name" defaultValue={s.name} required minLength={2} maxLength={120} className={inputClass} /></Field>
            <Field label="URL del logotipo (https)" htmlFor="s-logo" hint="Imagen pública por HTTPS."><input id="s-logo" name="logo_url" type="url" defaultValue={s.logoUrl ?? ""} className={inputClass} /></Field>
            <Field label="Zona horaria de la empresa" htmlFor="s-tz" hint="Define los periodos predefinidos ('últimos 7 días'). Cada cuenta conserva la suya.">
              <select id="s-tz" name="timezone" defaultValue={s.timezone} className={inputClass}>{tzs.map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Moneda de presentación preferida" htmlFor="s-cur" hint="Sin conversión: si hay varias monedas se muestran por separado.">
              <input id="s-cur" name="display_currency" defaultValue={s.displayCurrency ?? ""} pattern="[A-Za-z]{3}" maxLength={3} className={inputClass} />
            </Field>
            <Field label="Evento de GA4 que cuenta como prospecto" htmlFor="s-ga4" hint="Nombre exacto del evento clave, p. ej. generate_lead.">
              <input id="s-ga4" name="ga4_lead_event_name" defaultValue={s.ga4LeadEventName ?? ""} pattern="[A-Za-z0-9_]{1,40}" className={inputClass} />
            </Field>
            <Field label="Acción de Meta que cuenta como prospecto" htmlFor="s-mlead" hint="Tipo de acción exacto (ver Publicidad → Tipos de acción), p. ej. lead.">
              <input id="s-mlead" name="meta_lead_action_type" defaultValue={s.metaLeadActionType ?? ""} pattern="[a-z0-9_.]{1,80}" className={inputClass} />
            </Field>
            <Field label="Acción de Meta con valor de compra" htmlFor="s-mpur" hint="Se usa para valor de conversión atribuido y ROAS. Elige uno solo para no duplicar.">
              <input id="s-mpur" name="meta_purchase_action_type" defaultValue={s.metaPurchaseActionType ?? ""} pattern="[a-z0-9_.]{1,80}" className={inputClass} />
            </Field>
            <Field label="Frecuencia de actualización automática" htmlFor="s-freq">
              <select id="s-freq" name="sync_frequency_hours" defaultValue={String(s.syncFrequencyHours)} className={inputClass}>
                <option value="6">Cada 6 horas</option><option value="12">Cada 12 horas</option><option value="24">Diaria</option><option value="48">Cada 2 días</option><option value="168">Semanal</option>
              </select>
            </Field>
            <Field label="Días recientes a reconsultar" htmlFor="s-attr" hint="Recoge cambios de atribución tardíos (1–28 días).">
              <input id="s-attr" name="attribution_refresh_days" type="number" min={1} max={28} defaultValue={s.attributionRefreshDays} className={inputClass} />
            </Field>
            <div className="md:col-span-2"><SubmitButton disabledReason={reason}>Guardar cambios</SubmitButton></div>
          </ActionForm>
        ) : (
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div><dt className="text-muted">Nombre</dt><dd>{s.name}</dd></div>
            <div><dt className="text-muted">Zona horaria</dt><dd>{s.timezone}</dd></div>
            <div><dt className="text-muted">Prospecto GA4</dt><dd>{s.ga4LeadEventName ?? "Sin definir"}</dd></div>
            <div><dt className="text-muted">Prospecto Meta</dt><dd>{s.metaLeadActionType ?? "Sin definir"}</dd></div>
            <div className="md:col-span-2 text-xs text-muted">{DEMO_REASON}: los cambios no se guardan.</div>
          </dl>
        )}
      </Card>
      {props.audit && (
        <Card title="Registro de actividad" className="mt-6" description="Acciones administrativas, conexiones, exportaciones y accesos de soporte.">
          <AuditTable rows={props.audit} timezone={props.timezone} />
        </Card>
      )}
    </>
  );
}

export function AuditTable({ rows, timezone, showOrg }: { rows: Array<AuditData & { org?: string | null }>; timezone: string; showOrg?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Sin actividad registrada.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Registro de actividad">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-surface-2 text-left text-xs text-muted">
          <tr><th className="p-2">Fecha</th>{showOrg && <th className="p-2">Empresa</th>}<th className="p-2">Actor</th><th className="p-2">Acción</th><th className="p-2">Detalle</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap p-2">{formatDateTime(r.createdAt, timezone)}</td>
              {showOrg && <td className="p-2">{r.org ?? "—"}</td>}
              <td className="p-2">{r.actor}{r.actorType === "platform_admin" && <Badge tone="warn">plataforma</Badge>}</td>
              <td className="p-2 font-mono text-xs">{r.action}</td>
              <td className="max-w-md break-words p-2 text-xs text-muted">{r.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Reportes / exportaciones
// =============================================================================
export function ReportsView(props: { exportBase: string; canExport: boolean; demo: boolean; query: string; presetLabel: string }) {
  const kinds = Object.keys(EXPORT_LABELS) as ExportKind[];
  return (
    <>
      <PageHeader title="Reportes" description="Descarga tablas en CSV con los filtros actuales del reporte." />
      <Card title="Exportar CSV" description={`Periodo y filtros de la URL actual (${props.presetLabel}). Incluye periodo, fuente y moneda; compatible con acentos en Excel.`}>
        {!props.canExport && <div className="mb-3"><Alert tone="warn">Tu rol puede consultar pero no exportar. Pide el rol Analista a un administrador.</Alert></div>}
        <ul className="grid gap-2 md:grid-cols-2">
          {kinds.map((k) => (
            <li key={k} className="flex items-center justify-between gap-2 rounded-md border border-line p-3 text-sm">
              <span>{EXPORT_LABELS[k]}</span>
              {props.canExport ? (
                <a className="min-h-9 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2" href={`${props.exportBase}?kind=${k}${props.query ? `&${props.query}` : ""}`} download>
                  Descargar CSV
                </a>
              ) : <button disabled title="Requiere permiso de exportación" className="min-h-9 rounded-md border border-line px-3 text-sm opacity-50">Descargar CSV</button>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Las exportaciones se generan al momento, respetan tus permisos y no crean enlaces públicos. Límite: 50 000 filas por archivo.{props.demo ? " En la demostración contienen datos ficticios." : ""}</p>
        <HelpTip label="Seguridad de CSV">Los textos que empiezan con =, +, - o @ se neutralizan con un apóstrofo para que la hoja de cálculo no los ejecute como fórmulas.</HelpTip>
      </Card>
      <h2 className="mb-3 mt-8 text-base font-semibold">Próximamente</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {PLANNED_SOURCES.filter((s) => s.category === "reporting").map((s) => <ComingSoon key={s.id} name={s.name} description={s.description} />)}
      </div>
    </>
  );
}

export { PRESET_LABELS };
