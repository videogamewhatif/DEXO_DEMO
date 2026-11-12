import type { ServerEnv } from "@/config/env";
import type { ProviderHttp } from "./http";

/**
 * Contrato común de conectores. Cada conector declara sus capacidades reales;
 * el motor de sincronización y la interfaz solo usan lo declarado.
 */
export type ProviderId = "google_analytics" | "meta_ads";
export type ConnectorCategory = "web" | "ads" | "social" | "search" | "crm" | "reporting";

export type ConnectorCapability =
  | "oauth_authorization_code"
  | "pkce"
  | "refresh_token" // renovación sin intervención del usuario
  | "long_lived_token" // token de larga duración sin refresh (requiere reconexión al vencer)
  | "token_revocation"
  | "list_accounts"
  | "web_analytics_daily"
  | "ads_campaign_daily"
  | "period_snapshots"
  | "async_reports";

export interface ConnectorDescriptor {
  id: ProviderId;
  name: string;
  shortDescription: string;
  category: ConnectorCategory;
  capabilities: readonly ConnectorCapability[];
  accountTypeLabel: string;
  scopes: readonly string[];
  docsPath: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Momento de expiración del access token (ISO). */
  expiresAt?: string;
  scopes: string[];
  externalUserLabel?: string;
}

export interface ProviderAccountInfo {
  externalId: string;
  name: string;
  accountType: "ga4_property" | "meta_ad_account";
  currency: string | null;
  timezone: string | null;
  externalStatus: string | null;
}

export interface DateRange {
  /** YYYY-MM-DD inclusivo, en la zona horaria de la cuenta. */
  from: string;
  to: string;
}

export interface AccountRef {
  id: string;
  externalId: string;
  currency: string | null;
  timezone: string | null;
}

export type ValidationResult =
  | { ok: true; currency: string | null; timezone: string | null; unsupportedDatasets: string[]; notes: string[] }
  | { ok: false; code: string; message: string };

// ---- Datos normalizados -----------------------------------------------------

export interface AdCampaignDailyRow {
  campaignExternalId: string;
  date: string;
  currency: string;
  spend: string | null; // decimal en texto para no perder precisión
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  reach: number | null;
  attributionSetting: string | null;
}

export interface AdActionRow {
  campaignExternalId: string;
  date: string;
  actionType: string;
  value: string | null;
  actionValue: string | null;
  attributionSetting: string | null;
}

export interface CampaignInfo {
  externalId: string;
  name: string;
  status: string | null;
  objective: string | null;
}

export type WebBreakdown = "total" | "source_medium" | "campaign" | "landing_page" | "device";

export interface WebDailyRow {
  breakdown: WebBreakdown;
  date: string;
  dimensionValue: string;
  sessions: number | null;
  engagedSessions: number | null;
  totalUsers: number | null;
  newUsers: number | null;
  screenPageViews: number | null;
  keyEvents: string | null;
}

export interface WebKeyEventRow {
  date: string;
  eventName: string;
  keyEvents: string | null;
}

export interface QualityFlags {
  thresholded?: boolean;
  otherRow?: boolean;
  sampled?: boolean;
}

export type ChunkData =
  | {
      family: "ads";
      range: DateRange;
      datasets: string[];
      campaigns: CampaignInfo[];
      rows: AdCampaignDailyRow[];
      actions: AdActionRow[];
      flags: Record<string, QualityFlags>;
      stats: Record<string, number | string>;
    }
  | {
      family: "web";
      range: DateRange;
      datasets: string[];
      rows: WebDailyRow[];
      keyEvents: WebKeyEventRow[];
      flags: Record<string, QualityFlags>;
      stats: Record<string, number | string>;
    };

export interface SnapshotValue {
  metric: "total_users" | "active_users" | "reach";
  range: DateRange;
  value: string | null;
}

export interface FetchContext {
  tokens: OAuthTokens;
  account: AccountRef;
  http: ProviderHttp;
  env: ServerEnv;
  /** Conjuntos de datos que no deben consultarse (p. ej. incompatibles). */
  skipDatasets?: string[];
  /** Inyectable para pruebas (esperas de reportes asíncronos y límites). */
  sleep?: (ms: number) => Promise<void>;
  /** Fuerza el modo de reporte asíncrono (Meta). */
  preferAsync?: boolean;
}

export interface ConfigStatus {
  configured: boolean;
  missing: string[];
}

export interface Connector {
  descriptor: ConnectorDescriptor;
  allowedHosts: readonly string[];
  configStatus(env: ServerEnv): ConfigStatus;
  buildAuthorizationUrl(env: ServerEnv, p: { state: string; redirectUri: string; codeChallenge?: string }): string;
  usesPkce(env: ServerEnv): boolean;
  exchangeCode(env: ServerEnv, http: ProviderHttp, p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthTokens>;
  /** Solo si declara "refresh_token". */
  refreshTokens?(env: ServerEnv, http: ProviderHttp, tokens: OAuthTokens): Promise<OAuthTokens>;
  listAccounts(env: ServerEnv, http: ProviderHttp, tokens: OAuthTokens): Promise<ProviderAccountInfo[]>;
  validateAccount(ctx: FetchContext): Promise<ValidationResult>;
  /** Divide el periodo en ventanas manejables (checkpoints). */
  planChunks(range: DateRange): DateRange[];
  fetchChunk(ctx: FetchContext, range: DateRange): Promise<ChunkData>;
  fetchSnapshots?(ctx: FetchContext, ranges: DateRange[]): Promise<SnapshotValue[]>;
  /** Solo si declara "token_revocation". Errores se ignoran tras registrarlos. */
  revoke?(env: ServerEnv, http: ProviderHttp, tokens: OAuthTokens): Promise<void>;
}

export function splitRange(range: DateRange, days: number): DateRange[] {
  const out: DateRange[] = [];
  let cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + days - 1);
    const to = chunkEnd < end ? chunkEnd : end;
    out.push({ from: cursor.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    cursor = new Date(to);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
