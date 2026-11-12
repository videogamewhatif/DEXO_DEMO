import { describe, expect, it } from "vitest";
import { delta, safeDivide, sumWithCoverage, v, MISSING } from "@/lib/metrics/values";
import { buildReport } from "@/lib/reports/builder";
import { addDays, presetRange, previousPeriod, eachDay, snapshotRanges } from "@/lib/metrics/periods";
import type { AccountInfo, RawReportData, OrgReportSettings } from "@/lib/reports/types";

const settings: OrgReportSettings = { timezone: "America/Mexico_City", displayCurrency: "MXN", ga4LeadEventName: "generate_lead", metaLeadActionType: "lead", metaPurchaseActionType: "omni_purchase" };
const acc = (id: string, provider: AccountInfo["provider"], currency = "MXN"): AccountInfo => ({ id, provider, name: id, externalId: id, currency, timezone: "America/Mexico_City", isSelected: true, lastSuccessfulSyncAt: "2026-11-01T00:00:00Z", integrationStatus: "connected", hasActiveJob: false });
const empty = (): RawReportData => ({ accounts: [], adRows: [], adActions: [], campaigns: [], webRows: [], keyEvents: [], coverage: [], snapshots: [] });
const cover = (raw: RawReportData, accountId: string, dataset: string, from: string, to: string) => {
  for (const d of eachDay({ from, to })) raw.coverage.push({ accountId, dataset, date: d, syncedAt: "2026-11-01T00:00:00Z", flags: {} });
};
const adRow = (accountId: string, date: string, spend: number, impressions: number, linkClicks: number, currency = "MXN", campaign = "c1") => ({ accountId, campaignExternalId: campaign, date, currency, spend, impressions, clicks: linkClicks * 2, linkClicks, reach: 100, attributionSetting: "7d_click_1d_view" });
const filters = (from: string, to: string, compare = false) => ({ range: { from, to }, compare, source: "all" as const, accountIds: [] });

describe("valores y ratios", () => {
  it("división segura: denominador cero no produce infinito", () => {
    expect(safeDivide(v(10), v(0))).toEqual({ state: "undefined", reason: "zero_denominator" });
    expect(safeDivide(MISSING, v(5))).toEqual(MISSING);
  });
  it("comparación con base cero no produce porcentaje infinito", () => {
    expect(delta(v(5), v(0))).toEqual({ state: "from_zero" });
    expect(delta(v(0), v(0))).toEqual({ state: "both_zero" });
    expect(delta(v(15), v(10))).toEqual({ state: "pct", pct: 0.5 });
    expect(delta(MISSING, v(10))).toEqual({ state: "unavailable" });
  });
  it("dato ausente ≠ cero ≠ pendiente", () => {
    expect(sumWithCoverage([], 0, 7, false)).toEqual({ state: "missing" });
    expect(sumWithCoverage([], 0, 7, true)).toEqual({ state: "pending" });
    expect(sumWithCoverage([], 7, 7, false)).toEqual({ state: "value", value: 0 }); // cero real: días cubiertos sin filas
    expect(sumWithCoverage([null, null], 7, 7, false)).toEqual({ state: "missing" }); // el proveedor no entregó el campo
    expect(sumWithCoverage([3, 4], 5, 7, false)).toEqual({ state: "value", value: 7, partial: { coveredDays: 5, expectedDays: 7 } });
  });
});

