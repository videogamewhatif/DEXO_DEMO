import type { ChunkData, QualityFlags, SnapshotValue, WebBreakdown } from "@/lib/integrations/contract";
import type { Queryable } from "@/lib/db/types";
import { eachDay } from "@/lib/metrics/periods";

/**
 * Escritura idempotente por SUSTITUCIÓN del conjunto consultado: dentro de una
 * transacción se borran las filas de la cuenta en el rango consultado y se
 * insertan las recibidas. Así:
 *  - repetir el mismo periodo no duplica,
 *  - filas que el proveedor modificó o eliminó no quedan obsoletas,
 *  - si la consulta falla, no se borra nada (la transacción no se ejecuta).
 */

interface Target {
  organizationId: string;
  accountId: string;
  jobId: string;
}

const DATASET_BREAKDOWN: Record<string, WebBreakdown> = {
  web_total: "total",
  web_source_medium: "source_medium",
  web_campaign: "campaign",
  web_landing_page: "landing_page",
  web_device: "device",
};

function inRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

async function writeCoverage(db: Queryable, t: Target, datasets: string[], from: string, to: string, flags: Record<string, QualityFlags>) {
  const days = eachDay({ from, to });
  for (const ds of datasets) {
    await db.query(
      `insert into nexo.data_coverage (organization_id, provider_account_id, dataset, date, synced_at, sync_job_id, quality_flags)
       select $1, $2, $3, d, now(), $4, $5::jsonb from unnest($6::date[]) as d
       on conflict (organization_id, provider_account_id, dataset, date)
       do update set synced_at = excluded.synced_at, sync_job_id = excluded.sync_job_id, quality_flags = excluded.quality_flags`,
      [t.organizationId, t.accountId, ds, t.jobId, JSON.stringify(flags[ds] ?? {}), days],
    );
  }
}

