import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/forms/AuthCard";
import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { getSessionIdentity, safeNextPath } from "@/lib/auth/session";
import { isAuthConfigured, isDemoEnabled } from "@/config/env";
import { signIn } from "./actions";

export const metadata = { title: "Iniciar sesión" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  enlace: "El enlace no es válido o expiró. Solicita uno nuevo.",
  sesion: "Tu sesión terminó. Inicia sesión de nuevo.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getSessionIdentity()) redirect(safeNextPath(sp.next));
  const configured = isAuthConfigured();
  return (
    <AuthCard
      title="Iniciar sesión"
      footer={isDemoEnabled() ? <>¿Solo quieres explorar? <Link className="text-brand underline" href="/demo">Ver la demostración</Link></> : undefined}
    >
      {!configured && (
        <div className="mb-4"><Alert tone="warn" title="Autenticación no configurada">Este entorno no tiene Supabase configurado. Consulta docs/guia-supabase.md.</Alert></div>
      )}
      {sp.error && ERRORS[sp.error] && <div className="mb-4"><Alert tone="danger">{ERRORS[sp.error]}</Alert></div>}
      <ActionForm action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={safeNextPath(sp.next)} />
        <Field label="Correo electrónico" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
        <div className="flex items-center justify-between">
          <Link href="/recuperar" className="text-sm text-brand underline">¿Olvidaste tu contraseña?</Link>
          <SubmitButton disabledReason={configured ? undefined : "Autenticación no configurada"}>Entrar</SubmitButton>
        </div>
      </ActionForm>
      <p className="mt-6 text-xs text-muted">El acceso es solo por invitación. Si necesitas una cuenta, pide a un administrador de tu empresa que te invite.</p>
    </AuthCard>
  );
}