describe("periodos", () => {
  it("presets terminan ayer y el periodo anterior tiene la misma duración", () => {
    const r = presetRange("last_7", "2026-11-10");
    expect(r).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(previousPeriod(r)).toEqual({ from: "2026-10-27", to: "2026-11-02" });
    expect(presetRange("last_month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(snapshotRanges("2026-11-10")).toHaveLength(6);
  });
});

describe("reportes", () => {
  it("no suma monedas distintas: un grupo por moneda", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads", "MXN"), acc("us", "meta_ads", "USD")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-02");
    cover(raw, "us", "ads_campaign_daily", "2026-10-01", "2026-10-02");
    raw.adRows.push(adRow("mx", "2026-10-01", 1000, 1000, 10, "MXN"), adRow("us", "2026-10-01", 50, 1000, 10, "USD"));
    const r = buildReport(raw, filters("2026-10-01", "2026-10-02"), settings);
    expect(r.ads.map((g) => g.currency)).toEqual(["MXN", "USD"]);
    expect(r.ads[0]!.metrics.spend!.current).toMatchObject({ value: 1000 });
    expect(r.ads[1]!.metrics.spend!.current).toMatchObject({ value: 50 });
  });

  it("CTR y CPC se calculan con totales (ponderados), no promediando ratios diarios", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-02");
    // Día 1: CTR 10% (10/100). Día 2: CTR 1% (90/9000). Promedio simple = 5.5 %; ponderado = 100/9100.
    raw.adRows.push(adRow("mx", "2026-10-01", 10, 100, 10), adRow("mx", "2026-10-02", 900, 9000, 90));
    const m = buildReport(raw, filters("2026-10-01", "2026-10-02"), settings).ads[0]!.metrics;
    expect((m.ctr!.current as { value: number }).value).toBeCloseTo(100 / 9100, 10);
    expect((m.cpc!.current as { value: number }).value).toBeCloseTo(910 / 100, 10);
    expect((m.cpm!.current as { value: number }).value).toBeCloseTo((910 / 9100) * 1000, 10);
  });

  it("CPC sin clics queda indefinido, no infinito ni cero", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-01");
    raw.adRows.push(adRow("mx", "2026-10-01", 50, 100, 0));
    expect(buildReport(raw, filters("2026-10-01", "2026-10-01"), settings).ads[0]!.metrics.cpc!.current.state).toBe("undefined");
  });

  it("distingue días sin sincronizar (huecos) de días en cero", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-02"); // 10-03 no cubierto
    raw.adRows.push(adRow("mx", "2026-10-01", 10, 100, 1));
    const r = buildReport(raw, filters("2026-10-01", "2026-10-03"), settings);
    const daily = r.adsDaily.MXN!;
    expect(daily.map((p) => p.spend)).toEqual([10, 0, null]);
    expect(r.ads[0]!.metrics.spend!.current).toMatchObject({ value: 10, partial: { coveredDays: 2, expectedDays: 3 } });
  });

  it("sin cobertura alguna el valor es 'sin datos', no cero", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    const r = buildReport(raw, filters("2026-10-01", "2026-10-03"), settings);
    expect(r.ads[0]!.metrics.spend!.current.state).toBe("missing");
  });

  it("usuarios: no se suman entre días ni propiedades; solo agregado exacto del proveedor", () => {
    const raw = empty();
    raw.accounts = [acc("ga", "google_analytics")];
    cover(raw, "ga", "web_total", "2026-10-01", "2026-10-07");
    for (const d of eachDay({ from: "2026-10-01", to: "2026-10-07" })) raw.webRows.push({ accountId: "ga", breakdown: "total", date: d, dimensionValue: "", sessions: 10, engagedSessions: 5, totalUsers: 8, newUsers: 4, screenPageViews: 20, keyEvents: 1 });
    let r = buildReport(raw, filters("2026-10-01", "2026-10-07"), settings);
    expect(r.web!.metrics.users!.current.state).toBe("unsupported"); // sin snapshot: NO 56
    raw.snapshots.push({ accountId: "ga", metric: "total_users", from: "2026-10-01", to: "2026-10-07", value: 31 });
    r = buildReport(raw, filters("2026-10-01", "2026-10-07"), settings);
    expect(r.web!.metrics.users!.current).toEqual({ state: "value", value: 31 });
    expect(r.web!.metrics.sessions!.current).toMatchObject({ value: 70 }); // aditiva
    // Dos propiedades: usuarios no disponibles.
    raw.accounts.push(acc("ga2", "google_analytics"));
    r = buildReport(raw, filters("2026-10-01", "2026-10-07"), settings);
    expect(r.web!.metrics.users!.current.state).toBe("unsupported");
  });

  it("prospectos de Meta y de GA4 son métricas separadas y requieren definición", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads"), acc("ga", "google_analytics")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-01");
    cover(raw, "ga", "web_total", "2026-10-01", "2026-10-01");
    cover(raw, "ga", "web_key_events", "2026-10-01", "2026-10-01");
    raw.adRows.push(adRow("mx", "2026-10-01", 100, 1000, 10));
    raw.adActions.push({ accountId: "mx", campaignExternalId: "c1", date: "2026-10-01", actionType: "lead", value: 4, actionValue: null });
    raw.adActions.push({ accountId: "mx", campaignExternalId: "c1", date: "2026-10-01", actionType: "offsite_conversion.fb_pixel_lead", value: 4, actionValue: null });
    raw.keyEvents.push({ accountId: "ga", date: "2026-10-01", eventName: "generate_lead", keyEvents: 3 });
    const r = buildReport(raw, filters("2026-10-01", "2026-10-01"), settings);
    expect(r.ads[0]!.metrics.meta_leads!.current).toMatchObject({ value: 4 }); // solo el tipo configurado, sin duplicar
    expect(r.web!.metrics.ga4_leads!.current).toMatchObject({ value: 3 });
    expect((r.ads[0]!.metrics.meta_cpl!.current as { value: number }).value).toBe(25);
    const noDef = buildReport(raw, filters("2026-10-01", "2026-10-01"), { ...settings, metaLeadActionType: null });
    expect(noDef.ads[0]!.metrics.meta_leads!.current.state).toBe("unsupported");
  });

  it("ROAS usa el valor atribuido del tipo de compra configurado", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-01");
    raw.adRows.push(adRow("mx", "2026-10-01", 200, 1000, 10));
    raw.adActions.push({ accountId: "mx", campaignExternalId: "c1", date: "2026-10-01", actionType: "omni_purchase", value: 2, actionValue: 600 });
    const m = buildReport(raw, filters("2026-10-01", "2026-10-01"), settings).ads[0]!.metrics;
    expect((m.meta_roas!.current as { value: number }).value).toBe(3);
  });

  it("la comparación usa el periodo anterior de igual duración", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-09-24", "2026-10-07");
    for (const d of eachDay({ from: "2026-09-24", to: "2026-09-30" })) raw.adRows.push(adRow("mx", d, 10, 100, 1));
    for (const d of eachDay({ from: "2026-10-01", to: "2026-10-07" })) raw.adRows.push(adRow("mx", d, 20, 100, 1));
    const r = buildReport(raw, filters("2026-10-01", "2026-10-07", true), settings);
    expect(r.previousRange).toEqual({ from: "2026-09-24", to: "2026-09-30" });
    expect(r.ads[0]!.metrics.spend!.delta).toEqual({ state: "pct", pct: 1 });
  });

  it("los totales de campaña no se duplican con totales de cuenta", () => {
    const raw = empty();
    raw.accounts = [acc("mx", "meta_ads")];
    cover(raw, "mx", "ads_campaign_daily", "2026-10-01", "2026-10-01");
    raw.adRows.push(adRow("mx", "2026-10-01", 10, 100, 1, "MXN", "c1"), adRow("mx", "2026-10-01", 30, 100, 1, "MXN", "c2"));
    const r = buildReport(raw, filters("2026-10-01", "2026-10-01"), settings);
    const sumCampaigns = r.campaigns.reduce((a, c) => a + (c.spend.state === "value" ? c.spend.value : 0), 0);
    expect(sumCampaigns).toBe(40);
    expect(r.ads[0]!.metrics.spend!.current).toMatchObject({ value: 40 });
    expect(r.accountRows[0]!.metrics.spend).toMatchObject({ value: 40 });
  });
});
