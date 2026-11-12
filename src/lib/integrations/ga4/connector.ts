import { z } from "zod";
import type {
  ChunkData,
  Connector,
  DateRange,
  FetchContext,
  OAuthTokens,
  ProviderAccountInfo,
  QualityFlags,
  SnapshotValue,
  ValidationResult,
  WebBreakdown,
  WebDailyRow,
  WebKeyEventRow,
} from "../contract";
import { splitRange } from "../contract";
import { ProviderError, parseRetryAfter } from "../errors";
import type { HttpResponse, ProviderHttp } from "../http";
import type { ServerEnv } from "@/config/env";

/**
 * Google Analytics 4
 * - OAuth 2.0 para aplicaciones web de servidor (código de autorización, access_type=offline).
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 * - Listado de propiedades: Google Analytics Admin API v1beta accountSummaries.list.
 * - Datos: Google Analytics Data API v1beta properties.runReport.
 * - Compatibilidad: properties.checkCompatibility antes de sincronizar.
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const PAGE_LIMIT = 10_000;
const MAX_PAGES = 50;

/** Conjuntos de reportes compatibles (no se fuerza todo en una sola consulta). */
export const GA4_REPORTS: Record<
  WebBreakdown | "key_events",
  { dataset: string; dimensions: string[]; metrics: string[] }
