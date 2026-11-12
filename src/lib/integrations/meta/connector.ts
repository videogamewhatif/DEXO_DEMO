import { createHmac } from "node:crypto";
import { z } from "zod";
import type {
  AdActionRow,
  AdCampaignDailyRow,
  CampaignInfo,
  ChunkData,
  Connector,
  DateRange,
  FetchContext,
  OAuthTokens,
  ProviderAccountInfo,
  SnapshotValue,
  ValidationResult,
} from "../contract";
import { splitRange } from "../contract";
import { ProviderError } from "../errors";
import type { HttpResponse, ProviderHttp } from "../http";
import type { ServerEnv } from "@/config/env";

/**
 * Meta Ads (Marketing API)
 * - Inicio de sesión manual de Facebook Login (código de autorización):
 *   https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 * - Token de larga duración (~60 días) con grant_type=fb_exchange_token. NO hay refresh token:
 *   al vencer, el usuario debe reconectar.
 *   https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 * - appsecret_proof (HMAC-SHA256 del token con el app secret) en cada llamada.
 * - Insights: /act_{id}/insights con level=campaign y time_increment=1.
 * - PKCE: no se usa porque la documentación de Meta consultada no lo describe para este flujo;
 *   la protección se basa en state de un solo uso y en el intercambio de código desde servidor.
 */
const PROVIDER = "meta_ads";
const SCOPE = "ads_read";
const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "account_currency",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "reach",
  "actions",
  "action_values",
  "attribution_setting",
  "date_start",
  "date_stop",
].join(",");
const MAX_PAGES = 200;