export async function writeChunk(db: Queryable, t: Target, chunk: ChunkData): Promise<{ rows: number; discarded: number }> {
  const { from, to } = chunk.range;
  let discarded = 0;

  if (chunk.family === "ads") {
    // Deduplicación defensiva por clave natural (la última fila gana).
    const rows = new Map<string, (typeof chunk.rows)[number]>();
    for (const r of chunk.rows) {
      if (!inRange(r.date, from, to)) {
        discarded++;
        continue;
      }
      rows.set(`${r.campaignExternalId}|${r.date}`, r);
    }
    const actions = new Map<string, (typeof chunk.actions)[number]>();
    for (const a of chunk.actions) {
      if (!inRange(a.date, from, to)) continue;
      actions.set(`${a.campaignExternalId}|${a.date}|${a.actionType}`, a);
    }

    for (const c of chunk.campaigns) {
      await db.query(
        `insert into nexo.campaigns (organization_id, provider_account_id, external_id, name, status, objective)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (provider_account_id, external_id) do update set
           name = excluded.name,
           status = coalesce(excluded.status, nexo.campaigns.status),
           objective = coalesce(excluded.objective, nexo.campaigns.objective)`,
        [t.organizationId, t.accountId, c.externalId, c.name.slice(0, 500), c.status, c.objective],
      );
    }

    await db.query(
      `delete from nexo.ad_campaign_daily where organization_id = $1 and provider_account_id = $2 and date between $3 and $4`,
      [t.organizationId, t.accountId, from, to],
    );
    await db.query(
      `delete from nexo.ad_campaign_daily_actions where organization_id = $1 and provider_account_id = $2 and date between $3 and $4`,
      [t.organizationId, t.accountId, from, to],
    );
    const r = [...rows.values()];
    if (r.length) {
      await db.query(
        `insert into nexo.ad_campaign_daily
           (organization_id, provider_account_id, campaign_external_id, date, currency, spend, impressions, clicks, link_clicks, reach, attribution_setting, sync_job_id)
         select $1, $2, u.c, u.d, u.cur, u.sp, u.imp, u.clk, u.lclk, u.rch, u.attr, $12
         from unnest($3::text[], $4::date[], $5::text[], $6::numeric[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[])
           as u(c, d, cur, sp, imp, clk, lclk, rch, attr)`,
        [
          t.organizationId,
          t.accountId,
          r.map((x) => x.campaignExternalId),
          r.map((x) => x.date),
          r.map((x) => x.currency),
          r.map((x) => x.spend),
          r.map((x) => x.impressions),
          r.map((x) => x.clicks),
          r.map((x) => x.linkClicks),
          r.map((x) => x.reach),
          r.map((x) => x.attributionSetting),
          t.jobId,
        ],
      );
    }
    const a = [...actions.values()];
    if (a.length) {
      await db.query(
        `insert into nexo.ad_campaign_daily_actions
           (organization_id, provider_account_id, campaign_external_id, date, action_type, value, action_value, attribution_setting, sync_job_id)
         select $1, $2, u.c, u.d, u.t, u.v, u.av, u.attr, $9
         from unnest($3::text[], $4::date[], $5::text[], $6::numeric[], $7::numeric[], $8::text[]) as u(c, d, t, v, av, attr)`,
        [
          t.organizationId,
          t.accountId,
          a.map((x) => x.campaignExternalId),
          a.map((x) => x.date),
          a.map((x) => x.actionType),
          a.map((x) => x.value),
          a.map((x) => x.actionValue),
          a.map((x) => x.attributionSetting),
          t.jobId,
        ],
      );
    }
    await writeCoverage(db, t, chunk.datasets, from, to, chunk.flags);
    return { rows: r.length + a.length, discarded };
  }

  // Analítica web
  const breakdowns = chunk.datasets.map((d) => DATASET_BREAKDOWN[d]).filter((b): b is WebBreakdown => Boolean(b));
  const rows = new Map<string, (typeof chunk.rows)[number]>();
  for (const r of chunk.rows) {
    if (!inRange(r.date, from, to) || !breakdowns.includes(r.breakdown)) {
      discarded++;
      continue;
    }
    rows.set(`${r.breakdown}|${r.date}|${r.dimensionValue}`, r);
  }
  if (breakdowns.length) {
    await db.query(
      `delete from nexo.web_daily where organization_id = $1 and provider_account_id = $2 and breakdown = any($3::text[]) and date between $4 and $5`,
      [t.organizationId, t.accountId, breakdowns, from, to],
    );
  }
  const r = [...rows.values()];
  if (r.length) {
    await db.query(
      `insert into nexo.web_daily
         (organization_id, provider_account_id, breakdown, date, dimension_value, sessions, engaged_sessions, total_users, new_users, screen_page_views, key_events, sync_job_id)
       select $1, $2, u.b, u.d, u.dv, u.s, u.es, u.tu, u.nu, u.pv, u.ke, $12
       from unnest($3::text[], $4::date[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::numeric[])
         as u(b, d, dv, s, es, tu, nu, pv, ke)`,
      [
        t.organizationId,
        t.accountId,
        r.map((x) => x.breakdown),
        r.map((x) => x.date),
        r.map((x) => x.dimensionValue),
        r.map((x) => x.sessions),
        r.map((x) => x.engagedSessions),
        r.map((x) => x.totalUsers),
        r.map((x) => x.newUsers),
        r.map((x) => x.screenPageViews),
        r.map((x) => x.keyEvents),
        t.jobId,
      ],
    );
  }
  let keCount = 0;
  if (chunk.datasets.includes("web_key_events")) {
    await db.query(
      `delete from nexo.web_daily_key_events where organization_id = $1 and provider_account_id = $2 and date between $3 and $4`,
      [t.organizationId, t.accountId, from, to],
    );
    const ke = new Map<string, (typeof chunk.keyEvents)[number]>();
    for (const k of chunk.keyEvents) if (inRange(k.date, from, to)) ke.set(`${k.date}|${k.eventName}`, k);
    const list = [...ke.values()];
    keCount = list.length;
    if (list.length) {
      await db.query(
        `insert into nexo.web_daily_key_events (organization_id, provider_account_id, date, event_name, key_events, sync_job_id)
         select $1, $2, u.d, u.e, u.k, $6 from unnest($3::date[], $4::text[], $5::numeric[]) as u(d, e, k)`,
        [t.organizationId, t.accountId, list.map((x) => x.date), list.map((x) => x.eventName), list.map((x) => x.keyEvents), t.jobId],
      );
    }
  }
  await writeCoverage(db, t, chunk.datasets, from, to, chunk.flags);
  return { rows: r.length + keCount, discarded };
}

export async function writeSnapshots(db: Queryable, t: Target, snapshots: SnapshotValue[]) {
  for (const s of snapshots) {
    await db.query(
      `insert into nexo.metric_snapshots (organization_id, provider_account_id, metric, date_from, date_to, value, computed_at, sync_job_id)
       values ($1, $2, $3, $4, $5, $6, now(), $7)
       on conflict (organization_id, provider_account_id, metric, date_from, date_to)
       do update set value = excluded.value, computed_at = excluded.computed_at, sync_job_id = excluded.sync_job_id`,
      [t.organizationId, t.accountId, s.metric, s.range.from, s.range.to, s.value, t.jobId],
    );
  }
}
