import "server-only";
import { withUserDb } from "@/lib/db/user-db";
import type { SessionIdentity } from "@/lib/db/types";
import type { AccountData, AuditData, ConnectorCardData, InvitationData, JobData, MemberData } from "@/components/views/ManagementViews";
import { listConnectors } from "@/lib/integrations/registry";
import { serverEnv } from "@/config/env";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function tokenPolicy(capabilities: readonly string[]): string {
  if (capabilities.includes("refresh_token")) return "Automática (refresh token)";
  if (capabilities.includes("long_lived_token")) return "Token de ~60 días; requiere reconexión manual al vencer";
  return "Manual";
}

export async function loadIntegrations(identity: SessionIdentity, orgId: string) {
  return withUserDb(identity, async (db) => {
    const integ = await db.query(
      `select id, provider, status::text as status, external_user_label, connected_at, token_expires_at, last_error_code, last_error_message
         from nexo.integrations where organization_id = $1 order by (status = 'disconnected'), updated_at desc`,
      [orgId],
    );
    const acc = await db.query(
      `select pa.id, pa.provider, pa.name, pa.external_id, pa.currency, pa.timezone, pa.external_status, pa.is_selected, pa.last_successful_sync_at,
              coalesce(i.status = 'connected', false) as connected
         from nexo.provider_accounts pa left join nexo.integrations i on i.id = pa.integration_id
        where pa.organization_id = $1 order by pa.provider, pa.name`,
      [orgId],
    );
    const jobs = await db.query(
      `select j.id, pa.name as account_name, j.kind::text as kind, j.status::text as status, j.date_from, j.date_to, j.created_at, j.finished_at,
              j.error_code, j.error_message, j.rows_written, j.attempts, j.run_after
         from nexo.sync_jobs j join nexo.provider_accounts pa on pa.id = j.provider_account_id
        where j.organization_id = $1 order by j.created_at desc limit 30`,
      [orgId],
    );
    const env = serverEnv();
    const connectors: ConnectorCardData[] = listConnectors().map((c) => {
      const row = integ.rows.find((r) => r.provider === c.descriptor.id);
      const status = c.configStatus(env);
      return {
        id: c.descriptor.id,
        name: c.descriptor.name,
        description: c.descriptor.shortDescription,
        accountTypeLabel: c.descriptor.accountTypeLabel,
        scopes: c.descriptor.scopes,
        configured: status.configured,
        missing: status.missing,
        tokenPolicy: tokenPolicy(c.descriptor.capabilities),
        integration: row
          ? {
              id: row.id,
              status: row.status,
              label: row.external_user_label,
              connectedAt: iso(row.connected_at),
              tokenExpiresAt: iso(row.token_expires_at),
              lastErrorCode: row.last_error_code,
              lastErrorMessage: row.last_error_message,
            }
          : null,
      };
    });
    const accounts: AccountData[] = acc.rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      name: r.name,
      externalId: r.external_id,
      currency: r.currency,
      timezone: r.timezone,
      externalStatus: r.external_status,
      isSelected: r.is_selected,
      lastSuccessfulSyncAt: iso(r.last_successful_sync_at),
      integrationConnected: r.connected,
    }));
    const jobList: JobData[] = jobs.rows.map((r) => ({
      id: r.id,
      accountName: r.account_name,
      kind: r.kind,
      status: r.status,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      createdAt: iso(r.created_at)!,
      finishedAt: iso(r.finished_at),
      errorCode: r.error_code,
      errorMessage: r.error_message,
      rowsWritten: r.rows_written,
      attempts: r.attempts,
      runAfter: iso(r.run_after),
    }));
    return { connectors, accounts, jobs: jobList };
  });
}

export async function loadTeam(identity: SessionIdentity, orgId: string, includeInvitations: boolean) {
  return withUserDb(identity, async (db) => {
    const m = await db.query(
      `select m.user_id, p.email, p.full_name, m.role::text as role, m.created_at
         from nexo.organization_members m left join nexo.profiles p on p.id = m.user_id
        where m.organization_id = $1 order by m.role, p.email`,
      [orgId],
    );
    const members: MemberData[] = m.rows.map((r) => ({ userId: r.user_id, email: r.email ?? "(sin correo)", name: r.full_name, role: r.role, createdAt: r.created_at.toISOString() }));
    let invitations: InvitationData[] = [];
    if (includeInvitations) {
      const i = await db.query(
        `select id, email, role::text as role, expires_at, created_at, accepted_at, revoked_at, email_delivery
           from nexo.invitations where organization_id = $1 order by created_at desc limit 50`,
        [orgId],
      );
      invitations = i.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        expiresAt: r.expires_at.toISOString(),
        createdAt: r.created_at.toISOString(),
        status: r.revoked_at ? "revoked" : r.accepted_at ? "accepted" : r.expires_at.getTime() < Date.now() ? "expired" : "pending",
        delivery: r.email_delivery,
      }));
    }
    return { members, invitations };
  });
}

export function describeAudit(action: string, metadata: Record<string, unknown>): string {
  const safe = Object.entries(metadata ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
  return safe.slice(0, 300);
}

export async function loadAudit(identity: SessionIdentity, orgId: string | null, limit = 100) {
  return withUserDb(identity, async (db) => {
    const r = await db.query(
      `select a.id, a.created_at, coalesce(p.email, case when a.actor_type = 'system' then 'Sistema' else '—' end) as actor, a.actor_type, a.action,
              a.target_type, a.target_id, a.metadata, o.name as org
         from nexo.audit_logs a
         left join nexo.profiles p on p.id = a.actor_user_id
         left join nexo.organizations o on o.id = a.organization_id
        where ($1::uuid is null or a.organization_id = $1)
        order by a.created_at desc limit $2`,
      [orgId, limit],
    );
    return r.rows.map<AuditData & { org: string | null }>((x) => ({
      id: String(x.id),
      createdAt: x.created_at.toISOString(),
      actor: x.actor,
      actorType: x.actor_type,
      action: x.action,
      target: x.target_type,
      details: describeAudit(x.action, x.metadata),
      org: x.org,
    }));
  });
}
