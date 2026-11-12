import { eachDay, daysInRange, previousPeriod, rangeEquals, type DateRange } from "@/lib/metrics/periods";
import { MISSING, PENDING, delta, isValue, safeDivide, sumWithCoverage, unsupported, v, type DeltaValue, type MetricValue } from "@/lib/metrics/values";
import type { MetricKey } from "@/lib/metrics/definitions";
import type { AccountInfo, OrgReportSettings, RawReportData, ReportFilters, SourceId, WebBreakdownId } from "./types";

/**
 * Construcción de reportes a partir de filas diarias persistidas.
 * Reglas aplicadas (ver docs/metricas.md):
 *  - no se suman monedas distintas (un grupo por moneda),
 *  - ratios desde componentes (ponderados), con división segura,
 *  - datos ausentes ≠ cero (cobertura por día y cuenta),
 *  - métricas no aditivas (usuarios, alcance) solo con agregados exactos del proveedor,
 *  - Meta y GA4 nunca se combinan en un "total de conversiones".
 */

export interface MetricCell {
  current: MetricValue;
  previous: MetricValue | null;
  delta: DeltaValue | null;
}

export interface Coverage {
  coveredDays: number;
  expectedDays: number;
  pending: boolean;
}

export interface AdsCurrencyGroup {
  currency: string;
  accounts: AccountInfo[];
  coverage: Coverage;
  metrics: Partial<Record<MetricKey, MetricCell>>;
  attributionSettings: string[];
}

export interface WebSummary {
  accounts: AccountInfo[];
  coverage: Coverage;
  metrics: Partial<Record<MetricKey, MetricCell>>;
  qualityFlags: { thresholded: boolean; otherRow: boolean; sampled: boolean };
}

export interface DailyPoint {
  date: string;
  [series: string]: number | null | string;
}

export interface CampaignRow {
  key: string;
  accountId: string;
  accountName: string;
  campaignId: string;
  name: string;
  status: string | null;
  currency: string;
  spend: MetricValue;
  impressions: MetricValue;
  linkClicks: MetricValue;
  clicks: MetricValue;
  ctr: MetricValue;
  cpc: MetricValue;
  leads: MetricValue;
  cpl: MetricValue;
  purchaseValue: MetricValue;
  roas: MetricValue;
  attributionSetting: string | null;
}

export interface AccountRow {
  account: AccountInfo;
  coverage: Coverage;
  metrics: Partial<Record<MetricKey, MetricValue>>;
}

export interface WebDimensionRow {
  key: string;
  accountId: string;
  accountName: string;
  dimension: string;
  sessions: MetricValue;
  engagedSessions: MetricValue;
  engagementRate: MetricValue;
  keyEvents: MetricValue;
}

export interface Report {
  range: DateRange;
  previousRange: DateRange | null;
  accounts: AccountInfo[];
  ads: AdsCurrencyGroup[];
  adsDaily: Record<string, DailyPoint[]>; // por moneda
  web: WebSummary | null;
  webDaily: DailyPoint[];
  campaigns: CampaignRow[];
  accountRows: AccountRow[];
  webTables: Record<Exclude<WebBreakdownId, "total">, WebDimensionRow[]>;
  keyEventsByName: Array<{ key: string; accountName: string; eventName: string; value: MetricValue }>;
  actionTypes: Array<{ actionType: string; value: number; actionValue: number | null }>;
  freshness: { oldestSync: string | null; newestSync: string | null; anyPending: boolean; anyActiveJob: boolean };
}

