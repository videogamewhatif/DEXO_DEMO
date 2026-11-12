/**
 * DATOS DE DEMOSTRACIÓN — completamente ficticios.
 * Se generan en memoria de forma determinista; nunca se escriben en la base de
 * datos ni se mezclan con datos reales. Se activan solo en las rutas /demo.
 */
import { addDays, eachDay, snapshotRanges, todayInTimeZone } from "@/lib/metrics/periods";
import type {
  AccountInfo,
  AdActionRecord,
  AdRow,
  CampaignRecord,
  CoverageRecord,
  KeyEventRecord,
  OrgReportSettings,
  RawReportData,
  ReportRepository,
  SnapshotRecord,
  WebRow,
} from "@/lib/reports/types";
import type { DateRange } from "@/lib/metrics/periods";
import type { EffectiveRole } from "@/lib/authz/permissions";

export const DEMO_DAYS = 120;

export interface DemoIntegration {
  provider: "google_analytics" | "meta_ads";
  status: "connected" | "needs_reauth" | "error";
  label: string;
  note: string;
}

export interface DemoOrg {
  slug: string;
  name: string;
  timezone: string;
  displayCurrency: string;
  settings: OrgReportSettings;
  integrations: DemoIntegration[];
  members: Array<{ name: string; email: string; role: EffectiveRole }>;
}

export const DEMO_ORGS: DemoOrg[] = [
  {
    slug: "panaderia-aurora",
    name: "Panadería Aurora (demo)",
    timezone: "America/Mexico_City",
    displayCurrency: "MXN",
    settings: {
      timezone: "America/Mexico_City",
      displayCurrency: "MXN",
      ga4LeadEventName: "generate_lead",
      metaLeadActionType: "lead",
      metaPurchaseActionType: "omni_purchase",
    },
    integrations: [
      { provider: "google_analytics", status: "connected", label: "Cuenta de Google", note: "Propiedad: aurora.example" },
      { provider: "meta_ads", status: "connected", label: "Ana Demo", note: "1 cuenta publicitaria" },
    ],
    members: [
      { name: "Ana Ejemplo", email: "ana@aurora.example", role: "org_admin" },
      { name: "Pedro Ejemplo", email: "pedro@aurora.example", role: "analyst" },
      { name: "Lucía Ejemplo", email: "lucia@aurora.example", role: "viewer" },
    ],
  },
  {
    slug: "viajes-horizonte",
    name: "Viajes Horizonte (demo)",
    timezone: "America/Bogota",
    displayCurrency: "USD",
    settings: {
      timezone: "America/Bogota",
      displayCurrency: "USD",
      ga4LeadEventName: "form_submit",
      metaLeadActionType: "lead",
      metaPurchaseActionType: null,
    },
    integrations: [
      { provider: "google_analytics", status: "connected", label: "Cuenta de Google", note: "Faltan días por una sincronización fallida" },
      { provider: "meta_ads", status: "needs_reauth", label: "Luis Demo", note: "El token de Meta venció: requiere reconexión" },
    ],
    members: [
      { name: "Luis Ejemplo", email: "luis@horizonte.example", role: "org_admin" },
      { name: "Marta Ejemplo", email: "marta@horizonte.example", role: "viewer" },
    ],
  },
];

