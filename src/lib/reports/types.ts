import type { DateRange } from "@/lib/metrics/periods";

export type SourceId = "meta_ads" | "google_analytics";

export interface OrgReportSettings {
  timezone: string;
  displayCurrency: string | null;
  ga4LeadEventName: string | null;
  metaLeadActionType: string | null;
  metaPurchaseActionType: string | null;
}

export interface AccountInfo {
  id: string;
  provider: SourceId;
  name: string;
  externalId: string;
  currency: string | null;
  timezone: string | null;
  isSelected: boolean;
  lastSuccessfulSyncAt: string | null;
  integrationStatus: string | null;
  hasActiveJob: boolean;
}

export interface AdRow {
  accountId: string;
  campaignExternalId: string;
  date: string;
  currency: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  reach: number | null;
  attributionSetting: string | null;
}

export interface AdActionRecord {
  accountId: string;
  campaignExternalId: string;
  date: string;
  actionType: string;
  value: number | null;
  actionValue: number | null;
}

export interface CampaignRecord {
  accountId: string;
  externalId: string;
  name: string;
  status: string | null;
  objective: string | null;
}

export type WebBreakdownId = "total" | "source_medium" | "campaign" | "landing_page" | "device";

export interface WebRow {
  accountId: string;
  breakdown: WebBreakdownId;
  date: string;
  dimensionValue: string;
  sessions: number | null;
  engagedSessions: number | null;
  totalUsers: number | null;
  newUsers: number | null;
  screenPageViews: number | null;
  keyEvents: number | null;
}

export interface KeyEventRecord {
  accountId: string;
  date: string;
  eventName: string;
  keyEvents: number | null;
}

export interface CoverageRecord {
  accountId: string;
  dataset: string;
  date: string;
  syncedAt: string;
  flags: { thresholded?: boolean; otherRow?: boolean; sampled?: boolean };
}

export interface SnapshotRecord {
  accountId: string;
  metric: "total_users" | "active_users" | "reach";
  from: string;
  to: string;
  value: number | null;
}

export interface RawReportData {
  accounts: AccountInfo[];
  adRows: AdRow[];
  adActions: AdActionRecord[];
  campaigns: CampaignRecord[];
  webRows: WebRow[];
  keyEvents: KeyEventRecord[];
  coverage: CoverageRecord[];
  snapshots: SnapshotRecord[];
}

export interface ReportFilters {
  range: DateRange;
  compare: boolean;
  source: "all" | SourceId;
  /** Subconjunto de cuentas; vacío = todas las seleccionadas visibles. */
  accountIds: string[];
}

export interface ReportRepository {
  readonly mode: "live" | "demo";
  settings(): Promise<OrgReportSettings>;
  accounts(): Promise<AccountInfo[]>;
  /** Carga filas para [from, to] de las cuentas indicadas (ya autorizadas). */
  load(range: DateRange, accountIds: string[]): Promise<RawReportData>;
}
