"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/forms/ActionForm";
import { acceptInvitation, registerFromInvitation } from "@/lib/auth/invitations-service";
import { getSessionIdentity } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";

const token = z.string().regex(/^[A-Za-z0-9_-]{30,100}$/);

export async function acceptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const t = token.safeParse(fd.get("token"));
  if (!t.success) return { ok: false, message: "Enlace inválido." };
  const identity = await getSessionIdentity();
  if (!identity) return { ok: false, message: "Inicia sesión para aceptar." };
  let slug: string;
  try {
    slug = await acceptInvitation(identity, t.data);
  } catch (err) {
    return { ok: false, message: toAppError(err).message };
  }
  redirect(`/app/${slug}/resumen`);
}

const registerSchema = z
  .object({ token, full_name: z.string().trim().min(2).max(120), password: z.string().min(10).max(200), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

export async function registerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const p = registerSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Datos inválidos (contraseña mínima de 10 caracteres)." };
  let slug: string;
  try {
    slug = await registerFromInvitation(p.data.token, p.data.full_name, p.data.password);
  } catch (err) {
    return { ok: false, message: toAppError(err).message };
  }
  redirect(`/app/${slug}/resumen`);
}