const sum = (xs: Array<number | null>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Cuentas incluidas según filtros: seleccionadas o con historial. */
export function scopeAccounts(all: AccountInfo[], filters: ReportFilters): AccountInfo[] {
  return all.filter(
    (a) =>
      (a.isSelected || a.lastSuccessfulSyncAt !== null) &&
      (filters.source === "all" || a.provider === filters.source) &&
      (filters.accountIds.length === 0 || filters.accountIds.includes(a.id)),
  );
}

class CoverageIndex {
  private map = new Map<string, Set<string>>();
  private flags = new Map<string, { thresholded?: boolean; otherRow?: boolean; sampled?: boolean }[]>();
  constructor(raw: RawReportData) {
    for (const c of raw.coverage) {
      const k = `${c.accountId}|${c.dataset}`;
      if (!this.map.has(k)) this.map.set(k, new Set());
      this.map.get(k)!.add(c.date);
      if (c.flags && (c.flags.thresholded || c.flags.otherRow || c.flags.sampled)) {
        const fk = `${k}|${c.date}`;
        this.flags.set(fk, [...(this.flags.get(fk) ?? []), c.flags]);
      }
    }
  }
  has(accountId: string, dataset: string, date: string) {
    return this.map.get(`${accountId}|${dataset}`)?.has(date) ?? false;
  }
  coverage(accounts: AccountInfo[], dataset: string, range: DateRange): Coverage {
    const days = eachDay(range);
    let covered = 0;
    for (const a of accounts) for (const d of days) if (this.has(a.id, dataset, d)) covered++;
    return {
      coveredDays: covered,
      expectedDays: days.length * accounts.length,
      pending: accounts.some((a) => a.isSelected && !a.lastSuccessfulSyncAt),
    };
  }
  flagsIn(accounts: AccountInfo[], datasets: string[], range: DateRange) {
    const out = { thresholded: false, otherRow: false, sampled: false };
    for (const a of accounts)
      for (const ds of datasets)
        for (const d of eachDay(range))
          for (const f of this.flags.get(`${a.id}|${ds}|${d}`) ?? []) {
            out.thresholded ||= Boolean(f.thresholded);
            out.otherRow ||= Boolean(f.otherRow);
            out.sampled ||= Boolean(f.sampled);
          }
    return out;
  }
}

function covered(cov: Coverage, values: Array<number | null>): MetricValue {
  return sumWithCoverage(values, cov.coveredDays, cov.expectedDays, cov.pending);
}

function cell(current: MetricValue, previous: MetricValue | null): MetricCell {
  return { current, previous, delta: previous ? delta(current, previous) : null };
}

const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

function adsMetrics(raw: RawReportData, cov: CoverageIndex, accounts: AccountInfo[], range: DateRange, settings: OrgReportSettings) {
  const ids = new Set(accounts.map((a) => a.id));
  const rows = raw.adRows.filter((r) => ids.has(r.accountId) && inRange(r.date, range));
  const coverage = cov.coverage(accounts, "ads_campaign_daily", range);
  const m: Partial<Record<MetricKey, MetricValue>> = {};
  m.spend = covered(coverage, rows.map((r) => r.spend));
  m.impressions = covered(coverage, rows.map((r) => r.impressions));
  m.clicks = covered(coverage, rows.map((r) => r.clicks));
  m.link_clicks = covered(coverage, rows.map((r) => r.linkClicks));
  m.ctr = safeDivide(m.link_clicks, m.impressions);
  m.cpc = safeDivide(m.spend, m.link_clicks);
  m.cpm = safeDivide(m.spend, m.impressions, 1000);

  const actions = raw.adActions.filter((a) => ids.has(a.accountId) && inRange(a.date, range));
  if (settings.metaLeadActionType) {
    const t = settings.metaLeadActionType;
    m.meta_leads = coverage.coveredDays === 0 ? (coverage.pending ? PENDING : MISSING) : v(sum(actions.filter((a) => a.actionType === t).map((a) => a.value)), coverage);
    m.meta_cpl = safeDivide(m.spend, m.meta_leads);
  } else {
    m.meta_leads = unsupported("Define en Configuración qué acción de Meta cuenta como prospecto.");
    m.meta_cpl = m.meta_leads;
  }
  if (settings.metaPurchaseActionType) {
    const t = settings.metaPurchaseActionType;
    const values = actions.filter((a) => a.actionType === t).map((a) => a.actionValue);
    m.meta_purchase_value = coverage.coveredDays === 0 ? (coverage.pending ? PENDING : MISSING) : v(sum(values), coverage);
    m.meta_roas = safeDivide(m.meta_purchase_value, m.spend);
  } else {
    m.meta_purchase_value = unsupported("Define en Configuración qué acción de Meta representa una compra con valor.");
    m.meta_roas = m.meta_purchase_value;
  }
  // Alcance: solo una cuenta y periodo exacto precalculado por el proveedor.
  if (accounts.length === 1) {
    const snap = raw.snapshots.find((s) => s.accountId === accounts[0]!.id && s.metric === "reach" && rangeEquals({ from: s.from, to: s.to }, range));
    m.reach = snap && snap.value !== null ? v(snap.value) : unsupported("El alcance solo está disponible para los periodos predefinidos (7, 28 o 90 días).");
  } else {
    m.reach = unsupported("El alcance no se suma entre cuentas: filtra una sola cuenta.");
  }
  return { metrics: m, coverage };
}

function webMetrics(raw: RawReportData, cov: CoverageIndex, accounts: AccountInfo[], range: DateRange, settings: OrgReportSettings) {
  const ids = new Set(accounts.map((a) => a.id));
  const rows = raw.webRows.filter((r) => ids.has(r.accountId) && r.breakdown === "total" && inRange(r.date, range));
  const coverage = cov.coverage(accounts, "web_total", range);
  const m: Partial<Record<MetricKey, MetricValue>> = {};
  m.sessions = covered(coverage, rows.map((r) => r.sessions));
  m.engaged_sessions = covered(coverage, rows.map((r) => r.engagedSessions));
  m.engagement_rate = safeDivide(m.engaged_sessions, m.sessions);
  m.page_views = covered(coverage, rows.map((r) => r.screenPageViews));
  m.key_events = covered(coverage, rows.map((r) => r.keyEvents));

  if (settings.ga4LeadEventName) {
    const keCov = cov.coverage(accounts, "web_key_events", range);
    const ke = raw.keyEvents.filter((k) => ids.has(k.accountId) && inRange(k.date, range) && k.eventName === settings.ga4LeadEventName);
    m.ga4_leads = keCov.coveredDays === 0 ? (keCov.pending ? PENDING : MISSING) : v(sum(ke.map((k) => k.keyEvents)), keCov);
  } else {
    m.ga4_leads = unsupported("Define en Configuración qué evento clave de GA4 cuenta como prospecto.");
  }

  if (accounts.length !== 1) {
    m.users = unsupported("Los usuarios no se suman entre propiedades: filtra una sola propiedad.");
  } else if (daysInRange(range) === 1) {
    const day = rows.find((r) => r.date === range.from);
    m.users = coverage.coveredDays === 0 ? MISSING : v(day?.totalUsers ?? 0);
  } else {
    const snap = raw.snapshots.find((s) => s.accountId === accounts[0]!.id && s.metric === "total_users" && rangeEquals({ from: s.from, to: s.to }, range));
    m.users = snap && snap.value !== null ? v(snap.value) : unsupported("Usuarios únicos solo para periodos predefinidos (7, 28 o 90 días) o un solo día.");
  }
  return { metrics: m, coverage };
}

export function buildReport(raw: RawReportData, filters: ReportFilters, settings: OrgReportSettings): Report {
  const range = filters.range;
  const prev = filters.compare ? previousPeriod(range) : null;
  const cov = new CoverageIndex(raw);
  const accounts = scopeAccounts(raw.accounts, filters);
  const metaAccounts = accounts.filter((a) => a.provider === "meta_ads");
  const gaAccounts = accounts.filter((a) => a.provider === "google_analytics");
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  // ---- Publicidad: un grupo por moneda --------------------------------------
  const byCurrency = new Map<string, AccountInfo[]>();
  for (const a of metaAccounts) {
    const cur = a.currency ?? raw.adRows.find((r) => r.accountId === a.id)?.currency ?? "—";
    byCurrency.set(cur, [...(byCurrency.get(cur) ?? []), a]);
  }
  const ads: AdsCurrencyGroup[] = [];
  const adsDaily: Record<string, DailyPoint[]> = {};
  for (const [currency, accs] of [...byCurrency.entries()].sort()) {
    const cur = adsMetrics(raw, cov, accs, range, settings);
    const pre = prev ? adsMetrics(raw, cov, accs, prev, settings) : null;
    const metrics: Partial<Record<MetricKey, MetricCell>> = {};
    for (const k of Object.keys(cur.metrics) as MetricKey[]) metrics[k] = cell(cur.metrics[k]!, pre ? pre.metrics[k]! : null);
    const ids = new Set(accs.map((a) => a.id));
    const attribution = [
      ...new Set(raw.adRows.filter((r) => ids.has(r.accountId) && inRange(r.date, range) && r.attributionSetting).map((r) => r.attributionSetting!)),
    ];
    ads.push({ currency, accounts: accs, coverage: cur.coverage, metrics, attributionSettings: attribution });

    adsDaily[currency] = eachDay(range).map((date) => {
      const coveredAny = accs.some((a) => cov.has(a.id, "ads_campaign_daily", date));
      const rows = raw.adRows.filter((r) => ids.has(r.accountId) && r.date === date);
      return {
        date,
        spend: coveredAny ? sum(rows.map((r) => r.spend)) : null,
        linkClicks: coveredAny ? sum(rows.map((r) => r.linkClicks)) : null,
        impressions: coveredAny ? sum(rows.map((r) => r.impressions)) : null,
      };
    });
  }

  // ---- Sitio web ------------------------------------------------------------
  let web: WebSummary | null = null;
  let webDaily: DailyPoint[] = [];
  if (gaAccounts.length) {
    const cur = webMetrics(raw, cov, gaAccounts, range, settings);
    const pre = prev ? webMetrics(raw, cov, gaAccounts, prev, settings) : null;
    const metrics: Partial<Record<MetricKey, MetricCell>> = {};
    for (const k of Object.keys(cur.metrics) as MetricKey[]) metrics[k] = cell(cur.metrics[k]!, pre ? pre.metrics[k]! : null);
    web = {
      accounts: gaAccounts,
      coverage: cur.coverage,
      metrics,
      qualityFlags: cov.flagsIn(gaAccounts, ["web_total", "web_source_medium", "web_campaign", "web_landing_page", "web_device"], range),
    };
    const ids = new Set(gaAccounts.map((a) => a.id));
    webDaily = eachDay(range).map((date) => {
      const coveredAny = gaAccounts.some((a) => cov.has(a.id, "web_total", date));
      const rows = raw.webRows.filter((r) => ids.has(r.accountId) && r.breakdown === "total" && r.date === date);
      return {
        date,
        sessions: coveredAny ? sum(rows.map((r) => r.sessions)) : null,
        engagedSessions: coveredAny ? sum(rows.map((r) => r.engagedSessions)) : null,
        keyEvents: coveredAny ? sum(rows.map((r) => r.keyEvents)) : null,
        // Usuarios por día: válido solo para una propiedad (no se suma entre propiedades).
        users: coveredAny && gaAccounts.length === 1 ? (rows[0]?.totalUsers ?? 0) : null,
      };
    });
  }

  // ---- Campañas ---------------------------------------------------------------
  const campaignNames = new Map(raw.campaigns.map((c) => [`${c.accountId}|${c.externalId}`, c]));
  const campaignAgg = new Map<string, { accountId: string; campaignId: string; currency: string; rows: typeof raw.adRows }>();
  const metaIds = new Set(metaAccounts.map((a) => a.id));
  for (const r of raw.adRows) {
    if (!metaIds.has(r.accountId) || !inRange(r.date, range)) continue;
    const k = `${r.accountId}|${r.campaignExternalId}`;
    if (!campaignAgg.has(k)) campaignAgg.set(k, { accountId: r.accountId, campaignId: r.campaignExternalId, currency: r.currency, rows: [] });
    campaignAgg.get(k)!.rows.push(r);
  }
  const campaigns: CampaignRow[] = [...campaignAgg.entries()].map(([key, g]) => {
    const total = (sel: (r: (typeof g.rows)[number]) => number | null) => {
      const vals = g.rows.map(sel);
      return vals.every((x) => x === null) ? MISSING : v(sum(vals));
    };
    const spend = total((r) => r.spend);
    const impressions = total((r) => r.impressions);
    const linkClicks = total((r) => r.linkClicks);
    const actions = raw.adActions.filter((a) => a.accountId === g.accountId && a.campaignExternalId === g.campaignId && inRange(a.date, range));
    const leads = settings.metaLeadActionType
      ? v(sum(actions.filter((a) => a.actionType === settings.metaLeadActionType).map((a) => a.value)))
      : unsupported("Sin definición de prospecto");
    const purchaseValue = settings.metaPurchaseActionType
      ? v(sum(actions.filter((a) => a.actionType === settings.metaPurchaseActionType).map((a) => a.actionValue)))
      : unsupported("Sin definición de compra");
    const meta = campaignNames.get(key);
    const attrs = [...new Set(g.rows.map((r) => r.attributionSetting).filter(Boolean))];
    return {
      key,
      accountId: g.accountId,
      accountName: accountName.get(g.accountId) ?? "",
      campaignId: g.campaignId,
      name: meta?.name ?? g.campaignId,
      status: meta?.status ?? null,
      currency: g.currency,
      spend,
      impressions,
      linkClicks,
      clicks: total((r) => r.clicks),
      ctr: safeDivide(linkClicks, impressions),
      cpc: safeDivide(spend, linkClicks),
      leads,
      cpl: safeDivide(spend, leads),
      purchaseValue,
      roas: safeDivide(purchaseValue, spend),
      attributionSetting: attrs.length === 1 ? attrs[0]! : attrs.length > 1 ? "mixta" : null,
    };
  });
  campaigns.sort((a, b) => (isValue(b.spend) ? b.spend.value : -1) - (isValue(a.spend) ? a.spend.value : -1));

  // ---- Cuentas ----------------------------------------------------------------
  const accountRows: AccountRow[] = accounts.map((a) => {
    if (a.provider === "meta_ads") {
      const r = adsMetrics(raw, cov, [a], range, settings);
      return { account: a, coverage: r.coverage, metrics: r.metrics };
    }
    const r = webMetrics(raw, cov, [a], range, settings);
    return { account: a, coverage: r.coverage, metrics: r.metrics };
  });

  // ---- Tablas web por dimensión -------------------------------------------------
  const gaIds = new Set(gaAccounts.map((a) => a.id));
  const webTables = { source_medium: [], campaign: [], landing_page: [], device: [] } as Report["webTables"];
  for (const b of Object.keys(webTables) as Array<keyof Report["webTables"]>) {
    const agg = new Map<string, { accountId: string; dim: string; s: number[]; e: number[]; k: number[] }>();
    for (const r of raw.webRows) {
      if (r.breakdown !== b || !gaIds.has(r.accountId) || !inRange(r.date, range)) continue;
      const k = `${r.accountId}|${r.dimensionValue}`;
      if (!agg.has(k)) agg.set(k, { accountId: r.accountId, dim: r.dimensionValue, s: [], e: [], k: [] });
      const g = agg.get(k)!;
      g.s.push(r.sessions ?? 0);
      g.e.push(r.engagedSessions ?? 0);
      g.k.push(r.keyEvents ?? 0);
    }
    webTables[b] = [...agg.entries()]
      .map(([key, g]) => {
        const sessions = v(sum(g.s));
        const engaged = v(sum(g.e));
        return {
          key,
          accountId: g.accountId,
          accountName: accountName.get(g.accountId) ?? "",
          dimension: g.dim || "(sin valor)",
          sessions,
          engagedSessions: engaged,
          engagementRate: safeDivide(engaged, sessions),
          keyEvents: v(sum(g.k)),
        };
      })
      .sort((a, b2) => (b2.sessions.state === "value" ? b2.sessions.value : 0) - (a.sessions.state === "value" ? a.sessions.value : 0));
  }

  const keAgg = new Map<string, { accountId: string; eventName: string; total: number }>();
  for (const k of raw.keyEvents) {
    if (!gaIds.has(k.accountId) || !inRange(k.date, range)) continue;
    const key = `${k.accountId}|${k.eventName}`;
    if (!keAgg.has(key)) keAgg.set(key, { accountId: k.accountId, eventName: k.eventName, total: 0 });
    keAgg.get(key)!.total += k.keyEvents ?? 0;
  }
  const keyEventsByName = [...keAgg.entries()]
    .map(([key, g]) => ({ key, accountName: accountName.get(g.accountId) ?? "", eventName: g.eventName, value: v(g.total) }))
    .sort((a, b) => (b.value.state === "value" ? b.value.value : 0) - (a.value.state === "value" ? a.value.value : 0));

  const typeAgg = new Map<string, { value: number; actionValue: number | null }>();
  for (const a of raw.adActions) {
    if (!metaIds.has(a.accountId) || !inRange(a.date, range)) continue;
    const t = typeAgg.get(a.actionType) ?? { value: 0, actionValue: null };
    t.value += a.value ?? 0;
    if (a.actionValue !== null) t.actionValue = (t.actionValue ?? 0) + a.actionValue;
    typeAgg.set(a.actionType, t);
  }
  const actionTypes = [...typeAgg.entries()].map(([actionType, t]) => ({ actionType, ...t })).sort((a, b) => b.value - a.value);

  const syncs = accounts.map((a) => a.lastSuccessfulSyncAt).filter((x): x is string => Boolean(x)).sort();
  return {
    range,
    previousRange: prev,
    accounts,
    ads,
    adsDaily,
    web,
    webDaily,
    campaigns,
    accountRows,
    webTables,
    keyEventsByName,
    actionTypes,
    freshness: {
      oldestSync: syncs[0] ?? null,
      newestSync: syncs[syncs.length - 1] ?? null,
      anyPending: accounts.some((a) => a.isSelected && !a.lastSuccessfulSyncAt),
      anyActiveJob: accounts.some((a) => a.hasActiveJob),
    },
  };
}

export function sourcesPresent(report: Report): SourceId[] {
  return [...new Set(report.accounts.map((a) => a.provider))];
}
