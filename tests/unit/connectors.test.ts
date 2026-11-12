import { beforeAll, describe, expect, it } from "vitest";
import { ga4Connector } from "@/lib/integrations/ga4/connector";
import { metaAdsConnector, appSecretProof, parseMetaThrottle } from "@/lib/integrations/meta/connector";
import { createProviderHttp } from "@/lib/integrations/http";
import { ProviderError } from "@/lib/integrations/errors";
import { withRetry, backoffDelay } from "@/lib/sync/retry";
import { serverEnv, resetEnvCache } from "@/config/env";
import { createProviderMock, type MockOptions } from "../support/provider-mocks";
import type { Connector, OAuthTokens } from "@/lib/integrations/contract";

/** Pruebas con respuestas SIMULADAS de los proveedores (fixtures), no contra APIs reales. */
beforeAll(() => {
  Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", META_APP_ID: "123", META_APP_SECRET: "msecret", META_GRAPH_API_VERSION: "v25.0" });
  resetEnvCache();
});

function setup(c: Connector, opts?: MockOptions) {
  const mock = createProviderMock(opts);
  const http = createProviderHttp({ provider: c.descriptor.id, allowedHosts: c.allowedHosts, fetchImpl: mock.fetchImpl });
  return { mock, http, env: serverEnv() };
}
const tokens: OAuthTokens = { accessToken: "EAAlonglivedtoken0123456789abcdefghij", scopes: ["ads_read"] };
const account = { id: "acc", externalId: "111", currency: "MXN", timezone: "America/Mexico_City" };
const noSleep = async () => undefined;

