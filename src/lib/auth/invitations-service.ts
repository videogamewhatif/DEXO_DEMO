import "server-only";
import { serverEnv } from "@/config/env";
import { AppError, toAppError } from "@/lib/errors";
import { withPrivilegedDb } from "@/lib/db/privileged";
import { withUserDb } from "@/lib/db/user-db";
import type { SessionIdentity } from "@/lib/db/types";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { sendInvitationEmail, type DeliveryResult } from "@/lib/email/mailer";
import type { OrgRole } from "@/lib/authz/permissions";
import { createSupabaseAdminClient, createSupabaseServerClient } from "./supabase";

const TOKEN_RE = /^[A-Za-z0-9_-]{30,100}$/;

export function invitationLink(token: string) {
  return new URL(`/invitacion/${token}`, serverEnv().APP_URL).toString();
}

export interface CreatedInvitation {
  id: string;
  delivery: DeliveryResult;
  /** Solo se devuelve si el correo NO se envió, para compartirlo manualmente una vez. */
  manualLink: string | null;
}

export async function createInvitation(identity: SessionIdentity, organizationId: string, email: string, role: OrgRole, ttlHours = 168): Promise<CreatedInvitation> {
  const token = randomToken(32);
  const { id, orgName } = await withUserDb(identity, async (db) => {
    try {
      const r = await db.query<{ id: string }>("select nexo.create_invitation($1, $2, $3, $4, $5) as id", [organizationId, email, role, sha256Hex(token), ttlHours]);
      const o = await db.query<{ name: string }>("select name from nexo.organizations where id = $1", [organizationId]);
      return { id: r.rows[0]!.id, orgName: o.rows[0]?.name ?? "" };
    } catch (err) {
      throw toAppError(err);
    }
  });
  const link = invitationLink(token);
  const delivery = await sendInvitationEmail({ to: email.toLowerCase(), organizationName: orgName, role, link, expiresAt: new Date(Date.now() + ttlHours * 3_600_000) });
  await withUserDb(identity, (db) => db.query("select nexo.set_invitation_delivery($1, $2)", [id, delivery.status]));
  return { id, delivery, manualLink: delivery.status === "sent" ? null : link };
}

export type InvitationPreview =
  | { state: "valid"; organizationName: string; organizationSlug: string; email: string; role: OrgRole; expiresAt: string; accountExists: boolean }
  | { state: "invalid" | "expired" | "revoked" | "used" | "suspended" };

/** Consulta privilegiada acotada: solo por hash del token presentado. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!TOKEN_RE.test(token)) return { state: "invalid" };
  return withPrivilegedDb(async (db) => {
    const { rows } = await db.query<{
      email: string;
      role: OrgRole;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
      name: string;
      slug: string;
      status: string;
      account_exists: boolean;
    }>(
      `select i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, o.name, o.slug, o.status::text as status,
              exists (select 1 from auth.users u where lower(u.email) = i.email) as account_exists
         from nexo.invitations i join nexo.organizations o on o.id = i.organization_id
        where i.token_hash = $1`,
      [sha256Hex(token)],
    );
    const r = rows[0];
    if (!r) return { state: "invalid" };
    if (r.revoked_at) return { state: "revoked" };
    if (r.accepted_at) return { state: "used" };
    if (r.expires_at.getTime() <= Date.now()) return { state: "expired" };
    if (r.status !== "active") return { state: "suspended" };
    return { state: "valid", organizationName: r.name, organizationSlug: r.slug, email: r.email, role: r.role, expiresAt: r.expires_at.toISOString(), accountExists: r.account_exists };
  });
}

/** Acepta con la sesión actual (el correo de la sesión debe coincidir: lo verifica la BD). */
export async function acceptInvitation(identity: SessionIdentity, token: string): Promise<string> {
  if (!TOKEN_RE.test(token)) throw new AppError("invitation_invalid");
  return withUserDb(identity, async (db) => {
    try {
      const r = await db.query<{ org: string }>("select nexo.accept_invitation($1) as org", [sha256Hex(token)]);
      const s = await db.query<{ slug: string }>("select slug from nexo.organizations where id = $1", [r.rows[0]!.org]);
      return s.rows[0]?.slug ?? "";
    } catch (err) {
      throw toAppError(err);
    }
  });
}

/**
 * Alta de cuenta desde una invitación válida para un correo sin cuenta.
 * La posesión del token (enviado a ese correo) confirma el correo.
 * Después inicia sesión y acepta la invitación con la nueva identidad.
 */
export async function registerFromInvitation(token: string, fullName: string, password: string): Promise<string> {
  const preview = await previewInvitation(token);
  if (preview.state !== "valid") throw new AppError(`invitation_${preview.state === "suspended" ? "invalid" : preview.state}`);
  if (preview.accountExists) throw new AppError("account_exists", "Ya existe una cuenta con este correo. Inicia sesión para aceptar.");
  const admin = createSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({
    email: preview.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw new AppError("account_create_failed", "No se pudo crear la cuenta. Verifica que la contraseña cumpla la política e inténtalo de nuevo.");
  }
  const supabase = await createSupabaseServerClient();
  const signIn = await supabase.auth.signInWithPassword({ email: preview.email, password });
  if (signIn.error || !signIn.data.user) throw new AppError("not_authenticated");
  return acceptInvitation({ userId: signIn.data.user.id, email: preview.email }, token);
}