> = {
  total: {
    dataset: "web_total",
    dimensions: ["date"],
    metrics: ["sessions", "engagedSessions", "totalUsers", "newUsers", "screenPageViews", "keyEvents"],
  },
  source_medium: { dataset: "web_source_medium", dimensions: ["date", "sessionSourceMedium"], metrics: ["sessions", "engagedSessions", "keyEvents"] },
  campaign: { dataset: "web_campaign", dimensions: ["date", "sessionCampaignName"], metrics: ["sessions", "engagedSessions", "keyEvents"] },
  // landingPage (sin query string) evita cardinalidad excesiva y datos personales en parámetros de URL.
  landing_page: { dataset: "web_landing_page", dimensions: ["date", "landingPage"], metrics: ["sessions", "engagedSessions", "keyEvents"] },
  device: { dataset: "web_device", dimensions: ["date", "deviceCategory"], metrics: ["sessions", "engagedSessions", "keyEvents"] },
  key_events: { dataset: "web_key_events", dimensions: ["date", "eventName"], metrics: ["keyEvents"] },
};

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const runReportResponse = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).optional(),
  metricHeaders: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string().optional() })).optional(),
        metricValues: z.array(z.object({ value: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  rowCount: z.number().optional(),
  metadata: z
    .object({
      currencyCode: z.string().optional(),
      timeZone: z.string().optional(),
      dataLossFromOtherRow: z.boolean().optional(),
      subjectToThresholding: z.boolean().optional(),
      samplingMetadatas: z.array(z.unknown()).optional(),
    })
    .optional(),
  propertyQuota: z.record(z.string(), z.unknown()).optional(),
});

const accountSummaries = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: z.string().optional(),
        account: z.string().optional(),
        propertySummaries: z
          .array(z.object({ property: z.string(), displayName: z.string().optional(), propertyType: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const propertyResponse = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  timeZone: z.string().optional(),
  currencyCode: z.string().optional(),
});

const compatibilityResponse = z.object({
  dimensionCompatibilities: z
    .array(z.object({ dimensionMetadata: z.object({ apiName: z.string() }).partial().optional(), compatibility: z.string().optional() }))
    .optional(),
  metricCompatibilities: z
    .array(z.object({ metricMetadata: z.object({ apiName: z.string() }).partial().optional(), compatibility: z.string().optional() }))
    .optional(),
});

function ga4Error(res: HttpResponse, context: string): ProviderError {
  const body = (res.body ?? {}) as { error?: { code?: number; status?: string; message?: string }; error_description?: string };
  const status = res.status;
  const gStatus = body.error?.status;
  const message = `${context}: ${body.error?.message ?? body.error_description ?? `HTTP ${status}`}`;
  const details = { status, providerCode: gStatus ?? status };
  if (status === 429 || gStatus === "RESOURCE_EXHAUSTED") {
    return new ProviderError("rate_limited", "google_analytics", message, {
      ...details,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) ?? 60 * 60 * 1000,
    });
  }
  if (status === 401 || gStatus === "UNAUTHENTICATED") return new ProviderError("auth", "google_analytics", message, details);
  if (status === 403 || gStatus === "PERMISSION_DENIED") return new ProviderError("permission", "google_analytics", message, details);
  if (status >= 500 || gStatus === "UNAVAILABLE" || gStatus === "INTERNAL") {
    return new ProviderError("transient", "google_analytics", message, details);
  }
  return new ProviderError("invalid_request", "google_analytics", message, details);
}

function bearer(tokens: OAuthTokens) {
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

const toIsoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

function intOrNull(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function decOrNull(v: string | undefined): string | null {
  if (v === undefined || v === "") return null;
  return Number.isFinite(Number(v)) ? v : null;
}

async function runReport(
  http: ProviderHttp,
  tokens: OAuthTokens,
  propertyId: string,
  request: { dimensions: string[]; metrics: string[]; range: DateRange },
) {
  const rows: z.infer<typeof runReportResponse>["rows"] & object = [];
  const flags: QualityFlags = {};
  let offset = 0;
  let pages = 0;
  let quota: Record<string, unknown> | undefined;
  for (;;) {
    const res = await http.request("POST", `${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      headers: bearer(tokens),
      json: {
        dateRanges: [{ startDate: request.range.from, endDate: request.range.to }],
        dimensions: request.dimensions.map((name) => ({ name })),
        metrics: request.metrics.map((name) => ({ name })),
        limit: String(PAGE_LIMIT),
        offset: String(offset),
        keepEmptyRows: false,
        returnPropertyQuota: true,
      },
    });
    if (res.status !== 200) throw ga4Error(res, "runReport");
    const parsed = runReportResponse.safeParse(res.body);
    if (!parsed.success) throw new ProviderError("invalid_request", "google_analytics", "Respuesta de runReport con formato inesperado");
    const data = parsed.data;
    rows.push(...(data.rows ?? []));
    if (data.metadata?.subjectToThresholding) flags.thresholded = true;
    if (data.metadata?.dataLossFromOtherRow) flags.otherRow = true;
    if (data.metadata?.samplingMetadatas && data.metadata.samplingMetadatas.length > 0) flags.sampled = true;
    quota = data.propertyQuota ?? quota;
    const total = data.rowCount ?? rows.length;
    offset += PAGE_LIMIT;
    pages += 1;
    if (offset >= total || (data.rows ?? []).length === 0) break;
    if (pages >= MAX_PAGES) {
      throw new ProviderError("too_much_data", "google_analytics", "El reporte excede el número máximo de páginas permitido");
    }
  }
  return { rows, flags, quota };
}

export const ga4Connector: Connector = {
  descriptor: {
    id: "google_analytics",
    name: "Google Analytics 4",
    shortDescription: "Sesiones, usuarios, vistas, eventos clave, fuentes, campañas, landing pages y dispositivos.",
    category: "web",
    capabilities: ["oauth_authorization_code", "pkce", "refresh_token", "token_revocation", "list_accounts", "web_analytics_daily", "period_snapshots"],
    accountTypeLabel: "Propiedad de GA4",
    scopes: [SCOPE],
    docsPath: "docs/guia-google.md",
  },
  allowedHosts: ["accounts.google.com", "oauth2.googleapis.com", "analyticsadmin.googleapis.com", "analyticsdata.googleapis.com"],

  configStatus(env) {
    const missing = [
      !env.GOOGLE_OAUTH_CLIENT_ID && "GOOGLE_OAUTH_CLIENT_ID",
      !env.GOOGLE_OAUTH_CLIENT_SECRET && "GOOGLE_OAUTH_CLIENT_SECRET",
    ].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  },

  usesPkce(env) {
    return env.GOOGLE_OAUTH_USE_PKCE !== "false";
  },

  buildAuthorizationUrl(env, { state, redirectUri, codeChallenge }) {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("access_type", "offline");
    // prompt=consent garantiza un refresh token también en reconexiones.
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "false");
    url.searchParams.set("state", state);
    if (codeChallenge) {
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  },

  async exchangeCode(env, http, { code, redirectUri, codeVerifier }) {
    const form: Record<string, string> = {
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    };
    if (codeVerifier) form.code_verifier = codeVerifier;
    const res = await http.request("POST", TOKEN_URL, { form });
    if (res.status !== 200) {
      const err = (res.body ?? {}) as { error?: string };
      throw new ProviderError(err.error === "invalid_grant" ? "auth" : "invalid_request", "google_analytics",
        `Intercambio de código rechazado (${err.error ?? res.status})`, { status: res.status, providerCode: err.error });
    }
    const t = tokenResponse.parse(res.body);
    if (!t.refresh_token) {
      throw new ProviderError("auth", "google_analytics",
        "Google no entregó un refresh token. Revoca el acceso de la app en tu cuenta de Google y vuelve a conectar.");
    }
    const scopes = (t.scope ?? "").split(" ").filter(Boolean);
    if (!scopes.includes(SCOPE)) {
      throw new ProviderError("permission", "google_analytics", "No se concedió el permiso de lectura de Google Analytics.");
    }
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined,
      scopes,
      externalUserLabel: "Cuenta de Google",
    };
  },

  async refreshTokens(env, http, tokens) {
    if (!tokens.refreshToken) throw new ProviderError("auth", "google_analytics", "No hay refresh token almacenado");
    const res = await http.request("POST", TOKEN_URL, {
      form: {
        client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
    });
    if (res.status !== 200) {
      const err = (res.body ?? {}) as { error?: string };
      if (err.error === "invalid_grant" || res.status === 400 || res.status === 401) {
        throw new ProviderError("auth", "google_analytics", "La autorización de Google caducó o fue revocada (invalid_grant).", {
          status: res.status,
          providerCode: err.error,
        });
      }
      throw ga4Error(res, "refresh");
    }
    const t = tokenResponse.parse(res.body);
    return {
      ...tokens,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? tokens.refreshToken,
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined,
    };
  },

  async listAccounts(_env, http, tokens) {
    const out: ProviderAccountInfo[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await http.request("GET", `${ADMIN_API}/accountSummaries`, {
        headers: bearer(tokens),
        query: { pageSize: "200", pageToken },
      });
      if (res.status !== 200) throw ga4Error(res, "accountSummaries.list");
      const data = accountSummaries.parse(res.body);
      for (const acc of data.accountSummaries ?? []) {
        for (const p of acc.propertySummaries ?? []) {
          const id = p.property.replace(/^properties\//, "");
          if (!/^\d+$/.test(id)) continue;
          out.push({
            externalId: id,
            name: `${acc.displayName ?? "Cuenta"} › ${p.displayName ?? id}`,
            accountType: "ga4_property",
            currency: null,
            timezone: null,
            externalStatus: p.propertyType ?? null,
          });
        }
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  },

  async validateAccount(ctx: FetchContext): Promise<ValidationResult> {
    const pid = ctx.account.externalId;
    const res = await ctx.http.request("GET", `${ADMIN_API}/properties/${encodeURIComponent(pid)}`, { headers: bearer(ctx.tokens) });
    if (res.status === 403 || res.status === 404) {
      return { ok: false, code: "property_not_accessible", message: "La cuenta conectada ya no tiene acceso a esta propiedad de GA4." };
    }
    if (res.status !== 200) throw ga4Error(res, "properties.get");
    const prop = propertyResponse.parse(res.body);

    const unsupported: string[] = [];
    for (const def of Object.values(GA4_REPORTS)) {
      const c = await ctx.http.request("POST", `${DATA_API}/properties/${encodeURIComponent(pid)}:checkCompatibility`, {
        headers: bearer(ctx.tokens),
        json: { dimensions: def.dimensions.map((name) => ({ name })), metrics: def.metrics.map((name) => ({ name })) },
      });
      if (c.status !== 200) throw ga4Error(c, "checkCompatibility");
      const parsed = compatibilityResponse.parse(c.body);
      const bad = [
        ...(parsed.dimensionCompatibilities ?? []).filter((d) => d.compatibility && d.compatibility !== "COMPATIBLE"),
        ...(parsed.metricCompatibilities ?? []).filter((m) => m.compatibility && m.compatibility !== "COMPATIBLE"),
      ];
      if (bad.length > 0) unsupported.push(def.dataset);
    }
    return {
      ok: true,
      currency: prop.currencyCode ?? null,
      timezone: prop.timeZone ?? null,
      unsupportedDatasets: unsupported,
      notes: [],
    };
  },

  planChunks(range) {
    return splitRange(range, 30);
  },

  async fetchChunk(ctx, range): Promise<ChunkData> {
    const rows: WebDailyRow[] = [];
    const keyEvents: WebKeyEventRow[] = [];
    const flags: Record<string, QualityFlags> = {};
    const datasets: string[] = [];
    const stats: Record<string, number | string> = {};
    const skip = new Set(ctx.skipDatasets ?? []);

    for (const [breakdown, def] of Object.entries(GA4_REPORTS) as Array<[WebBreakdown | "key_events", (typeof GA4_REPORTS)["total"]]>) {
      if (skip.has(def.dataset)) continue;
      const result = await runReport(ctx.http, ctx.tokens, ctx.account.externalId, {
        dimensions: def.dimensions,
        metrics: def.metrics,
        range,
      });
      datasets.push(def.dataset);
      flags[def.dataset] = result.flags;
      stats[`${def.dataset}_rows`] = result.rows.length;
      for (const r of result.rows) {
        const dims = (r.dimensionValues ?? []).map((d) => d.value ?? "");
        const mets = (r.metricValues ?? []).map((m) => m.value);
        const date = toIsoDate(dims[0] ?? "");
        const metric = (name: string) => mets[def.metrics.indexOf(name)];
        if (breakdown === "key_events") {
          keyEvents.push({ date, eventName: (dims[1] ?? "").slice(0, 200), keyEvents: decOrNull(metric("keyEvents")) });
          continue;
        }
        rows.push({
          breakdown,
          date,
          dimensionValue: breakdown === "total" ? "" : (dims[1] ?? "").slice(0, 500),
          sessions: intOrNull(metric("sessions")),
          engagedSessions: intOrNull(metric("engagedSessions")),
          totalUsers: def.metrics.includes("totalUsers") ? intOrNull(metric("totalUsers")) : null,
          newUsers: def.metrics.includes("newUsers") ? intOrNull(metric("newUsers")) : null,
          screenPageViews: def.metrics.includes("screenPageViews") ? intOrNull(metric("screenPageViews")) : null,
          keyEvents: decOrNull(metric("keyEvents")),
        });
      }
      if (result.quota) {
        const tokensPerHour = (result.quota as { tokensPerHour?: { remaining?: number } }).tokensPerHour?.remaining;
        if (typeof tokensPerHour === "number") stats.quota_tokens_per_hour_remaining = tokensPerHour;
      }
    }
    return { family: "web", range, datasets, rows, keyEvents, flags, stats };
  },

  async fetchSnapshots(ctx, ranges): Promise<SnapshotValue[]> {
    const out: SnapshotValue[] = [];
    for (const range of ranges) {
      const result = await runReport(ctx.http, ctx.tokens, ctx.account.externalId, {
        dimensions: [],
        metrics: ["totalUsers", "activeUsers"],
        range,
      });
      const mets = result.rows[0]?.metricValues ?? [];
      // Consulta exitosa sin filas: GA4 omite filas con métricas en cero (keepEmptyRows=false),
      // por lo que el valor es un cero real. Un error de la consulta nunca llega aquí.
      out.push({ metric: "total_users", range, value: result.rows.length ? decOrNull(mets[0]?.value) : "0" });
      out.push({ metric: "active_users", range, value: result.rows.length ? decOrNull(mets[1]?.value) : "0" });
    }
    return out;
  },

  async revoke(_env, http, tokens) {
    const token = tokens.refreshToken ?? tokens.accessToken;
    const res = await http.request("POST", REVOKE_URL, { form: { token } });
    if (res.status !== 200) throw ga4Error(res, "revoke");
  },
};

export type Ga4Env = Pick<ServerEnv, "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET">;
