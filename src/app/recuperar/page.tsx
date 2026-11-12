import Link from "next/link";
import { AuthCard } from "@/components/forms/AuthCard";
import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Field, inputClass } from "@/components/ui/primitives";
import { requestPasswordReset } from "../login/actions";

export const metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AuthCard title="Recuperar contraseña" footer={<Link href="/login" className="text-brand underline">Volver a iniciar sesión</Link>}>
      <p className="mb-4 text-sm text-muted">Escribe tu correo. Si tiene una cuenta, recibirás un enlace para crear una contraseña nueva.</p>
      <ActionForm action={requestPasswordReset} className="space-y-4">
        <Field label="Correo electrónico" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <SubmitButton>Enviar enlace</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
