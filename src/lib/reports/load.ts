import { previousPeriod } from "@/lib/metrics/periods";
import { buildReport, scopeAccounts, type Report } from "./builder";
import type { ParsedFilters } from "./filters";
import type { OrgReportSettings, RawReportData, ReportRepository } from "./types";

export interface LoadedReport {
  report: Report;
  settings: OrgReportSettings;
  raw: RawReportData;
}

export async function loadReport(repo: ReportRepository, filters: ParsedFilters): Promise<LoadedReport> {
  const [settings, accounts] = await Promise.all([repo.settings(), repo.accounts()]);
  const scoped = scopeAccounts(accounts, filters);
  const from = filters.compare ? previousPeriod(filters.range).from : filters.range.from;
  const raw = await repo.load({ from, to: filters.range.to }, scoped.map((a) => a.id));
  return { report: buildReport(raw, filters, settings), settings, raw };
}
