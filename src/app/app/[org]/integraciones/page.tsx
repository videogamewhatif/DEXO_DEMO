import { IntegrationsView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { getOrgDetails, requireOrgContext } from "@/lib/orgs/context";
import { loadIntegrations } from "@/lib/orgs/queries";
import { cancelJobAction, disconnectAction, refreshAccountsAction, requestSyncAction, toggleAccountAction } from "../actions";

const FLASH: Record<string, { tone: "ok" | "danger" | "warn"; text: string }> = {
  conectado: { tone: "ok", text: "Conexión completada. Elige qué cuentas sincronizar." },
  error: { tone: "danger", text: "No se pudo completar la conexión." },
};

export default async function Page({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ estado?: string; detalle?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(slug);
  if (ctx.org.status !== "active") return null;
  if (!can(ctx.org.role, "integrations.view")) return <Forbidden permission="integrations.view" />;
  const [details, data] = await Promise.all([getOrgDetails(ctx.identity, ctx.org.id), loadIntegrations(ctx.identity, ctx.org.id)]);
  const flash = sp.estado && FLASH[sp.estado] ? { ...FLASH[sp.estado]!, text: sp.estado === "error" && sp.detalle ? `${FLASH.error!.text} ${sp.detalle.slice(0, 300)}` : FLASH[sp.estado]!.text } : null;
  return (
    <IntegrationsView
      orgSlug={slug}
      timezone={details?.timezone ?? "UTC"}
      demo={false}
      canManage={can(ctx.org.role, "integrations.manage")}
      canSync={can(ctx.org.role, "sync.trigger")}
      flash={flash}
      {...data}
      actions={{ toggleAccount: toggleAccountAction, requestSync: requestSyncAction, refreshAccounts: refreshAccountsAction, disconnect: disconnectAction, cancelJob: cancelJobAction }}
    />
  );
}
