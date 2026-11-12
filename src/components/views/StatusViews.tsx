import { Alert, LinkButton, PageHeader, ComingSoon } from "@/components/ui/primitives";
import { PLANNED_SOURCES } from "@/lib/integrations/registry";
import { PERMISSION_LABELS, type Permission } from "@/lib/authz/permissions";

export function Forbidden({ permission }: { permission: Permission }) {
  return (
    <div className="max-w-xl">
      <PageHeader title="Permisos insuficientes" />
      <Alert tone="warn" title="No tienes acceso a esta sección">
        Se requiere el permiso «{PERMISSION_LABELS[permission]}». Si lo necesitas, pide a un administrador de la empresa que actualice tu rol.
      </Alert>
    </div>
  );
}

export function SuspendedOrg({ name }: { name: string }) {
  return (
    <div className="max-w-xl">
      <PageHeader title={name} />
      <Alert tone="danger" title="Empresa suspendida">
        El acceso a los datos de esta empresa está suspendido y no se ejecutan nuevas sincronizaciones. El histórico se conserva. Contacta al administrador de la plataforma.
      </Alert>
      <div className="mt-4"><LinkButton href="/app" variant="secondary">Ver mis empresas</LinkButton></div>
    </div>
  );
}

export function SocialView() {
  const social = PLANNED_SOURCES.filter((s) => s.category === "social");
  return (
    <>
      <PageHeader title="Redes sociales" description="Métricas orgánicas de redes sociales." />
      <div className="mb-4"><Alert tone="info">Este módulo aún no está implementado. No hay datos orgánicos de redes sociales en esta versión; las campañas pagadas de Facebook e Instagram están en Publicidad.</Alert></div>
      <div className="grid gap-3 md:grid-cols-2">{social.map((s) => <ComingSoon key={s.id} name={s.name} description={s.description} />)}</div>
    </>
  );
}
