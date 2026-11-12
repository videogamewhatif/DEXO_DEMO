"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/forms/ActionForm";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { withUserDb } from "@/lib/db/user-db";
import { toAppError } from "@/lib/errors";
import { createInvitation } from "@/lib/auth/invitations-service";

const fail = (e: unknown): ActionState => ({ ok: false, message: toAppError(e).message });

export async function createOrgAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const identity = await requirePlatformAdmin();
    const d = z
      .object({
        name: z.string().trim().min(2).max(120),
        slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/),
        timezone: z.string().min(1).max(64),
        display_currency: z.union([z.literal(""), z.string().regex(/^[A-Za-z]{3}$/)]),
      })
      .safeParse(Object.fromEntries(fd));
    if (!d.success) return { ok: false, message: "Revisa nombre, identificador (minúsculas, números y guiones) y zona horaria." };
    await withUserDb(identity, (db) => db.query("select nexo.platform_create_organization($1,$2,$3,$4)", [d.data.name, d.data.slug, d.data.timezone, d.data.display_currency]));
    revalidatePath("/admin/empresas");
    return { ok: true, message: `Empresa «${d.data.name}» creada. Ahora invita a su administrador.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setOrgStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const identity = await requirePlatformAdmin();
    const org = z.uuid().parse(fd.get("org"));
    const status = z.enum(["active", "suspended"]).parse(fd.get("status"));
    const reason = String(fd.get("reason") ?? "").slice(0, 500);
    await withUserDb(identity, (db) => db.query("select nexo.platform_set_organization_status($1,$2,$3)", [org, status, reason || null]));
    revalidatePath("/admin/empresas");
    return { ok: true, message: status === "suspended" ? "Empresa suspendida. El histórico se conserva." : "Empresa reactivada." };
  } catch (e) {
    return fail(e);
  }
}

export async function inviteOrgAdminAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const identity = await requirePlatformAdmin();
    const org = z.uuid().parse(fd.get("org"));
    const email = z.email().max(254).safeParse(fd.get("email"));
    if (!email.success) return { ok: false, message: "Correo inválido." };
    const r = await createInvitation(identity, org, email.data.toLowerCase(), "org_admin");
    revalidatePath("/admin/empresas");
    return r.delivery.status === "sent"
      ? { ok: true, message: "Invitación enviada por correo." }
      : { ok: true, message: "Invitación creada; el correo no se envió (ver configuración SMTP). Comparte el enlace por un canal seguro.", detail: r.manualLink };
  } catch (e) {
    return fail(e);
  }
}

export async function retryJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const identity = await requirePlatformAdmin();
    const job = z.uuid().parse(fd.get("job"));
    await withUserDb(identity, (db) => db.query("select nexo.platform_retry_job($1)", [job]));
    revalidatePath("/admin/sincronizaciones");
    return { ok: true, message: "Reintento programado." };
  } catch (e) {
    return fail(e);
  }
}

export async function startSupportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const identity = await requirePlatformAdmin();
    const org = z.uuid().parse(fd.get("org"));
    const reason = z.string().trim().min(10).max(500).safeParse(fd.get("reason"));
    if (!reason.success) return { ok: false, message: "Indica el motivo del acceso (mínimo 10 caracteres). Quedará visible para la empresa." };
    const minutes = z.coerce.number().int().min(5).max(240).parse(fd.get("minutes") ?? 60);
    slug = await withUserDb(identity, async (db) => {
      await db.query("select nexo.start_support_session($1,$2,$3)", [org, reason.data, minutes]);
      return (await db.query<{ slug: string }>("select slug from nexo.organizations where id = $1", [org])).rows[0]!.slug;
    });
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/${slug}/resumen`);
}
