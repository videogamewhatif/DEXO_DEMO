import { loadReport } from "@/lib/reports/load";
import { parseFilters } from "@/lib/reports/filters";
import type { ReportRepository } from "@/lib/reports/types";
import { todayInTimeZone } from "@/lib/metrics/periods";
import { PageHeader, Alert } from "@/components/ui/primitives";
import { AdsView, OverviewView, WebView } from "./ReportViews";

export type ReportKind = "overview" | "ads" | "web";

const TITLES: Record<ReportKind, { title: string; description: string }> = {
  overview: { title: "Resumen", description: "Indicadores principales de las fuentes conectadas, con su definición y frescura." },
  ads: { title: "Publicidad", description: "Inversión y resultados de campañas por moneda y cuenta." },
  web: { title: "Sitio web y landings", description: "Tráfico, interacción y eventos clave de Google Analytics 4." },
};

export async function ReportPage(props: {
  kind: ReportKind;
  repo: ReportRepository;
  timezone: string;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
  demo: boolean;
  canManageIntegrations: boolean;
}) {
  const filters = parseFilters(props.searchParams, todayInTimeZone(props.timezone));
  let loaded;
  try {
    loaded = await loadReport(props.repo, filters);
  } catch (err) {
    console.error("[reportes] error al cargar:", err instanceof Error ? err.name : "desconocido");
    return (
      <>
        <PageHeader title={TITLES[props.kind].title} />
        <Alert tone="danger" title="No se pudo cargar el reporte">Inténtalo de nuevo en unos minutos. Si persiste, contacta a soporte.</Alert>
      </>
    );
  }
  const common = {
    report: loaded.report,
    settings: loaded.settings,
    filters,
    timezone: props.timezone,
    demo: props.demo,
    basePath: props.basePath,
    canManageIntegrations: props.canManageIntegrations,
    allAccounts: loaded.raw.accounts.filter((a) => a.isSelected || a.lastSuccessfulSyncAt),
  };
  return (
    <>
      <PageHeader title={TITLES[props.kind].title} description={TITLES[props.kind].description} />
      {props.kind === "overview" && <OverviewView {...common} />}
      {props.kind === "ads" && <AdsView {...common} />}
      {props.kind === "web" && <WebView {...common} />}
    </>
  );
}
