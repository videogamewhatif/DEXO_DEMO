"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAuthConfigured, serverEnv } from "@/config/env";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import { safeNextPath } from "@/lib/auth/session";
import type { ActionState } from "@/components/forms/ActionForm";

const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200), next: z.string().optional() });

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isAuthConfigured()) return { ok: false, message: "La autenticación no está configurada en este entorno. Revisa docs/guia-supabase.md." };
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Escribe un correo y una contraseña válidos." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email.toLowerCase(), password: parsed.data.password });
  if (error) {
    // Mensaje genérico: no revela si la cuenta existe.
    const throttled = error.status === 429;
    return { ok: false, message: throttled ? "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." : "Correo o contraseña incorrectos." };
  }
  redirect(safeNextPath(parsed.data.next));
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isAuthConfigured()) return { ok: false, message: "La autenticación no está configurada en este entorno." };
  const email = z.email().max(254).safeParse(formData.get("email"));
  if (!email.success) return { ok: false, message: "Escribe un correo válido." };
  const supabase = await createSupabaseServerClient();
  const redirectTo = new URL("/auth/confirm?next=/restablecer", serverEnv().APP_URL).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data.toLowerCase(), { redirectTo });
  if (error && error.status === 429) return { ok: false, message: "Demasiadas solicitudes. Espera unos minutos." };
  if (error && error.status && error.status >= 500) return { ok: false, message: "El servicio de autenticación no respondió. Inténtalo más tarde." };
  return {
    ok: true,
    message: "Solicitud registrada. Si existe una cuenta con ese correo, el servicio de autenticación enviará un enlace para restablecer la contraseña.",
  };
}

const passwordSchema = z
  .object({ password: z.string().min(10, "Mínimo 10 caracteres").max(200), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, message: "El enlace expiró o ya se usó. Solicita uno nuevo." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: "No se pudo actualizar la contraseña. Verifica que cumpla la política de seguridad." };
  redirect("/app?mensaje=contrasena-actualizada");
}
