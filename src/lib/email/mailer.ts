import "server-only";
import nodemailer from "nodemailer";
import { brand } from "@/config/brand";
import { isEmailConfigured, serverEnv } from "@/config/env";
import { safeErrorMessage } from "@/lib/security/redact";
import { ROLE_LABELS, type OrgRole } from "@/lib/authz/permissions";

export type DeliveryResult = { status: "sent" } | { status: "not_configured" } | { status: "failed"; error: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Envía la invitación solo si hay SMTP configurado. Nunca simula un envío. */
export async function sendInvitationEmail(p: { to: string; organizationName: string; role: OrgRole; link: string; expiresAt: Date }): Promise<DeliveryResult> {
  if (!isEmailConfigured()) return { status: "not_configured" };
  const env = serverEnv();
  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    const expires = new Intl.DateTimeFormat(brand.locale, { dateStyle: "long", timeStyle: "short" }).format(p.expiresAt);
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: p.to,
      subject: `Invitación a ${p.organizationName} en ${brand.name}`,
      text: `Te invitaron a ${p.organizationName} en ${brand.name} con el rol ${ROLE_LABELS[p.role]}.\n\nAcepta la invitación aquí: ${p.link}\n\nEl enlace vence el ${expires} y solo puede usarse una vez.`,
      html: `<p>Te invitaron a <strong>${escapeHtml(p.organizationName)}</strong> en ${escapeHtml(brand.name)} con el rol <strong>${escapeHtml(ROLE_LABELS[p.role])}</strong>.</p><p><a href="${escapeHtml(p.link)}">Aceptar invitación</a></p><p>El enlace vence el ${escapeHtml(expires)} y solo puede usarse una vez.</p>`,
    });
    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: safeErrorMessage(err, 200) };
  }
}
