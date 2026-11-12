import type { ReactNode } from "react";
import type { Report } from "@/lib/reports/builder";
import type { ParsedFilters } from "@/lib/reports/filters";
import type { OrgReportSettings } from "@/lib/reports/types";
import { FilterBar, type FilterAccountOption } from "@/components/reports/FilterBar";
import { FreshnessBar, StaleWarnings } from "@/components/reports/Freshness";
import { Alert, EmptyState, LinkButton } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";

export interface ReportViewProps {
  report: Report;
  settings: OrgReportSettings;
  filters: ParsedFilters;
  timezone: string;
  demo: boolean;
  basePath: string;
  canManageIntegrations: boolean;
}

export function accountOptions(report: Report, all: Report["accounts"]): FilterAccountOption[] {
  void report;
  return all.map((a) => ({ id: a.id, name: a.name, provider: a.provider }));
}

export function ReportFrame({ props, allAccounts, showSource = true, children }: { props: ReportViewProps; allAccounts: Report["accounts"]; showSource?: boolean; children: ReactNode }) {
  const { report, filters, timezone, demo } = props;
  return (
    <>
      <FilterBar
        preset={filters.preset}
        from={filters.range.from}
        to={filters.range.to}
        compare={filters.compare}
        source={filters.source}
        accountIds={filters.accountIds}
        accounts={allAccounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))}
        showSource={showSource}
        today={filters.today}
      />
      {filters.error && <div className="mb-3"><Alert tone="warn">{filters.error}</Alert></div>}
      <p className="mb-1 text-sm">
        <strong>{formatDate(report.range.from)} – {formatDate(report.range.to)}</strong>
        {report.previousRange && <span className="text-muted"> · comparado con {formatDate(report.previousRange.from)} – {formatDate(report.previousRange.to)}</span>}
      </p>
      <FreshnessBar report={report} timezone={timezone} demo={demo} />
      <StaleWarnings report={report} />
      {children}
    </>
  );
}

export function NoSources({ basePath, canManage, what }: { basePath: string; canManage: boolean; what: string }) {
  return (
    <EmptyState
      title={`No hay ${what} conectadas`}
      action={canManage ? <LinkButton href={`${basePath}/integraciones`}>Ir a Integraciones</LinkButton> : undefined}
    >
      {canManage
        ? "Conecta una fuente y selecciona sus cuentas para empezar a sincronizar."
        : "Pide a un administrador de la empresa que conecte una fuente en Integraciones."}
    </EmptyState>
  );
}