export function getDemoOrg(slug: string): DemoOrg | null {
  return DEMO_ORGS.find((o) => o.slug === slug) ?? null;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

interface CampaignProfile {
  id: string;
  name: string;
  dailyBudget: number;
  cpm: number;
  ctr: number;
  leadRate: number;
  purchaseRate: number;
  aov: number;
  pausedFromDay?: number; // días antes de hoy a partir de los cuales la campaña está pausada (gasto 0)
}

interface AccountProfile {
  info: Omit<AccountInfo, "lastSuccessfulSyncAt" | "hasActiveJob">;
  campaigns: CampaignProfile[];
  /** Días (desde hoy hacia atrás) sin cobertura, para demostrar "dato ausente". */
  missingDays?: [number, number];
  syncAgeHours: number;
}

const DEMO_ACCOUNT_PREFIX = "demo-";

function profilesFor(org: DemoOrg): AccountProfile[] {
  if (org.slug === "panaderia-aurora") {
    return [
      {
        info: { id: `${DEMO_ACCOUNT_PREFIX}aurora-meta`, provider: "meta_ads", name: "Aurora · Anuncios MX", externalId: "100000000000001", currency: "MXN", timezone: "America/Mexico_City", isSelected: true, integrationStatus: "connected" },
        syncAgeHours: 3,
        campaigns: [
          { id: "c-aurora-1", name: "Pan de muerto · Conversiones", dailyBudget: 900, cpm: 55, ctr: 0.018, leadRate: 0.0, purchaseRate: 0.035, aov: 420 },
          { id: "c-aurora-2", name: "Pedidos para eventos · Prospectos", dailyBudget: 600, cpm: 70, ctr: 0.012, leadRate: 0.09, purchaseRate: 0, aov: 0 },
          { id: "c-aurora-3", name: "Reconocimiento de marca", dailyBudget: 350, cpm: 28, ctr: 0.006, leadRate: 0.005, purchaseRate: 0.004, aov: 300 },
          { id: "c-aurora-4", name: "Promoción verano (pausada)", dailyBudget: 500, cpm: 60, ctr: 0.01, leadRate: 0.02, purchaseRate: 0.01, aov: 350, pausedFromDay: 45 },
        ],
      },
      {
        info: { id: `${DEMO_ACCOUNT_PREFIX}aurora-ga4`, provider: "google_analytics", name: "Aurora › aurora.example", externalId: "300000001", currency: "MXN", timezone: "America/Mexico_City", isSelected: true, integrationStatus: "connected" },
        syncAgeHours: 2,
        campaigns: [],
      },
    ];
  }
  return [
    {
      info: { id: `${DEMO_ACCOUNT_PREFIX}horizonte-meta-usd`, provider: "meta_ads", name: "Horizonte · Internacional (USD)", externalId: "100000000000002", currency: "USD", timezone: "America/Bogota", isSelected: true, integrationStatus: "needs_reauth" },
      syncAgeHours: 80,
      campaigns: [
        { id: "c-hor-1", name: "Cartagena · Prospectos", dailyBudget: 120, cpm: 6.5, ctr: 0.014, leadRate: 0.06, purchaseRate: 0, aov: 0 },
        { id: "c-hor-2", name: "Retargeting paquetes", dailyBudget: 60, cpm: 9, ctr: 0.021, leadRate: 0.1, purchaseRate: 0, aov: 0 },
      ],
    },
    {
      info: { id: `${DEMO_ACCOUNT_PREFIX}horizonte-meta-cop`, provider: "meta_ads", name: "Horizonte · Colombia (COP)", externalId: "100000000000003", currency: "COP", timezone: "America/Bogota", isSelected: true, integrationStatus: "needs_reauth" },
      syncAgeHours: 80,
      campaigns: [{ id: "c-hor-3", name: "Escapadas de fin de semana", dailyBudget: 250000, cpm: 9000, ctr: 0.011, leadRate: 0.04, purchaseRate: 0, aov: 0 }],
    },
    {
      info: { id: `${DEMO_ACCOUNT_PREFIX}horizonte-ga4`, provider: "google_analytics", name: "Horizonte › horizonte.example", externalId: "300000002", currency: "USD", timezone: "America/Bogota", isSelected: true, integrationStatus: "connected" },
      syncAgeHours: 5,
      missingDays: [18, 21],
      campaigns: [],
    },
  ];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function generate(org: DemoOrg, now: Date): RawReportData {
  const rand = mulberry32(seedOf(org.slug));
  const today = todayInTimeZone(org.timezone, now);
  const start = addDays(today, -DEMO_DAYS);
  const days = eachDay({ from: start, to: today });
  const profiles = profilesFor(org);
  const out: RawReportData = { accounts: [], adRows: [], adActions: [], campaigns: [], webRows: [], keyEvents: [], coverage: [], snapshots: [] };

  for (const p of profiles) {
    out.accounts.push({ ...p.info, lastSuccessfulSyncAt: new Date(now.getTime() - p.syncAgeHours * 3_600_000).toISOString(), hasActiveJob: false });
    // La cuenta con token vencido dejó de sincronizar hace 3 días.
    const lastCoveredOffset = p.syncAgeHours > 48 ? Math.floor(p.syncAgeHours / 24) : 0;
    days.forEach((date, idx) => {
      const daysAgo = days.length - 1 - idx;
      const isMissing = (p.missingDays && daysAgo >= p.missingDays[0] && daysAgo <= p.missingDays[1]) || daysAgo < lastCoveredOffset;
      if (isMissing) return;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const seasonal = 1 + 0.15 * Math.sin((idx / 14) * Math.PI) + (weekday === 0 || weekday === 6 ? 0.12 : 0);
      if (p.info.provider === "meta_ads") {
        out.coverage.push({ accountId: p.info.id, dataset: "ads_campaign_daily", date, syncedAt: now.toISOString(), flags: {} });
        for (const c of p.campaigns) {
          if (c.pausedFromDay !== undefined && daysAgo <= c.pausedFromDay) continue; // pausada: sin filas = cero real
          const spend = round2(c.dailyBudget * seasonal * (0.8 + rand() * 0.4));
          const impressions = Math.round((spend / c.cpm) * 1000);
          const linkClicks = Math.round(impressions * c.ctr * (0.85 + rand() * 0.3));
          const clicks = Math.round(linkClicks * (1.3 + rand() * 0.4));
          const leads = Math.round(linkClicks * c.leadRate * (0.6 + rand() * 0.8));
          const purchases = Math.round(linkClicks * c.purchaseRate * (0.6 + rand() * 0.8));
          out.adRows.push({
            accountId: p.info.id,
            campaignExternalId: c.id,
            date,
            currency: p.info.currency!,
            spend,
            impressions,
            clicks,
            linkClicks,
            reach: Math.round(impressions / (1.4 + rand() * 0.4)),
            attributionSetting: "7d_click_1d_view",
          });
          const push = (actionType: string, value: number, actionValue: number | null) =>
            out.adActions.push({ accountId: p.info.id, campaignExternalId: c.id, date, actionType, value, actionValue });
          push("link_click", linkClicks, null);
          if (leads > 0) push("lead", leads, null);
          if (purchases > 0) push("omni_purchase", purchases, round2(purchases * c.aov * (0.8 + rand() * 0.4)));
        }
      } else {
        const sessions = Math.round((org.slug === "panaderia-aurora" ? 820 : 430) * seasonal * (0.85 + rand() * 0.3));
        const engaged = Math.round(sessions * (0.55 + rand() * 0.15));
        const users = Math.round(sessions * 0.78);
        const leadEvent = org.settings.ga4LeadEventName ?? "generate_lead";
        const leads = Math.round(sessions * 0.012 * (0.5 + rand()));
        const purchases = org.slug === "panaderia-aurora" ? Math.round(sessions * 0.008 * (0.5 + rand())) : 0;
        const keyEvents = leads + purchases;
        for (const ds of ["web_total", "web_source_medium", "web_campaign", "web_landing_page", "web_device", "web_key_events"]) {
          out.coverage.push({ accountId: p.info.id, dataset: ds, date, syncedAt: now.toISOString(), flags: ds === "web_landing_page" && daysAgo % 29 === 0 ? { otherRow: true } : {} });
        }
        const row = (breakdown: WebRow["breakdown"], dimensionValue: string, share: number): WebRow => ({
          accountId: p.info.id,
          breakdown,
          date,
          dimensionValue,
          sessions: Math.round(sessions * share),
          engagedSessions: Math.round(engaged * share),
          totalUsers: breakdown === "total" ? users : null,
          newUsers: breakdown === "total" ? Math.round(users * 0.6) : null,
          screenPageViews: breakdown === "total" ? Math.round(sessions * 2.4) : null,
          keyEvents: Math.round(keyEvents * share),
        });
        out.webRows.push(row("total", "", 1));
        for (const [dim, share] of [["google / organic", 0.38], ["facebook / paid", 0.27], ["(direct) / (none)", 0.2], ["instagram / referral", 0.1], ["newsletter / email", 0.05]] as const)
          out.webRows.push(row("source_medium", dim, share));
        for (const [dim, share] of [["(organic)", 0.38], ["(direct)", 0.2], ["temporada_alta", 0.27], ["(referral)", 0.1], ["boletin_mensual", 0.05]] as const)
          out.webRows.push(row("campaign", dim, share));
        const pages = org.slug === "panaderia-aurora"
          ? ([["/", 0.4], ["/pedidos", 0.22], ["/pan-de-muerto", 0.2], ["/eventos", 0.12], ["/contacto", 0.06]] as const)
          : ([["/", 0.35], ["/paquetes/cartagena", 0.3], ["/cotizar", 0.2], ["/blog/consejos", 0.15]] as const);
        for (const [dim, share] of pages) out.webRows.push(row("landing_page", dim, share));
        for (const [dim, share] of [["mobile", 0.68], ["desktop", 0.28], ["tablet", 0.04]] as const) out.webRows.push(row("device", dim, share));
        out.keyEvents.push({ accountId: p.info.id, date, eventName: leadEvent, keyEvents: leads });
        if (purchases) out.keyEvents.push({ accountId: p.info.id, date, eventName: "purchase", keyEvents: purchases });
      }
    });
    for (const c of p.campaigns) out.campaigns.push({ accountId: p.info.id, externalId: c.id, name: c.name, status: c.pausedFromDay !== undefined ? "PAUSED" : "ACTIVE", objective: null });

    // Agregados no aditivos de periodo (lo que el proveedor devolvería para el periodo exacto).
    for (const r of snapshotRanges(today)) {
      if (p.info.provider === "google_analytics") {
        const daily = out.webRows.filter((w) => w.accountId === p.info.id && w.breakdown === "total" && w.date >= r.from && w.date <= r.to);
        if (daily.length) {
          const s = daily.reduce((a, b) => a + (b.totalUsers ?? 0), 0);
          // Usuarios únicos del periodo < suma de usuarios diarios (personas que regresan).
          out.snapshots.push({ accountId: p.info.id, metric: "total_users", from: r.from, to: r.to, value: Math.round(s * (0.55 + 0.1 * Math.min(1, 7 / daily.length))) });
        }
      } else {
        const daily = out.adRows.filter((a) => a.accountId === p.info.id && a.date >= r.from && a.date <= r.to);
        if (daily.length) {
          const s = daily.reduce((a, b) => a + (b.reach ?? 0), 0);
          out.snapshots.push({ accountId: p.info.id, metric: "reach", from: r.from, to: r.to, value: Math.round(s * 0.42) });
        }
      }
    }
  }
  return out;
}

const cache = new Map<string, { day: string; data: RawReportData }>();

export function demoRaw(org: DemoOrg, now = new Date()): RawReportData {
  const day = todayInTimeZone(org.timezone, now);
  const hit = cache.get(org.slug);
  if (hit && hit.day === day) return hit.data;
  const data = generate(org, now);
  cache.set(org.slug, { day, data });
  return data;
}

export function createDemoRepository(org: DemoOrg): ReportRepository {
  return {
    mode: "demo",
    async settings() {
      return org.settings;
    },
    async accounts() {
      return demoRaw(org).accounts;
    },
    async load(range: DateRange, accountIds: string[]) {
      const raw = demoRaw(org);
      const ids = new Set(accountIds);
      const inR = (d: string) => d >= range.from && d <= range.to;
      return {
        accounts: raw.accounts,
        adRows: raw.adRows.filter((r: AdRow) => ids.has(r.accountId) && inR(r.date)),
        adActions: raw.adActions.filter((r: AdActionRecord) => ids.has(r.accountId) && inR(r.date)),
        campaigns: raw.campaigns.filter((c: CampaignRecord) => ids.has(c.accountId)),
        webRows: raw.webRows.filter((r: WebRow) => ids.has(r.accountId) && inR(r.date)),
        keyEvents: raw.keyEvents.filter((r: KeyEventRecord) => ids.has(r.accountId) && inR(r.date)),
        coverage: raw.coverage.filter((r: CoverageRecord) => ids.has(r.accountId) && inR(r.date)),
        snapshots: raw.snapshots.filter((s: SnapshotRecord) => ids.has(s.accountId) && s.from >= range.from && s.to <= range.to),
      };
    },
  };
}

/** Reloj de la demostración (los datos ficticios se generan relativos a hoy). */
export function demoNow(): number {
  return Date.now();
}
