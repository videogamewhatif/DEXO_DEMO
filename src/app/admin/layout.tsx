import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/AppShell";
import { NavLink } from "@/components/layout/NavLink";
import { ADMIN_NAV } from "@/components/layout/nav";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const identity = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3"><BrandMark href="/app" /><span className="rounded bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">Administración de plataforma</span></div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{identity.email}</span>
            <Link href="/app" className="underline">Mis empresas</Link>
            <form action="/auth/logout" method="post"><button className="min-h-10 rounded-md border border-line px-3">Salir</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-5 lg:flex-row">
        <nav aria-label="Administración" className="lg:w-56 lg:shrink-0">
          <ul className="flex flex-wrap gap-1 lg:flex-col">{ADMIN_NAV.map((n) => <li key={n.href}><NavLink href={n.href}>{n.label}</NavLink></li>)}</ul>
        </nav>
        <main id="contenido" className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
