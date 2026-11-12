import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_ORGS } from "@/lib/demo/data";
import { isDemoEnabled } from "@/config/env";
import { BrandMark } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/primitives";

export const metadata = { title: "Demostración" };
export const dynamic = "force-dynamic";

export default function DemoIndex() {
  if (!isDemoEnabled()) notFound();
  return (
    <main id="contenido" className="mx-auto max-w-3xl px-4 py-10">
      <BrandMark />
      <h1 className="mt-8 text-2xl font-semibold">Demostración</h1>
      <p className="mt-2 text-muted">
        Recorre la plataforma con dos empresas ficticias y 120 días de datos generados. Es una simulación visual: no hay inicio de sesión, no se guarda nada y no se conecta con Google ni Meta.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {DEMO_ORGS.map((o) => (
          <li key={o.slug}>
            <Link href={`/demo/${o.slug}/resumen`} className="block rounded-lg border border-line bg-surface p-4 hover:border-brand">
              <p className="font-semibold">{o.name}</p>
              <p className="mt-1 text-sm text-muted">Zona horaria: {o.timezone}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {o.integrations.map((i) => (
                  <Badge key={i.provider} tone={i.status === "connected" ? "ok" : "warn"}>
                    {i.provider === "meta_ads" ? "Meta Ads" : "GA4"}: {i.status === "connected" ? "conectado" : "requiere reconexión"}
                  </Badge>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