describe("GA4", () => {
  it("URL de autorización: offline, consent, scope mínimo, state y PKCE S256", () => {
    const u = new URL(ga4Connector.buildAuthorizationUrl(serverEnv(), { state: "st", redirectUri: "https://app/cb", codeChallenge: "ch" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("intercambia el código (con code_verifier) y lista propiedades paginadas", async () => {
    const { http, env, mock } = setup(ga4Connector);
    const t = await ga4Connector.exchangeCode(env, http, { code: "ok", redirectUri: "https://app/cb", codeVerifier: "verif" });
    expect(t.refreshToken).toBeTruthy();
    expect(new URLSearchParams(mock.calls[0]!.body).get("code_verifier")).toBe("verif");
    const props = await ga4Connector.listAccounts(env, http, t);
    expect(props.map((p) => p.externalId)).toEqual(["123", "456"]);
  });
  it("refresh token caducado → error de autenticación (requiere reconexión)", async () => {
    const { http, env } = setup(ga4Connector, { googleRefreshInvalid: true });
    const err = await ga4Connector.refreshTokens!(env, http, { accessToken: "a", refreshToken: "r", scopes: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("auth");
  });
  it("valida compatibilidad y extrae reportes paginados con banderas de calidad", async () => {
    const { http, env, mock } = setup(ga4Connector);
    const ctx = { tokens: { accessToken: "ya29.x", scopes: [] }, account: { ...account, externalId: "123" }, http, env };
    const v = await ga4Connector.validateAccount(ctx);
    expect(v).toMatchObject({ ok: true, currency: "MXN", timezone: "America/Mexico_City", unsupportedDatasets: [] });
    const chunk = await ga4Connector.fetchChunk(ctx, { from: "2026-10-01", to: "2026-10-03" });
    expect(chunk.family).toBe("web");
    if (chunk.family !== "web") return;
    expect(chunk.rows.filter((r) => r.breakdown === "total")).toHaveLength(3);
    expect(chunk.rows.filter((r) => r.breakdown === "landing_page")).toHaveLength(6);
    expect(chunk.flags.web_landing_page?.thresholded).toBe(true);
    expect(chunk.keyEvents).toHaveLength(3);
    // Paginación: dos páginas por reporte (offset 0 y 10000).
    const offsets = mock.calls.filter((c) => c.url.pathname.endsWith(":runReport")).map((c) => JSON.parse(c.body!).offset);
    expect(offsets.filter((o: string) => o === "10000").length).toBeGreaterThan(0);
  });
  it("429 RESOURCE_EXHAUSTED se clasifica como límite con espera", async () => {
    const { http, env } = setup(ga4Connector, { failNext: [{ match: /runReport/, status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }, headers: { "retry-after": "120" } }] });
    const err = await ga4Connector.fetchChunk({ tokens: { accessToken: "a", scopes: [] }, account, http, env }, { from: "2026-10-01", to: "2026-10-01" }).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(err.details.retryAfterMs).toBe(120_000);
  });
});

describe("Meta Ads", () => {
  it("intercambia por token de larga duración, verifica ads_read y no usa refresh token", async () => {
    const { http, env, mock } = setup(metaAdsConnector);
    const t = await metaAdsConnector.exchangeCode(env, http, { code: "ok", redirectUri: "https://app/cb" });
    expect(t.refreshToken).toBeUndefined();
    expect(Date.parse(t.expiresAt!) - Date.now()).toBeGreaterThan(50 * 86400_000);
    expect(t.scopes).toContain("ads_read");
    expect(metaAdsConnector.refreshTokens).toBeUndefined();
    const graphCalls = mock.calls.filter((c) => c.url.pathname.includes("/me"));
    expect(graphCalls.every((c) => c.url.searchParams.get("appsecret_proof") === appSecretProof(t.accessToken, "msecret"))).toBe(true);
  });
  it("lista cuentas siguiendo el cursor `after` (no la URL `next` con token)", async () => {
    const { http, env, mock } = setup(metaAdsConnector);
    const accs = await metaAdsConnector.listAccounts(env, http, tokens);
    expect(accs.map((a) => [a.externalId, a.currency, a.externalStatus])).toEqual([["111", "MXN", "ACTIVE"], ["222", "USD", "DISABLED"]]);
    expect(mock.calls.every((c) => c.url.hostname === "graph.facebook.com" && !c.url.searchParams.get("access_token")?.includes("SECRET"))).toBe(true);
  });
  it("normaliza insights paginados: clics en enlaces separados de clics, acciones con su valor y atribución", async () => {
    const { http, env } = setup(metaAdsConnector);
    const chunk = await metaAdsConnector.fetchChunk({ tokens, account, http, env, sleep: noSleep }, { from: "2026-10-01", to: "2026-10-03" });
    if (chunk.family !== "ads") throw new Error("familia");
    expect(chunk.rows).toHaveLength(6);
    expect(chunk.rows[0]).toMatchObject({ spend: "100.25", clicks: 40, linkClicks: 25, currency: "MXN", attributionSetting: "7d_click_1d_view" });
    const purchase = chunk.actions.find((a) => a.actionType === "omni_purchase")!;
    expect(purchase).toMatchObject({ value: null, actionValue: "500.00" });
    expect(chunk.campaigns.find((c) => c.externalId === "c2")).toMatchObject({ status: "PAUSED", objective: "OUTCOME_SALES" });
  });
  it("usa reporte asíncrono si Meta indica demasiados datos", async () => {
    const { http, env, mock } = setup(metaAdsConnector, { metaTooMuchData: true });
    const chunk = await metaAdsConnector.fetchChunk({ tokens, account, http, env, sleep: noSleep }, { from: "2026-10-01", to: "2026-10-02" });
    expect(chunk.stats.mode).toBe("async");
    expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/insights"))).toBe(true);
    expect(mock.state.asyncPolls).toBeGreaterThanOrEqual(2);
  });
  it("código 190 → reconexión; 17/80004 → límite con espera de las cabeceras", async () => {
    let { http, env } = setup(metaAdsConnector, { failNext: [{ match: /insights/, status: 400, body: { error: { code: 190, message: "Error validating access token" } } }] });
    let err = await metaAdsConnector.fetchChunk({ tokens, account, http, env, sleep: noSleep }, { from: "2026-10-01", to: "2026-10-01" }).catch((e) => e);
    expect(err.kind).toBe("auth");
    ({ http, env } = setup(metaAdsConnector, {
      failNext: [{ match: /insights/, status: 400, body: { error: { code: 80004, message: "too many calls" } }, headers: { "x-business-use-case-usage": JSON.stringify({ "111": [{ call_count: 100, estimated_time_to_regain_access: 7 }] }) } }],
    }));
    err = await metaAdsConnector.fetchChunk({ tokens, account, http, env, sleep: noSleep }, { from: "2026-10-01", to: "2026-10-01" }).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(err.details.retryAfterMs).toBe(7 * 60_000);
    expect(err.message).not.toMatch(/EAA/);
  });
  it("interpreta cabeceras de uso", () => {
    const h = new Headers({ "x-fb-ads-insights-throttle": JSON.stringify({ app_id_util_pct: 95, acc_id_util_pct: 10 }) });
    expect(parseMetaThrottle(h).utilization).toBe(95);
  });
});

describe("reintentos", () => {
  it("respeta Retry-After y reintenta errores transitorios sin exceder el máximo", async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      if (n === 1) throw new ProviderError("rate_limited", "x", "lim", { retryAfterMs: 1500 });
      if (n === 2) throw new ProviderError("transient", "x", "500");
      return "ok";
    }, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, maxInlineWaitMs: 5000 }, async (ms) => { waits.push(ms); });
    expect(r).toBe("ok");
    expect(waits[0]).toBe(1500);
    expect(waits[1]).toBeGreaterThanOrEqual(50);
  });
  it("no reintenta errores de autenticación y no espera en línea más de lo permitido", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new ProviderError("auth", "x", "190"); }, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, maxInlineWaitMs: 1 }, noSleep)).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(withRetry(async () => { throw new ProviderError("rate_limited", "x", "l", { retryAfterMs: 3_600_000 }); }, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, maxInlineWaitMs: 60_000 }, noSleep)).rejects.toThrow();
  });
  it("backoff exponencial con variación acotada", () => {
    expect(backoffDelay(0, 1000, 60000, () => 0)).toBe(500);
    expect(backoffDelay(3, 1000, 60000, () => 1)).toBe(8000);
    expect(backoffDelay(20, 1000, 60000, () => 1)).toBe(60000);
  });
});
