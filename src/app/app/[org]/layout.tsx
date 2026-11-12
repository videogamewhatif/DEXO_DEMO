import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SuspendedOrg } from "@/components/views/StatusViews";
import { requireOrgContext } from "@/lib/orgs/context";

export const dynamic = "force-dynamic";

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrgContext(slug);
  const support = ctx.org.access === "support";
  return (
    <AppShell
      basePath={`/app/${ctx.org.slug}`}
      org={ctx.org}
      orgs={ctx.orgs}
      role={ctx.org.role}
      userLabel={ctx.identity.email}
      isPlatformAdmin={ctx.isPlatformAdmin}
      orgHrefPrefix="/app"
      banner={support ? (
        <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-warn" role="status">
          Acceso de soporte temporal y auditado (solo lectura). La empresa puede ver este acceso en su registro de actividad.
        </div>
      ) : undefined}
      logoutSlot={
        <form action="/auth/logout" method="post">
          <button type="submit" className="min-h-10 rounded-md border border-line px-3 text-sm hover:bg-surface-2">Salir</button>
        </form>
      }
    >
      {ctx.org.status === "suspended" ? <SuspendedOrg name={ctx.org.name} /> : children}
    </AppShell>
  );
}
