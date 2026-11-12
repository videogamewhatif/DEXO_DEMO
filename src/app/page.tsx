import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { BrandMark } from "@/components/layout/AppShell";
import { LinkButton } from "@/components/ui/primitives";
import { getSessionIdentity } from "@/lib/auth/session";
import { isDemoEnabled } from "@/config/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSessionIdentity()) redirect("/app");
  return (
    <main id="contenido" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <BrandMark />
      <h1 className="mt-8 text-3xl font-semibold">{brand.tagline}</h1>
      <p className="mt-3 text-muted">Publicidad, sitio web y landing pages de cada empresa en un solo lugar, con acceso separado por empresa y rol.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href="/login">Iniciar sesión</LinkButton>
        {isDemoEnabled() && <LinkButton href="/demo" variant="secondary">Ver demostración</LinkButton>}
      </div>
    </main>
  );
}
