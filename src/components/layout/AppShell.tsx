import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { can, PERMISSION_LABELS, ROLE_LABELS, type EffectiveRole } from "@/lib/authz/permissions";
import { ORG_NAV } from "./nav";
import { NavLink } from "./NavLink";
import { cx } from "@/components/ui/primitives";

export interface ShellOrg {
  slug: string;
  name: string;
  status?: string;
}

export function BrandMark({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logoPath} alt="" width={28} height={28} />
      <span className={compact ? "hidden sm:inline" : undefined}>{brand.name}</span>
    </Link>
  );
}

export function AppShell({
  basePath,
  org,
  orgs,
  role,
  userLabel,
  isPlatformAdmin,
  banner,
  orgHrefPrefix,
  children,
  logoutSlot,
}: {
  basePath: string;
  org: ShellOrg;
  orgs: ShellOrg[];
  role: EffectiveRole;
  userLabel: string;
  isPlatformAdmin: boolean;
  banner?: ReactNode;
  orgHrefPrefix: string;
  children: ReactNode;
  logoutSlot?: ReactNode;
}) {
  const nav = (
    <ul className="flex flex-col gap-0.5">
      {ORG_NAV.map((item) => {
        const allowed = can(role, item.permission);
        return (
          <li key={item.segment}>
            {allowed ? (
              <NavLink href={`${basePath}/${item.segment}`}>{item.label}</NavLink>
            ) : (
              <span
                aria-disabled="true"
                title={`Requiere permiso: ${PERMISSION_LABELS[item.permission]}`}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-muted/70"
              >
                {item.label}
                <span className="sr-only"> (no disponible: requiere permiso «{PERMISSION_LABELS[item.permission]}»)</span>
                <span aria-hidden className="text-[10px] uppercase">sin acceso</span>
              </span>
            )}
          </li>
        );
      })}
      {isPlatformAdmin && (
        <li className="mt-3 border-t border-line pt-3">
          <NavLink href="/admin/empresas">Administración de plataforma</NavLink>
        </li>
      )}
    </ul>
  );

  const orgSwitcher = (
    <details className="relative">
      <summary className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm" aria-label="Cambiar de empresa">
        <span className="max-w-[12rem] truncate font-medium">{org.name}</span>
        <span aria-hidden>▾</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-line bg-surface p-1 shadow-lg">
        <p className="px-3 py-1.5 text-xs text-muted">Tus empresas</p>
        <ul>
          {orgs.map((o) => (
            <li key={o.slug}>
              <Link
                href={`${orgHrefPrefix}/${o.slug}/resumen`}
                aria-current={o.slug === org.slug ? "true" : undefined}
                className={cx("flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-surface-2", o.slug === org.slug && "font-semibold")}
              >
                <span className="truncate">{o.name}</span>
                {o.status === "suspended" && <span className="text-xs text-danger">suspendida</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );

  return (
    <div className="min-h-screen">
      {banner}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <details className="lg:hidden">
              <summary className="flex min-h-10 min-w-10 items-center justify-center rounded-md border border-line" aria-label="Abrir menú">
                ☰
              </summary>
              <nav aria-label="Navegación principal (móvil)" className="absolute left-0 right-0 z-30 mt-2 border-b border-line bg-surface p-3 shadow-lg">
                {nav}
              </nav>
            </details>
            <BrandMark href={`${basePath}/resumen`} compact />
          </div>
          <div className="flex items-center gap-2">
            {orgSwitcher}
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-medium">{userLabel}</p>
              <p className="text-muted">{ROLE_LABELS[role]}</p>
            </div>
            {logoutSlot}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-5">
        <nav aria-label="Navegación principal" className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">{nav}</div>
        </nav>
        <main id="contenido" className="min-w-0 flex-1 overflow-x-clip">
          {children}
        </main>
      </div>
    </div>
  );
}
