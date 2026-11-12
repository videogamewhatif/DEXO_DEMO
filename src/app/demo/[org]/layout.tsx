import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { DEMO_ORGS, getDemoOrg } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";
import { isDemoEnabled } from "@/config/env";
import { LinkButton } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function DemoOrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  if (!isDemoEnabled()) notFound();
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  const role = await getDemoRole();
  return (
    <AppShell
      basePath={`/demo/${org.slug}`}
      org={org}
      orgs={DEMO_ORGS}
      role={role}
      userLabel="Usuario de demostración"
      isPlatformAdmin={false}
      orgHrefPrefix="/demo"
      banner={<DemoBanner role={role} />}
      logoutSlot={<LinkButton href="/" variant="secondary">Salir de la demo</LinkButton>}
    >
      {children}
    </AppShell>
  );
}
