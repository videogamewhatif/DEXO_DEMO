import Link from "next/link";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/auth/session";
import { getIsPlatformAdmin, getMyOrganizations } from "@/lib/orgs/context";
import { BrandMark } from "@/components/layout/AppShell";
import { Alert, Badge, LinkButton } from "@/components/ui/primitives";
import { ROLE_LABELS } from "@/lib/authz/permissions";
import { ERROR_MESSAGES } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function AppIndex({ searchParams }: { searchParams: Promise<{ mensaje?: string; error_integracion?: string }> }) {
  const identity = await requireIdentity("/app");
  const sp = await searchParams;
  const [orgs, isAdmin] = await Promise.all([getMyOrganizations(identity), getIsPlatformAdmin(identity)]);
  const active = orgs.filter((o) => o.status === "active");
  if (active.length === 1 && orgs.length === 1 && !isAdmin && !sp.mensaje && !sp.error_integracion) redirect(`/app/${active[0]!.slug}/resumen`);
  return (
    <main id="contenido" className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <BrandMark href="/app" />
        <form action="/auth/logout" method="post"><button className="min-h-10 rounded-md border border-line px-3 text-sm">Salir</button></form>
      </div>
      {sp.mensaje === "contrasena-actualizada" && <div className="mt-6"><Alert tone="ok">Tu contraseña se actualizó.</Alert></div>}
      {sp.error_integracion && <div className="mt-6"><Alert tone="danger" title="No se pudo completar la conexión">{ERROR_MESSAGES[sp.error_integracion] ?? ERROR_MESSAGES.unknown}</Alert></div>}
      <h1 className="mt-8 text-2xl font-semibold">Tus empresas</h1>
      {orgs.length === 0 && (
        <p className="mt-3 text-muted">Aún no perteneces a ninguna empresa. Pide a un administrador que te invite.</p>
      )}
      <ul className="mt-4 space-y-2">
        {orgs.map((o) => (
          <li key={`${o.id}-${o.access}`}>
            <Link href={`/app/${o.slug}/resumen`} className="flex items-center justify-between rounded-lg border border-line bg-surface p-4 hover:border-brand">
              <span className="font-medium">{o.name}</span>
              <span className="flex gap-2">
                <Badge>{ROLE_LABELS[o.role]}</Badge>
                {o.status === "suspended" && <Badge tone="danger">Suspendida</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {isAdmin && <div className="mt-6"><LinkButton href="/admin/empresas" variant="secondary">Administración de plataforma</LinkButton></div>}
    </main>
  );
}