const graph = (env: ServerEnv) => `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;

export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

const errorBody = z.object({
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.number().optional(),
      error_subcode: z.number().optional(),
      fbtrace_id: z.string().optional(),
    })
    .optional(),
});

/** Uso informado en cabeceras de límite; devuelve espera sugerida en ms si hay bloqueo. */
export function parseMetaThrottle(headers: Headers): { waitMs?: number; utilization?: number } {
  let waitMs: number | undefined;
  let utilization: number | undefined;
  for (const name of ["x-business-use-case-usage", "x-business-use-case"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, Array<{ estimated_time_to_regain_access?: number; call_count?: number; total_time?: number; total_cputime?: number }>>;
      for (const entries of Object.values(parsed)) {
        for (const e of entries ?? []) {
          const minutes = e.estimated_time_to_regain_access ?? 0;
          if (minutes > 0) waitMs = Math.max(waitMs ?? 0, minutes * 60_000);
          utilization = Math.max(utilization ?? 0, e.call_count ?? 0, e.total_time ?? 0, e.total_cputime ?? 0);
        }
      }
    } catch {
      /* cabecera no JSON: se ignora */
    }
  }
  const insights = headers.get("x-fb-ads-insights-throttle");
  if (insights) {
    try {
      const t = JSON.parse(insights) as { app_id_util_pct?: number; acc_id_util_pct?: number };
      utilization = Math.max(utilization ?? 0, t.app_id_util_pct ?? 0, t.acc_id_util_pct ?? 0);
    } catch {
      /* ignorar */
    }
  }
  return { waitMs, utilization };
}

export function metaError(res: HttpResponse, context: string): ProviderError {
  const parsed = errorBody.safeParse(res.body);
  const e = parsed.success ? parsed.data.error : undefined;
  const code = e?.code;
  const sub = e?.error_subcode;
  const message = `${context}: ${e?.message ?? `HTTP ${res.status}`}`;
  const details = { status: res.status, providerCode: code, providerSubcode: sub, traceId: e?.fbtrace_id };
  const throttle = parseMetaThrottle(res.headers);
  if (code === 190 || code === 102 || res.status === 401) return new ProviderError("auth", PROVIDER, message, details);
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== undefined && code >= 80000 && code <= 80014) || res.status === 429) {
    return new ProviderError("rate_limited", PROVIDER, message, { ...details, retryAfterMs: throttle.waitMs ?? 5 * 60_000 });
  }
  if (code === 100 && sub === 1487534) return new ProviderError("too_much_data", PROVIDER, message, details);
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300) || res.status === 403) {
    return new ProviderError("permission", PROVIDER, message, details);
  }
  if (code === 1 || code === 2 || res.status >= 500) return new ProviderError("transient", PROVIDER, message, details);
  return new ProviderError("invalid_request", PROVIDER, message, details);
}

const tokenResponse = z.object({ access_token: z.string().min(1), token_type: z.string().optional(), expires_in: z.number().optional() });
const paging = z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional();

const actionList = z
  .array(z.object({ action_type: z.string(), value: z.union([z.string(), z.number()]).optional() }).passthrough())
  .optional();

const insightRow = z.object({
  campaign_id: z.string().optional(),
  campaign_name: z.string().optional(),
  account_currency: z.string().optional(),
  spend: z.union([z.string(), z.number()]).optional(),
  impressions: z.union([z.string(), z.number()]).optional(),
  clicks: z.union([z.string(), z.number()]).optional(),
  inline_link_clicks: z.union([z.string(), z.number()]).optional(),
  reach: z.union([z.string(), z.number()]).optional(),
  actions: actionList,
  action_values: actionList,
  attribution_setting: z.string().optional(),
  date_start: z.string(),
  date_stop: z.string().optional(),
});
const insightsPage = z.object({ data: z.array(insightRow), paging });

const adAccount = z.object({
  id: z.string(),
  account_id: z.string().optional(),
  name: z.string().optional(),
  currency: z.string().optional(),
  timezone_name: z.string().optional(),
  account_status: z.number().optional(),
});

const ACCOUNT_STATUS: Record<number, string> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
};

function numStr(v: string | number | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return Number.isFinite(Number(s)) ? s : null;
}
function intOrNull(v: string | number | undefined): number | null {
  const s = numStr(v);
  return s === null ? null : Math.round(Number(s));
}

function authQuery(env: ServerEnv, tokens: OAuthTokens) {
  return { access_token: tokens.accessToken, appsecret_proof: appSecretProof(tokens.accessToken, env.META_APP_SECRET ?? "") };
}

function actId(externalId: string) {
  const id = externalId.replace(/^act_/, "");
  if (!/^\d+$/.test(id)) throw new ProviderError("invalid_request", PROVIDER, "Identificador de cuenta publicitaria inválido");
  return `act_${id}`;
}

async function getPaged<T>(
  http: ProviderHttp,
  env: ServerEnv,
  tokens: OAuthTokens,
  url: string,
  query: Record<string, string>,
  schema: z.ZodType<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>,
  context: string,
  sleep: (ms: number) => Promise<void>,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await http.request("GET", url, { query: { ...query, ...authQuery(env, tokens), after } });
    if (res.status !== 200) throw metaError(res, context);
    const parsed = schema.safeParse(res.body);
    if (!parsed.success) throw new ProviderError("invalid_request", PROVIDER, `${context}: respuesta con formato inesperado`);
    out.push(...parsed.data.data);
    const throttle = parseMetaThrottle(res.headers);
    if (throttle.utilization !== undefined && throttle.utilization >= 90) await sleep(30_000);
    // Se sigue el cursor `after`, no la URL `next` (que incluye el token en claro).
    after = parsed.data.paging?.next ? parsed.data.paging?.cursors?.after : undefined;
    if (!after) return out;
  }
  throw new ProviderError("too_much_data", PROVIDER, `${context}: demasiadas páginas`);
}

function normalizeInsights(rows: z.infer<typeof insightRow>[], fallbackCurrency: string | null) {
  const out: AdCampaignDailyRow[] = [];
  const actions: AdActionRow[] = [];
  const campaigns = new Map<string, CampaignInfo>();
  for (const r of rows) {
    const campaignId = r.campaign_id;
    if (!campaignId) continue;
    const currency = (r.account_currency ?? fallbackCurrency ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ProviderError("invalid_request", PROVIDER, "Fila de insights sin moneda válida");
    }
    if (r.campaign_name) campaigns.set(campaignId, { externalId: campaignId, name: r.campaign_name, status: null, objective: null });
    out.push({
      campaignExternalId: campaignId,
      date: r.date_start,
      currency,
      spend: numStr(r.spend),
      impressions: intOrNull(r.impressions),
      clicks: intOrNull(r.clicks),
      linkClicks: intOrNull(r.inline_link_clicks),
      reach: intOrNull(r.reach),
      attributionSetting: r.attribution_setting ?? null,
    });
    const byType = new Map<string, AdActionRow>();
    for (const a of r.actions ?? []) {
      byType.set(a.action_type, {
        campaignExternalId: campaignId,
        date: r.date_start,
        actionType: a.action_type.slice(0, 200),
        value: numStr(a.value),
        actionValue: null,
        attributionSetting: r.attribution_setting ?? null,
      });
    }
    for (const a of r.action_values ?? []) {
      const existing = byType.get(a.action_type);
      if (existing) existing.actionValue = numStr(a.value);
      else
        byType.set(a.action_type, {
          campaignExternalId: campaignId,
          date: r.date_start,
          actionType: a.action_type.slice(0, 200),
          value: null,
          actionValue: numStr(a.value),
          attributionSetting: r.attribution_setting ?? null,
        });
    }
    actions.push(...byType.values());
  }
  return { rows: out, actions, campaigns };
}

async function fetchInsightsAsync(ctx: FetchContext, range: DateRange, sleep: (ms: number) => Promise<void>) {
  const { http, env, tokens } = ctx;
  const start = await http.request("POST", `${graph(env)}/${actId(ctx.account.externalId)}/insights`, {
    query: {
      ...authQuery(env, tokens),
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since: range.from, until: range.to }),
      fields: INSIGHT_FIELDS,
      use_unified_attribution_setting: "true",
    },
  });
  if (start.status !== 200) throw metaError(start, "insights async (inicio)");
  const runId = (start.body as { report_run_id?: string | number }).report_run_id;
  if (!runId || !/^\d+$/.test(String(runId))) throw new ProviderError("invalid_request", PROVIDER, "Meta no devolvió report_run_id");

  const deadline = Date.now() + env.META_ASYNC_POLL_TIMEOUT_MS;
  let delay = 2_000;
  for (;;) {
    const st = await http.request("GET", `${graph(env)}/${runId}`, {
      query: { ...authQuery(env, tokens), fields: "async_status,async_percent_completion" },
    });
    if (st.status !== 200) throw metaError(st, "insights async (estado)");
    const status = (st.body as { async_status?: string; async_percent_completion?: number }) ?? {};
    if (status.async_status === "Job Completed" && (status.async_percent_completion ?? 100) >= 100) break;
    if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
      throw new ProviderError("transient", PROVIDER, `El reporte asíncrono terminó con estado ${status.async_status}`);
    }
    if (Date.now() > deadline) throw new ProviderError("transient", PROVIDER, "El reporte asíncrono no terminó a tiempo");
    await sleep(delay);
    delay = Math.min(delay * 2, 30_000);
  }
  return getPaged(http, env, tokens, `${graph(env)}/${runId}/insights`, { limit: "500" }, insightsPage, "insights async (resultados)", sleep);
}

export const metaAdsConnector: Connector = {
  descriptor: {
    id: "meta_ads",
    name: "Meta Ads",
    shortDescription: "Inversión, impresiones, clics en enlaces y resultados por campaña (Facebook e Instagram Ads).",
    category: "ads",
    capabilities: ["oauth_authorization_code", "long_lived_token", "token_revocation", "list_accounts", "ads_campaign_daily", "period_snapshots", "async_reports"],
    accountTypeLabel: "Cuenta publicitaria",
    scopes: [SCOPE],
    docsPath: "docs/guia-meta.md",
  },
  allowedHosts: ["www.facebook.com", "graph.facebook.com"],

  configStatus(env) {
    const missing = [!env.META_APP_ID && "META_APP_ID", !env.META_APP_SECRET && "META_APP_SECRET"].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  },

  usesPkce() {
    return false;
  },

  buildAuthorizationUrl(env, { state, redirectUri }) {
    const url = new URL(`https://www.facebook.com/${env.META_GRAPH_API_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", env.META_APP_ID ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    // Apps de tipo Business con Facebook Login for Business usan una configuración (config_id)
    // que define los permisos; si no se configura, se usa el flujo manual con `scope`.
    if (env.META_LOGIN_CONFIG_ID) url.searchParams.set("config_id", env.META_LOGIN_CONFIG_ID);
    else url.searchParams.set("scope", SCOPE);
    return url.toString();
  },

  async exchangeCode(env, http, { code, redirectUri }) {
    const short = await http.request("GET", `${graph(env)}/oauth/access_token`, {
      query: { client_id: env.META_APP_ID ?? "", client_secret: env.META_APP_SECRET ?? "", redirect_uri: redirectUri, code },
    });
    if (short.status !== 200) throw metaError(short, "Intercambio de código");
    const s = tokenResponse.parse(short.body);

    const long = await http.request("GET", `${graph(env)}/oauth/access_token`, {
      query: {
        grant_type: "fb_exchange_token",
        client_id: env.META_APP_ID ?? "",
        client_secret: env.META_APP_SECRET ?? "",
        fb_exchange_token: s.access_token,
      },
    });
    if (long.status !== 200) throw metaError(long, "Token de larga duración");
    const l = tokenResponse.parse(long.body);
    const tokens: OAuthTokens = {
      accessToken: l.access_token,
      expiresAt: l.expires_in ? new Date(Date.now() + l.expires_in * 1000).toISOString() : undefined,
      scopes: [],
    };

    const perms = await http.request("GET", `${graph(env)}/me/permissions`, { query: authQuery(env, tokens) });
    if (perms.status !== 200) throw metaError(perms, "Permisos concedidos");
    const granted = ((perms.body as { data?: Array<{ permission: string; status: string }> }).data ?? [])
      .filter((p) => p.status === "granted")
      .map((p) => p.permission);
    if (!granted.includes(SCOPE)) {
      throw new ProviderError("permission", PROVIDER, "No se concedió el permiso ads_read. Vuelve a conectar y acepta el permiso.");
    }
    tokens.scopes = granted;

    const me = await http.request("GET", `${graph(env)}/me`, { query: { ...authQuery(env, tokens), fields: "name" } });
    if (me.status === 200) tokens.externalUserLabel = (me.body as { name?: string }).name?.slice(0, 200);
    return tokens;
  },

  async listAccounts(env, http, tokens) {
    const accounts = await getPaged(
      http,
      env,
      tokens,
      `${graph(env)}/me/adaccounts`,
      { fields: "id,account_id,name,currency,timezone_name,account_status", limit: "100" },
      z.object({ data: z.array(adAccount), paging }),
      "Listado de cuentas publicitarias",
      async () => undefined,
    );
    return accounts.map<ProviderAccountInfo>((a) => ({
      externalId: (a.account_id ?? a.id).replace(/^act_/, ""),
      name: a.name ?? a.id,
      accountType: "meta_ad_account",
      currency: a.currency?.toUpperCase() ?? null,
      timezone: a.timezone_name ?? null,
      externalStatus: a.account_status !== undefined ? (ACCOUNT_STATUS[a.account_status] ?? String(a.account_status)) : null,
    }));
  },

  async validateAccount(ctx: FetchContext): Promise<ValidationResult> {
    const res = await ctx.http.request("GET", `${graph(ctx.env)}/${actId(ctx.account.externalId)}`, {
      query: { ...authQuery(ctx.env, ctx.tokens), fields: "id,name,currency,timezone_name,account_status" },
    });
    if (res.status !== 200) {
      const err = metaError(res, "Validación de cuenta");
      if (err.kind === "permission" || err.kind === "invalid_request") {
        return { ok: false, code: "ad_account_not_accessible", message: "La cuenta conectada no tiene acceso a esta cuenta publicitaria." };
      }
      throw err;
    }
    const a = adAccount.parse(res.body);
    const notes: string[] = [];
    if (a.account_status !== undefined && a.account_status !== 1) {
      notes.push(`Estado de la cuenta en Meta: ${ACCOUNT_STATUS[a.account_status] ?? a.account_status}`);
    }
    return { ok: true, currency: a.currency?.toUpperCase() ?? null, timezone: a.timezone_name ?? null, unsupportedDatasets: [], notes };
  },

  planChunks(range) {
    return splitRange(range, 7);
  },

  async fetchChunk(ctx, range): Promise<ChunkData> {
    const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let raw: z.infer<typeof insightRow>[];
    let mode = "sync";
    const query = {
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since: range.from, until: range.to }),
      fields: INSIGHT_FIELDS,
      use_unified_attribution_setting: "true",
      limit: "500",
    };
    if (ctx.preferAsync) {
      raw = await fetchInsightsAsync(ctx, range, sleep);
      mode = "async";
    } else {
      try {
        raw = await getPaged(ctx.http, ctx.env, ctx.tokens, `${graph(ctx.env)}/${actId(ctx.account.externalId)}/insights`, query, insightsPage, "insights", sleep);
      } catch (err) {
        if (err instanceof ProviderError && err.kind === "too_much_data") {
          raw = await fetchInsightsAsync(ctx, range, sleep);
          mode = "async";
        } else throw err;
      }
    }
    const normalized = normalizeInsights(raw, ctx.account.currency);

    // Metadatos de campañas (nombre, estado, objetivo).
    const campaignMeta = await getPaged(
      ctx.http,
      ctx.env,
      ctx.tokens,
      `${graph(ctx.env)}/${actId(ctx.account.externalId)}/campaigns`,
      { fields: "id,name,status,objective", limit: "500" },
      z.object({ data: z.array(z.object({ id: z.string(), name: z.string().optional(), status: z.string().optional(), objective: z.string().optional() })), paging }),
      "campañas",
      sleep,
    );
    for (const c of campaignMeta) {
      if (!normalized.campaigns.has(c.id) && !normalized.rows.some((r) => r.campaignExternalId === c.id)) continue;
      normalized.campaigns.set(c.id, { externalId: c.id, name: c.name ?? normalized.campaigns.get(c.id)?.name ?? c.id, status: c.status ?? null, objective: c.objective ?? null });
    }

    return {
      family: "ads",
      range,
      datasets: ["ads_campaign_daily"],
      campaigns: [...normalized.campaigns.values()],
      rows: normalized.rows,
      actions: normalized.actions,
      flags: {},
      stats: { insight_rows: raw.length, mode },
    };
  },

  async fetchSnapshots(ctx, ranges): Promise<SnapshotValue[]> {
    const out: SnapshotValue[] = [];
    for (const range of ranges) {
      const res = await ctx.http.request("GET", `${graph(ctx.env)}/${actId(ctx.account.externalId)}/insights`, {
        query: { ...authQuery(ctx.env, ctx.tokens), level: "account", fields: "reach", time_range: JSON.stringify({ since: range.from, until: range.to }) },
      });
      if (res.status !== 200) throw metaError(res, "alcance del periodo");
      const data = (res.body as { data?: Array<{ reach?: string }> }).data ?? [];
      // Sin filas: no hubo entrega en el periodo (alcance real cero).
      out.push({ metric: "reach", range, value: data.length ? numStr(data[0]?.reach) : "0" });
    }
    return out;
  },

  async revoke(env, http, tokens) {
    const res = await http.request("DELETE", `${graph(env)}/me/permissions`, { query: authQuery(env, tokens) });
    if (res.status !== 200) throw metaError(res, "Revocación de permisos");
  },
};
