import { CoverageNote, KpiCard, KpiGrid } from "@/components/reports/Kpi";
import { TrendChart } from "@/components/reports/TrendChart";
import { DataTable, type Column, type Row } from "@/components/reports/DataTable";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import type { MetricKey } from "@/lib/metrics/definitions";
import type { AdsCurrencyGroup, Report, WebDimensionRow } from "@/lib/reports/builder";
import { formatRelative } from "@/lib/format";
import { NoSources, ReportFrame, type ReportViewProps } from "./report-shared";

const PROVIDER_LABEL = { meta_ads: "Meta Ads", google_analytics: "Google Analytics 4" } as const;

function AdsGroup({ g, keys, settings }: { g: AdsCurrencyGroup; keys: MetricKey[]; settings: ReportViewProps["settings"] }) {
  return (
    <section aria-labelledby={`ads-${g.currency}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`ads-${g.currency}`} className="font-semibold">Meta Ads · {g.currency}</h3>
        <Badge>{g.accounts.length} cuenta(s)</Badge>
        {g.attributionSettings.length > 0 && <Badge tone="info">Atribución: {g.attributionSettings.join(", ")}</Badge>}
        {!settings.metaLeadActionType && <Badge tone="warn">Prospecto sin definir</Badge>}
      </div>
      <CoverageNote {...g.coverage} />
      <KpiGrid>
        {keys.map((k) => (
          <KpiCard key={k} k={k} cell={g.metrics[k]} currency={g.currency} />
        ))}
      </KpiGrid>
    </section>
  );
}

function CurrencyNotice({ report }: { report: Report }) {
  if (report.ads.length < 2) return null;
  return (
    <Alert tone="info" title="Varias monedas">
      Las cuentas publicitarias usan {report.ads.map((g) => g.currency).join(", ")}. Los montos se muestran por moneda: no se convierten ni se suman.
    </Alert>
  );
}

function WebFlags({ report }: { report: Report }) {
  const f = report.web?.qualityFlags;
  if (!f || (!f.thresholded && !f.otherRow && !f.sampled)) return null;
  return (
    <Alert tone="warn" title="Calidad de datos de GA4">
      {f.thresholded && "Google aplicó umbrales de privacidad: algunas filas pueden estar ocultas. "}
      {f.otherRow && "Algunas tablas agrupan valores poco frecuentes en «(other)» por límites de cardinalidad. "}
      {f.sampled && "Algunos reportes están muestreados."}
    </Alert>
  );
}

const campaignColumns: Column[] = [
  { key: "name", label: "Campaña", kind: "text" },
  { key: "account", label: "Cuenta", kind: "text" },
  { key: "currency", label: "Moneda", kind: "text" },
  { key: "spend", label: "Inversión", kind: "metric", unit: "currency", currencyKey: "currency" },
  { key: "impressions", label: "Impresiones", kind: "metric", unit: "count" },
  { key: "linkClicks", label: "Clics en enlaces", kind: "metric", unit: "count" },
  { key: "ctr", label: "CTR", kind: "metric", unit: "percent" },
  { key: "cpc", label: "CPC", kind: "metric", unit: "currency", currencyKey: "currency" },
  { key: "leads", label: "Prospectos (Meta)", kind: "metric", unit: "count" },
  { key: "cpl", label: "Costo/prospecto", kind: "metric", unit: "currency", currencyKey: "currency" },
  { key: "roas", label: "ROAS atribuido", kind: "metric", unit: "ratio" },
  { key: "status", label: "Estado", kind: "text" },
];

function campaignRows(report: Report): Row[] {
  return report.campaigns.map((c) => ({
    _key: c.key,
    name: c.name,
    account: c.accountName,
    currency: c.currency,
    spend: c.spend,
    impressions: c.impressions,
    linkClicks: c.linkClicks,
    ctr: c.ctr,
    cpc: c.cpc,
    leads: c.leads,
    cpl: c.cpl,
    roas: c.roas,
    status: c.status === "ACTIVE" ? "Activa" : c.status === "PAUSED" ? "Pausada" : (c.status ?? "—"),
  }));
}

const webColumns = (dimLabel: string): Column[] => [
  { key: "dimension", label: dimLabel, kind: "text" },
  { key: "property", label: "Propiedad", kind: "text" },
  { key: "sessions", label: "Sesiones", kind: "metric", unit: "count" },
  { key: "engaged", label: "Con interacción", kind: "metric", unit: "count" },
  { key: "rate", label: "Tasa de interacción", kind: "metric", unit: "percent" },
  { key: "keyEvents", label: "Eventos clave", kind: "metric", unit: "count" },
];
const webRows = (rows: WebDimensionRow[]): Row[] =>
  rows.map((r) => ({ _key: r.key, dimension: r.dimension, property: r.accountName, sessions: r.sessions, engaged: r.engagedSessions, rate: r.engagementRate, keyEvents: r.keyEvents }));

function accountTable(report: Report): { columns: Column[]; rows: Row[] } {
  return {
    columns: [
      { key: "name", label: "Cuenta / propiedad", kind: "text" },
      { key: "platform", label: "Plataforma", kind: "text" },
      { key: "currency", label: "Moneda", kind: "text" },
      { key: "spend", label: "Inversión", kind: "metric", unit: "currency", currencyKey: "currency" },
      { key: "linkClicks", label: "Clics en enlaces", kind: "metric", unit: "count" },
      { key: "sessions", label: "Sesiones", kind: "metric", unit: "count" },
      { key: "keyEvents", label: "Eventos clave", kind: "metric", unit: "count" },
      { key: "sync", label: "Última sincronización", kind: "text" },
    ],
    rows: report.accountRows.map((r) => ({
      _key: r.account.id,
      name: r.account.name,
      platform: PROVIDER_LABEL[r.account.provider],
      currency: r.account.currency,
      spend: r.metrics.spend ?? null,
      linkClicks: r.metrics.link_clicks ?? null,
      sessions: r.metrics.sessions ?? null,
      keyEvents: r.metrics.key_events ?? null,
      sync: r.account.lastSuccessfulSyncAt ? formatRelative(r.account.lastSuccessfulSyncAt) : "Pendiente",
    })),
  };
}

const ADS_SUMMARY: MetricKey[] = ["spend", "impressions", "link_clicks", "ctr", "cpc", "cpm", "meta_leads", "meta_cpl"];
const WEB_SUMMARY: MetricKey[] = ["sessions", "users", "engaged_sessions", "engagement_rate", "key_events", "ga4_leads"];

export function OverviewView(props: ReportViewProps & { allAccounts: Report["accounts"] }) {
  const { report, settings } = props;
  const hasAny = props.allAccounts.some((a) => a.isSelected || a.lastSuccessfulSyncAt);
  return (
    <ReportFrame props={props} allAccounts={props.allAccounts}>
      {!hasAny ? (
        <NoSources basePath={props.basePath} canManage={props.canManageIntegrations} what="fuentes" />
      ) : (
        <div className="space-y-6">
          <Alert tone="neutral">
            Cada fuente mide distinto: los resultados atribuidos por Meta y los eventos clave de GA4 se muestran por separado y no se suman en un total único.
          </Alert>
          {report.ads.length > 0 && (
            <Card title="Publicidad" description="Meta Ads, por moneda de la cuenta.">
              <div className="space-y-5">
                <CurrencyNotice report={report} />
                {report.ads.map((g) => (
                  <AdsGroup key={g.currency} g={g} settings={settings} keys={settings.metaPurchaseActionType ? [...ADS_SUMMARY, "meta_roas"] : ADS_SUMMARY} />
                ))}
              </div>
            </Card>
          )}
          {report.web && (
            <Card title="Sitio web y landings" description="Google Analytics 4.">
              <div className="space-y-3">
                <WebFlags report={report} />
                <CoverageNote {...report.web.coverage} />
                <KpiGrid>{WEB_SUMMARY.map((k) => <KpiCard key={k} k={k} cell={report.web!.metrics[k]} />)}</KpiGrid>
              </div>
            </Card>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {report.ads.map((g) => (
              <TrendChart key={g.currency} title={`Inversión y clics en enlaces · ${g.currency}`} data={report.adsDaily[g.currency] ?? []}
                series={[{ key: "spend", label: `Inversión (${g.currency})`, unit: "currency", currency: g.currency }, { key: "linkClicks", label: "Clics en enlaces", unit: "count", axis: "right" }]} />
            ))}
            {report.web && (
              <TrendChart title="Sesiones y eventos clave (GA4)" data={report.webDaily}
                series={[{ key: "sessions", label: "Sesiones", unit: "count" }, { key: "keyEvents", label: "Eventos clave", unit: "count", axis: "right" }]} />
            )}
          </div>
          <Card title="Desglose por plataforma y cuenta">
            {(() => { const t = accountTable(report); return <DataTable caption="Desglose por cuenta" columns={t.columns} rows={t.rows} pageSize={10} />; })()}
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            {report.ads.length > 0 && (
              <Card title="Campañas principales" description="Por inversión. Ver todas en Publicidad.">
                <DataTable caption="Campañas principales" columns={campaignColumns.filter((c) => ["name", "currency", "spend", "linkClicks", "cpc", "leads"].includes(c.key))}
                  rows={campaignRows(report).slice(0, 5)} pageSize={5} />
              </Card>
            )}
            {report.web && (
              <Card title="Landing pages principales" description="Por sesiones. Ver todas en Sitio web.">
                <DataTable caption="Landing pages principales" columns={webColumns("Landing page").filter((c) => c.key !== "property")}
                  rows={webRows(report.webTables.landing_page).slice(0, 5)} pageSize={5} />
              </Card>
            )}
          </div>
        </div>
      )}
    </ReportFrame>
  );
}

const ADS_FULL: MetricKey[] = ["spend", "impressions", "clicks", "link_clicks", "ctr", "cpc", "cpm", "reach", "meta_leads", "meta_cpl", "meta_purchase_value", "meta_roas"];

export function AdsView(props: ReportViewProps & { allAccounts: Report["accounts"] }) {
  const { report, settings } = props;
  const metaAccounts = props.allAccounts.filter((a) => a.provider === "meta_ads");
  return (
    <ReportFrame props={props} allAccounts={metaAccounts} showSource={false}>
      {metaAccounts.length === 0 ? (
        <NoSources basePath={props.basePath} canManage={props.canManageIntegrations} what="cuentas publicitarias" />
      ) : (
        <div className="space-y-6">
          <CurrencyNotice report={report} />
          {report.ads.map((g) => (
            <Card key={g.currency}>
              <AdsGroup g={g} keys={ADS_FULL} settings={settings} />
              <div className="mt-4">
                <TrendChart title={`Evolución diaria · ${g.currency}`} data={report.adsDaily[g.currency] ?? []}
                  series={[{ key: "spend", label: `Inversión (${g.currency})`, unit: "currency", currency: g.currency }, { key: "linkClicks", label: "Clics en enlaces", unit: "count", axis: "right" }]} />
              </div>
            </Card>
          ))}
          <Card title="Campañas" description="Totales del periodo por campaña. Ratios calculados a partir de sus componentes.">
            <DataTable caption="Campañas de Meta Ads" columns={campaignColumns} rows={campaignRows(report)} pageSize={15} initialSort={{ key: "spend", dir: "desc" }} />
          </Card>
          <Card title="Tipos de acción reportados por Meta" description="Úsalos para definir qué cuenta como prospecto o compra en Configuración. No se suman entre sí: algunos tipos se solapan.">
            <DataTable
              caption="Tipos de acción"
              columns={[{ key: "type", label: "Tipo de acción", kind: "text" }, { key: "value", label: "Cantidad", kind: "metric", unit: "count" }, { key: "used", label: "Uso", kind: "text" }]}
              rows={report.actionTypes.map((t) => ({
                _key: t.actionType,
                type: t.actionType,
                value: { state: "value", value: t.value },
                used: t.actionType === settings.metaLeadActionType ? "Prospecto" : t.actionType === settings.metaPurchaseActionType ? "Compra" : "",
              }))}
              pageSize={10}
            />
          </Card>
        </div>
      )}
    </ReportFrame>
  );
}

const WEB_FULL: MetricKey[] = ["sessions", "users", "engaged_sessions", "engagement_rate", "page_views", "key_events", "ga4_leads"];

export function WebView(props: ReportViewProps & { allAccounts: Report["accounts"] }) {
  const { report } = props;
  const gaAccounts = props.allAccounts.filter((a) => a.provider === "google_analytics");
  return (
    <ReportFrame props={props} allAccounts={gaAccounts} showSource={false}>
      {gaAccounts.length === 0 || !report.web ? (
        <NoSources basePath={props.basePath} canManage={props.canManageIntegrations} what="propiedades de GA4" />
      ) : (
        <div className="space-y-6">
          <WebFlags report={report} />
          <CoverageNote {...report.web.coverage} />
          <KpiGrid>{WEB_FULL.map((k) => <KpiCard key={k} k={k} cell={report.web!.metrics[k]} />)}</KpiGrid>
          <TrendChart title="Evolución diaria" data={report.webDaily}
            description={report.web.accounts.length === 1 ? "Usuarios por día (no se suman entre días)." : "Usuarios no se muestran con varias propiedades."}
            series={[
              { key: "sessions", label: "Sesiones", unit: "count" },
              { key: "engagedSessions", label: "Sesiones con interacción", unit: "count" },
              ...(report.web.accounts.length === 1 ? [{ key: "users", label: "Usuarios (del día)", unit: "count" as const }] : []),
              { key: "keyEvents", label: "Eventos clave", unit: "count", axis: "right" },
            ]} />
          <Card title="Landing pages"><DataTable caption="Landing pages" columns={webColumns("Landing page")} rows={webRows(report.webTables.landing_page)} pageSize={10} initialSort={{ key: "sessions", dir: "desc" }} /></Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Fuente / medio"><DataTable caption="Fuente y medio" columns={webColumns("Fuente / medio")} rows={webRows(report.webTables.source_medium)} pageSize={8} /></Card>
            <Card title="Campañas (UTM)"><DataTable caption="Campañas de GA4" columns={webColumns("Campaña")} rows={webRows(report.webTables.campaign)} pageSize={8} /></Card>
            <Card title="Dispositivos"><DataTable caption="Dispositivos" columns={webColumns("Dispositivo")} rows={webRows(report.webTables.device)} pageSize={8} /></Card>
            <Card title="Eventos clave por evento">
              <DataTable caption="Eventos clave por nombre"
                columns={[{ key: "event", label: "Evento", kind: "text" }, { key: "property", label: "Propiedad", kind: "text" }, { key: "value", label: "Eventos clave", kind: "metric", unit: "count" }]}
                rows={report.keyEventsByName.map((k) => ({ _key: k.key, event: k.eventName, property: k.accountName, value: k.value }))} pageSize={8} />
            </Card>
          </div>
        </div>
      )}
    </ReportFrame>
  );
}
