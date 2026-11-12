import "server-only";
import { withUserDb } from "@/lib/db/user-db";
import type { SessionIdentity } from "@/lib/db/types";
import type { DateRange } from "@/lib/metrics/periods";
import type { AccountInfo, OrgReportSettings, RawReportData, ReportRepository, SourceId } from "./types";

async function sequential<T extends readonly (() => Promise<unknown>)[]>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));

/**
 * Repositorio de datos reales. Todas las consultas corren con withUserDb:
 * RLS limita filas a empresas donde el usuario tiene `reports.view`.
 * El filtro por organization_id es adicional (rendimiento y claridad), no la
 * barrera de seguridad.
 */
export function createDbRepository(identity: SessionIdentity, organizationId: string): ReportRepository {
  return {
    mode: "live",
    async settings(): Promise<OrgReportSettings> {
      return withUserDb(identity, async (db) => {
        const { rows } = await db.query<{
          timezone: string;
          display_currency: string | null;
          ga4_lead_event_name: string | null;
          meta_lead_action_type: string | null;
          meta_purchase_action_type: string | null;
        }>(
          `select timezone, display_currency, ga4_lead_event_name, meta_lead_action_type, meta_purchase_action_type
             from nexo.organizations where id = $1`,
          [organizationId],
        );
        const r = rows[0];
        if (!r) throw new Error("Empresa no visible");
        return {
          timezone: r.timezone,
          displayCurrency: r.display_currency,
          ga4LeadEventName: r.ga4_lead_event_name,
          metaLeadActionType: r.meta_lead_action_type,
          metaPurchaseActionType: r.meta_purchase_action_type,
        };
      });
    },
    async accounts(): Promise<AccountInfo[]> {
      return withUserDb(identity, async (db) => {
        const { rows } = await db.query<{
          id: string;
          provider: SourceId;
          name: string;
          external_id: string;
          currency: string | null;
          timezone: string | null;
          is_selected: boolean;
          last_successful_sync_at: Date | null;
          integration_status: string | null;
          has_active_job: boolean;
        }>(
          `select pa.id, pa.provider, pa.name, pa.external_id, pa.currency, pa.timezone, pa.is_selected,
                  pa.last_successful_sync_at, i.status::text as integration_status,
                  exists (select 1 from nexo.sync_jobs j where j.provider_account_id = pa.id and j.status in ('pending','running')) as has_active_job
             from nexo.provider_accounts pa
             left join nexo.integrations i on i.id = pa.integration_id
            where pa.organization_id = $1
            order by pa.provider, pa.name`,
          [organizationId],
        );
        return rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          name: r.name,
          externalId: r.external_id,
          currency: r.currency,
          timezone: r.timezone,
          isSelected: r.is_selected,
          lastSuccessfulSyncAt: r.last_successful_sync_at ? r.last_successful_sync_at.toISOString() : null,
          integrationStatus: r.integration_status,
          hasActiveJob: r.has_active_job,
        }));
      });
    },
    async load(range: DateRange, accountIds: string[]): Promise<RawReportData> {
      const accounts = await this.accounts();
      if (accountIds.length === 0) {
        return { accounts, adRows: [], adActions: [], campaigns: [], webRows: [], keyEvents: [], coverage: [], snapshots: [] };
      }
      return withUserDb(identity, async (db) => {
        const p = [organizationId, accountIds, range.from, range.to];
        // Secuencial: una conexión (transacción) no admite consultas concurrentes.
        const [ad, act, camp, web, ke, cov, snap] = await sequential([
          () => db.query(
            `select provider_account_id, campaign_external_id, date, currency, spend, impressions, clicks, link_clicks, reach, attribution_setting
               from nexo.ad_campaign_daily where organization_id = $1 and provider_account_id = any($2::uuid[]) and date between $3 and $4`,
            p,
          ),
          () => db.query(
            `select provider_account_id, campaign_external_id, date, action_type, value, action_value
               from nexo.ad_campaign_daily_actions where organization_id = $1 and provider_account_id = any($2::uuid[]) and date between $3 and $4`,
            p,
          ),
          () => db.query(
            `select provider_account_id, external_id, name, status, objective from nexo.campaigns
              where organization_id = $1 and provider_account_id = any($2::uuid[])`,
            [organizationId, accountIds],
          ),
          () => db.query(
            `select provider_account_id, breakdown, date, dimension_value, sessions, engaged_sessions, total_users, new_users, screen_page_views, key_events
               from nexo.web_daily where organization_id = $1 and provider_account_id = any($2::uuid[]) and date between $3 and $4`,
            p,
          ),
          () => db.query(
            `select provider_account_id, date, event_name, key_events from nexo.web_daily_key_events
              where organization_id = $1 and provider_account_id = any($2::uuid[]) and date between $3 and $4`,
            p,
          ),
          () => db.query(
            `select provider_account_id, dataset, date, synced_at, quality_flags from nexo.data_coverage
              where organization_id = $1 and provider_account_id = any($2::uuid[]) and date between $3 and $4`,
            p,
          ),
          () => db.query(
            `select provider_account_id, metric, date_from, date_to, value from nexo.metric_snapshots
              where organization_id = $1 and provider_account_id = any($2::uuid[]) and date_from >= $3 and date_to <= $4`,
            p,
          ),
        ] as const);
        return {
          accounts,
          adRows: ad.rows.map((r) => ({
            accountId: r.provider_account_id,
            campaignExternalId: r.campaign_external_id,
            date: r.date,
            currency: r.currency,
            spend: num(r.spend),
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            linkClicks: num(r.link_clicks),
            reach: num(r.reach),
            attributionSetting: r.attribution_setting,
          })),
          adActions: act.rows.map((r) => ({
            accountId: r.provider_account_id,
            campaignExternalId: r.campaign_external_id,
            date: r.date,
            actionType: r.action_type,
            value: num(r.value),
            actionValue: num(r.action_value),
          })),
          campaigns: camp.rows.map((r) => ({ accountId: r.provider_account_id, externalId: r.external_id, name: r.name, status: r.status, objective: r.objective })),
          webRows: web.rows.map((r) => ({
            accountId: r.provider_account_id,
            breakdown: r.breakdown,
            date: r.date,
            dimensionValue: r.dimension_value,
            sessions: num(r.sessions),
            engagedSessions: num(r.engaged_sessions),
            totalUsers: num(r.total_users),
            newUsers: num(r.new_users),
            screenPageViews: num(r.screen_page_views),
            keyEvents: num(r.key_events),
          })),
          keyEvents: ke.rows.map((r) => ({ accountId: r.provider_account_id, date: r.date, eventName: r.event_name, keyEvents: num(r.key_events) })),
          coverage: cov.rows.map((r) => ({
            accountId: r.provider_account_id,
            dataset: r.dataset,
            date: r.date,
            syncedAt: (r.synced_at as Date).toISOString(),
            flags: r.quality_flags ?? {},
          })),
          snapshots: snap.rows.map((r) => ({ accountId: r.provider_account_id, metric: r.metric, from: r.date_from, to: r.date_to, value: num(r.value) })),
        };
      });
    },
  };
}
