"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/forms/ActionForm";
import { requireOrgContext } from "@/lib/orgs/context";
import { withUserDb } from "@/lib/db/user-db";
import { AppError, toAppError } from "@/lib/errors";
import { createInvitation } from "@/lib/auth/invitations-service";
import { disconnectIntegration, refreshAccountList } from "@/lib/integrations/service";
import { ORG_ROLES } from "@/lib/authz/permissions";

/**
 * Acciones de servidor de una empresa. Cada una:
 *  1. resuelve la empresa entre las del usuario (requireOrgContext: sesión + membresía),
 *  2. ejecuta una función de BD que vuelve a verificar el permiso con auth.uid().
 * Ningún identificador de usuario actuante proviene del formulario.
 */

const uuid = z.uuid();
const slug = z.string().regex(/^[a-z0-9-]{1,48}$/);

async function ctxFrom(fd: FormData) {
  const s = slug.safeParse(fd.get("org"));
  if (!s.success) throw new AppError("validation");
  return requireOrgContext(s.data);
}

function fail(err: unknown): ActionState {
  const e = toAppError(err);
  return { ok: false, message: e.message };
}

function done(slugValue: string, message: string, section: string): ActionState {
  revalidatePath(`/app/${slugValue}/${section}`);
  return { ok: true, message };
}

// ---- Equipo -----------------------------------------------------------------
export async function inviteMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const input = z
      .object({ email: z.email().max(254), role: z.enum(ORG_ROLES), ttl: z.coerce.number().int().refine((n) => [24, 72, 168, 336].includes(n)) })
      .safeParse({ email: fd.get("email"), role: fd.get("role"), ttl: fd.get("ttl") ?? 168 });
    if (!input.success) return { ok: false, message: "Revisa el correo y el rol." };
    const res = await createInvitation(ctx.identity, ctx.org.id, input.data.email.toLowerCase(), input.data.role, input.data.ttl);
    revalidatePath(`/app/${ctx.org.slug}/equipo`);
    if (res.delivery.status === "sent") return { ok: true, message: `Invitación creada y enviada por correo a ${input.data.email}.` };
    return {
      ok: true,
      message:
        res.delivery.status === "not_configured"
          ? "Invitación creada. No se envió correo porque el envío no está configurado: comparte el enlace por un canal seguro."
          : "Invitación creada, pero el correo no pudo enviarse. Comparte el enlace por un canal seguro o revoca y reintenta.",
      detail: res.manualLink,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeInvitationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const id = uuid.parse(fd.get("invitation"));
    await withUserDb(ctx.identity, (db) => db.query("select nexo.revoke_invitation($1)", [id]));
    return done(ctx.org.slug, "Invitación revocada.", "equipo");
  } catch (err) {
    return fail(err);
  }
}

export async function changeRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const user = uuid.parse(fd.get("user"));
    const role = z.enum(ORG_ROLES).parse(fd.get("role"));
    await withUserDb(ctx.identity, (db) => db.query("select nexo.update_member_role($1, $2, $3)", [ctx.org.id, user, role]));
    return done(ctx.org.slug, "Rol actualizado.", "equipo");
  } catch (err) {
    return fail(err);
  }
}

export async function removeMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const user = uuid.parse(fd.get("user"));
    await withUserDb(ctx.identity, (db) => db.query("select nexo.remove_member($1, $2)", [ctx.org.id, user]));
    return done(ctx.org.slug, "Persona retirada de la empresa.", "equipo");
  } catch (err) {
    return fail(err);
  }
}

// ---- Configuración ------------------------------------------------------------
const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logo_url: z.union([z.literal(""), z.url().startsWith("https://").max(500)]),
  display_currency: z.union([z.literal(""), z.string().regex(/^[A-Za-z]{3}$/)]),
  timezone: z.string().min(1).max(64),
  ga4_lead_event_name: z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9_]{1,40}$/)]),
  meta_lead_action_type: z.union([z.literal(""), z.string().regex(/^[a-z0-9_.]{1,80}$/)]),
  meta_purchase_action_type: z.union([z.literal(""), z.string().regex(/^[a-z0-9_.]{1,80}$/)]),
  sync_frequency_hours: z.coerce.number().int().min(6).max(168),
  attribution_refresh_days: z.coerce.number().int().min(1).max(28),
});

export async function updateSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const raw = Object.fromEntries(["name", "logo_url", "display_currency", "timezone", "ga4_lead_event_name", "meta_lead_action_type", "meta_purchase_action_type", "sync_frequency_hours", "attribution_refresh_days"].map((k) => [k, fd.get(k) ?? ""]));
    const s = settingsSchema.safeParse(raw);
    if (!s.success) return { ok: false, message: `Revisa el campo «${String(s.error.issues[0]?.path[0] ?? "")}».` };
    const d = s.data;
    await withUserDb(ctx.identity, (db) =>
      db.query("select nexo.update_organization_settings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
        ctx.org.id, d.name, d.logo_url, d.display_currency, d.timezone, d.ga4_lead_event_name, d.meta_lead_action_type, d.meta_purchase_action_type, d.sync_frequency_hours, d.attribution_refresh_days,
      ]),
    );
    revalidatePath(`/app/${ctx.org.slug}`, "layout");
    return { ok: true, message: "Cambios guardados." };
  } catch (err) {
    return fail(err);
  }
}

// ---- Integraciones -------------------------------------------------------------
export async function toggleAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const account = uuid.parse(fd.get("account"));
    const selected = fd.get("selected") === "true";
    await withUserDb(ctx.identity, (db) => db.query("select nexo.set_account_selection($1, $2)", [account, selected]));
    return done(ctx.org.slug, selected ? "Cuenta seleccionada: se programó la importación inicial." : "La cuenta dejó de sincronizarse. El histórico se conserva.", "integraciones");
  } catch (err) {
    return fail(err);
  }
}

export async function requestSyncAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const account = uuid.parse(fd.get("account"));
    await withUserDb(ctx.identity, (db) => db.query("select nexo.request_manual_sync($1)", [account]));
    return done(ctx.org.slug, "Actualización solicitada. El trabajador la procesará en breve.", "integraciones");
  } catch (err) {
    return fail(err);
  }
}

export async function cancelJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const job = uuid.parse(fd.get("job"));
    await withUserDb(ctx.identity, (db) => db.query("select nexo.cancel_sync_job($1)", [job]));
    return done(ctx.org.slug, "Trabajo cancelado.", "integraciones");
  } catch (err) {
    return fail(err);
  }
}

export async function refreshAccountsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const integration = uuid.parse(fd.get("integration"));
    const n = await refreshAccountList(ctx.identity, integration);
    return done(ctx.org.slug, `Lista actualizada: ${n} cuenta(s) autorizada(s).`, "integraciones");
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await ctxFrom(fd);
    const integration = uuid.parse(fd.get("integration"));
    const r = await disconnectIntegration(ctx.identity, integration);
    return done(
      ctx.org.slug,
      r.revoked
        ? "Integración desconectada y autorización revocada en el proveedor. Credenciales eliminadas."
        : "Integración desconectada y credenciales eliminadas. No se confirmó la revocación en el proveedor: puedes retirar el acceso desde la configuración de tu cuenta del proveedor.",
      "integraciones",
    );
  } catch (err) {
    return fail(err);
  }
}
