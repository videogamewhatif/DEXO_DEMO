/**
 * Simuladores de API de proveedores PARA PRUEBAS. Reproducen la forma de las
 * respuestas documentadas (ver docs/guia-google.md y docs/guia-meta.md) para
 * probar paginación, errores, límites y normalización. No demuestran que la
 * integración funcione contra los servicios reales.
 */
import type { FetchLike } from "@/lib/integrations/http";

export interface MockCall {
  method: string;
  url: URL;
  body: string | undefined;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function eachDay(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export interface MockOptions {
  /** Campañas de Meta que no existen (para probar reconciliación de filas eliminadas). */
  metaRemovedCampaigns?: Set<string>;
  /** Fuerza respuestas de error en la próxima llamada que coincida. */
  failNext?: Array<{ match: RegExp; status: number; body: unknown; headers?: Record<string, string>; times?: number }>;
  /** Google refresh devuelve invalid_grant. */
  googleRefreshInvalid?: boolean;
  /** Meta insights sincrónico responde "demasiados datos" (para forzar reporte asíncrono). */
  metaTooMuchData?: boolean;
}

export function createProviderMock(opts: MockOptions = {}) {
  const calls: MockCall[] = [];
  const state = { asyncPolls: 0 };
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    for (const f of opts.failNext ?? []) {
      if ((f.times ?? 1) > 0 && f.match.test(`${method} ${url.hostname}${url.pathname}`)) {
        f.times = (f.times ?? 1) - 1;
        return json(f.status, f.body, f.headers);
      }
    }

    // ---------------- Google ----------------
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        if (opts.googleRefreshInvalid) return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        return json(200, { access_token: "ya29.refreshed-access-token-xyz", expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/analytics.readonly" });
      }
      if (form.get("code") === "bad-code") return json(400, { error: "invalid_grant" });
      return json(200, {
        access_token: "ya29.initial-access-token-abc",
        refresh_token: "1//refresh-token-secret-0123456789",
        expires_in: 3599,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/analytics.readonly",
      });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") return json(200, {});
    if (url.hostname === "analyticsadmin.googleapis.com" && url.pathname === "/v1beta/accountSummaries") {
      if (!url.searchParams.get("pageToken")) {
        return json(200, {
          accountSummaries: [{ account: "accounts/1", displayName: "Cuenta Uno", propertySummaries: [{ property: "properties/123", displayName: "Sitio", propertyType: "PROPERTY_TYPE_ORDINARY" }] }],
          nextPageToken: "page2",
        });
      }
      return json(200, { accountSummaries: [{ account: "accounts/2", displayName: "Cuenta Dos", propertySummaries: [{ property: "properties/456", displayName: "Landing" }] }] });
    }
    if (url.hostname === "analyticsadmin.googleapis.com" && /^\/v1beta\/properties\/\d+$/.test(url.pathname)) {
      return json(200, { name: url.pathname.slice(8), displayName: "Sitio", timeZone: "America/Mexico_City", currencyCode: "MXN" });
    }
    if (url.hostname === "analyticsdata.googleapis.com" && url.pathname.endsWith(":checkCompatibility")) {
      const req = JSON.parse(body ?? "{}");
      return json(200, {
        dimensionCompatibilities: req.dimensions.map((d: { name: string }) => ({ dimensionMetadata: { apiName: d.name }, compatibility: "COMPATIBLE" })),
        metricCompatibilities: req.metrics.map((m: { name: string }) => ({ metricMetadata: { apiName: m.name }, compatibility: "COMPATIBLE" })),
      });
    }
    if (url.hostname === "analyticsdata.googleapis.com" && url.pathname.endsWith(":runReport")) {
      const req = JSON.parse(body ?? "{}") as { dateRanges: Array<{ startDate: string; endDate: string }>; dimensions: Array<{ name: string }>; metrics: Array<{ name: string }>; offset: string };
      const dims = req.dimensions.map((d) => d.name);
      const range = req.dateRanges[0]!;
      if (dims.length === 0) {
        return json(200, { rows: [{ metricValues: req.metrics.map(() => ({ value: "777" })) }], rowCount: 1, metadata: { currencyCode: "MXN", timeZone: "America/Mexico_City" } });
      }
      const values: Record<string, string[]> = { sessionSourceMedium: ["google / organic", "facebook / paid"], sessionCampaignName: ["(organic)"], landingPage: ["/", "/promo"], deviceCategory: ["mobile", "desktop"], eventName: ["generate_lead"] };
      const rows: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }> = [];
      for (const d of eachDay(range.startDate, range.endDate)) {
        const dateDim = d.replace(/-/g, "");
        const second = dims[1] ? values[dims[1]] ?? ["x"] : [""];
        for (const v of second) {
          rows.push({
            dimensionValues: dims[1] ? [{ value: dateDim }, { value: v }] : [{ value: dateDim }],
            metricValues: req.metrics.map((m) => ({ value: m.name === "keyEvents" ? "2" : "10" })),
          });
        }
      }
      // Paginación: el total se reparte en dos páginas (offset 0 y 10000).
      const offset = Number(req.offset ?? 0);
      const half = Math.ceil(rows.length / 2);
      const page = offset === 0 ? rows.slice(0, half) : rows.slice(half);
      return json(200, {
        rows: page,
        rowCount: rows.length > 1 ? 10_000 + (rows.length - half) : rows.length,
        metadata: { currencyCode: "MXN", timeZone: "America/Mexico_City", subjectToThresholding: dims.includes("landingPage") },
        propertyQuota: { tokensPerHour: { consumed: 5, remaining: 39_000 } },
      });
    }

    // ---------------- Meta ----------------
    if (url.hostname === "graph.facebook.com") {
      const path = url.pathname.replace(/^\/v\d+\.0/, "");
      if (path === "/oauth/access_token") {
        if (url.searchParams.get("grant_type") === "fb_exchange_token") return json(200, { access_token: "EAAlonglivedtoken0123456789abcdefghij", token_type: "bearer", expires_in: 5183944 });
        return json(200, { access_token: "EAAshortlivedtoken0123456789abcdefgh", token_type: "bearer", expires_in: 3600 });
      }
      if (path === "/me/permissions" && method === "GET") return json(200, { data: [{ permission: "ads_read", status: "granted" }, { permission: "public_profile", status: "granted" }] });
      if (path === "/me/permissions" && method === "DELETE") return json(200, { success: true });
      if (path === "/me") return json(200, { name: "Ana Prueba", id: "999" });
      if (path === "/me/adaccounts") {
        if (!url.searchParams.get("after")) {
          return json(200, { data: [{ id: "act_111", account_id: "111", name: "Cuenta MX", currency: "MXN", timezone_name: "America/Mexico_City", account_status: 1 }], paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/v25.0/me/adaccounts?after=c1&access_token=SECRET" } });
        }
        return json(200, { data: [{ id: "act_222", account_id: "222", name: "Cuenta US", currency: "USD", timezone_name: "America/New_York", account_status: 2 }], paging: { cursors: { after: "c2" } } });
      }
      const acc = path.match(/^\/act_(\d+)$/);
      if (acc) return json(200, { id: `act_${acc[1]}`, name: "Cuenta MX", currency: "MXN", timezone_name: "America/Mexico_City", account_status: 1 });
      if (/^\/act_\d+\/campaigns$/.test(path)) {
        return json(200, { data: [{ id: "c1", name: "Campaña Uno", status: "ACTIVE", objective: "OUTCOME_LEADS" }, { id: "c2", name: "Campaña Dos", status: "PAUSED", objective: "OUTCOME_SALES" }] });
      }
      const insightsRows = (since: string, until: string) => {
        const rows: unknown[] = [];
        for (const d of eachDay(since, until)) {
          for (const c of ["c1", "c2"]) {
            if (opts.metaRemovedCampaigns?.has(c)) continue;
            rows.push({
              campaign_id: c,
              campaign_name: c === "c1" ? "Campaña Uno" : "Campaña Dos",
              account_currency: "MXN",
              spend: "100.25",
              impressions: "1000",
              clicks: "40",
              inline_link_clicks: "25",
              reach: "800",
              actions: [{ action_type: "lead", value: "3" }, { action_type: "link_click", value: "25" }],
              action_values: [{ action_type: "omni_purchase", value: "500.00" }],
              attribution_setting: "7d_click_1d_view",
              date_start: d,
              date_stop: d,
            });
          }
        }
        return rows;
      };
      if (/^\/act_\d+\/insights$/.test(path) && method === "POST") return json(200, { report_run_id: "6023920149050" });
      if (path === "/6023920149050" && method === "GET") {
        state.asyncPolls++;
        return json(200, state.asyncPolls < 2 ? { async_status: "Job Running", async_percent_completion: 50 } : { async_status: "Job Completed", async_percent_completion: 100 });
      }
      if (path === "/6023920149050/insights") return json(200, { data: insightsRows("2026-10-01", "2026-10-02"), paging: {} });
      if (/^\/act_\d+\/insights$/.test(path)) {
        const tr = JSON.parse(url.searchParams.get("time_range") ?? "{}") as { since: string; until: string };
        if (url.searchParams.get("level") === "account") return json(200, { data: [{ reach: "4321" }] });
        if (opts.metaTooMuchData) return json(400, { error: { code: 100, error_subcode: 1487534, message: "Please reduce the amount of data" } });
        const rows = insightsRows(tr.since, tr.until);
        const half = Math.ceil(rows.length / 2);
        if (!url.searchParams.get("after")) return json(200, { data: rows.slice(0, half), paging: { cursors: { after: "p2" }, next: rows.length > half ? "https://graph.facebook.com/next?access_token=SECRET" : undefined } });
        return json(200, { data: rows.slice(half), paging: { cursors: { after: "p3" } } });
      }
    }
    return json(404, { error: { message: `Ruta simulada no definida: ${method} ${url.hostname}${url.pathname}` } });
  };
  return { fetchImpl, calls, state };
}
