import Link from "next/link";
import { AuthCard } from "@/components/forms/AuthCard";
import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { previewInvitation } from "@/lib/auth/invitations-service";
import { getSessionIdentity } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/authz/permissions";
import { isAuthConfigured } from "@/config/env";
import { formatDateTime } from "@/lib/format";
import { acceptAction, registerAction } from "./actions";

export const metadata = { title: "Invitación" };
export const dynamic = "force-dynamic";

const STATES = {
  invalid: "El enlace de invitación no es válido.",
  expired: "Esta invitación venció. Pide una nueva a tu administrador.",
  revoked: "Esta invitación fue revocada.",
  used: "Esta invitación ya fue utilizada.",
  suspended: "La empresa de esta invitación no está activa.",
} as const;

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAuthConfigured()) return <AuthCard title="Invitación"><Alert tone="warn">La autenticación no está configurada en este entorno.</Alert></AuthCard>;
  const preview = await previewInvitation(token);
  if (preview.state !== "valid") {
    return <AuthCard title="Invitación" footer={<Link href="/login" className="text-brand underline">Ir a iniciar sesión</Link>}><Alert tone="warn">{STATES[preview.state]}</Alert></AuthCard>;
  }
  const identity = await getSessionIdentity();
  const header = (
    <p className="mb-4 text-sm">
      Te invitaron a <strong>{preview.organizationName}</strong> como <strong>{ROLE_LABELS[preview.role]}</strong>. Invitación para <strong>{preview.email}</strong>, vence {formatDateTime(preview.expiresAt, "UTC")} (UTC).
    </p>
  );
  if (identity) {
    if (identity.email !== preview.email) {
      return (
        <AuthCard title="Invitación">
          {header}
          <Alert tone="warn">Iniciaste sesión como {identity.email}. Esta invitación es para otro correo: cierra sesión e inicia con el correo invitado.</Alert>
          <form action="/auth/logout" method="post" className="mt-4"><button className="min-h-10 rounded-md border border-line px-3 text-sm">Cerrar sesión</button></form>
        </AuthCard>
      );
    }
    return (
      <AuthCard title="Aceptar invitación">
        {header}
        <ActionForm action={acceptAction}><input type="hidden" name="token" value={token} /><SubmitButton>Aceptar y entrar</SubmitButton></ActionForm>
      </AuthCard>
    );
  }
  if (preview.accountExists) {
    return (
      <AuthCard title="Invitación">
        {header}
        <p className="text-sm">Ya tienes una cuenta con este correo. Inicia sesión para aceptar.</p>
        <Link href={`/login?next=${encodeURIComponent(`/invitacion/${token}`)}`} className="mt-4 inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Iniciar sesión</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Crear tu cuenta">
      {header}
      <ActionForm action={registerAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Correo" htmlFor="email"><input id="email" value={preview.email} readOnly className={`${inputClass} bg-surface-2`} /></Field>
        <Field label="Nombre completo" htmlFor="full_name"><input id="full_name" name="full_name" required minLength={2} maxLength={120} autoComplete="name" className={inputClass} /></Field>
        <Field label="Contraseña" htmlFor="password" hint="Mínimo 10 caracteres."><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
        <Field label="Confirmar contraseña" htmlFor="confirm"><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
        <SubmitButton>Crear cuenta y aceptar</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
