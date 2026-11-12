import { redirect } from "next/navigation";
import { AuthCard } from "@/components/forms/AuthCard";
import { ActionForm, SubmitButton } from "@/components/forms/ActionForm";
import { Field, inputClass } from "@/components/ui/primitives";
import { getSessionIdentity } from "@/lib/auth/session";
import { updatePassword } from "../login/actions";

export const metadata = { title: "Nueva contraseña" };
export const dynamic = "force-dynamic";

export default async function ResetPage() {
  if (!(await getSessionIdentity())) redirect("/login?error=enlace");
  return (
    <AuthCard title="Crear una contraseña nueva">
      <ActionForm action={updatePassword} className="space-y-4">
        <Field label="Contraseña nueva" htmlFor="password" hint="Mínimo 10 caracteres.">
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        </Field>
        <Field label="Confirmar contraseña" htmlFor="confirm">
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        </Field>
        <SubmitButton>Guardar contraseña</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
