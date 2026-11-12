/**
 * Definición, fuente, fórmula, unidad y límites de interpretación de cada indicador.
 * Se muestran como ayuda en la interfaz y se documentan en docs/metricas.md.
 */
export type MetricKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "link_clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "meta_leads"
  | "meta_cpl"
  | "meta_purchase_value"
  | "meta_roas"
  | "reach"
  | "sessions"
  | "engaged_sessions"
  | "engagement_rate"
  | "users"
  | "page_views"
  | "key_events"
  | "ga4_leads";

export type MetricUnit = "currency" | "count" | "percent" | "ratio";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  unit: MetricUnit;
  source: string;
  definition: string;
  formula?: string;
  limits: string;
  /** Si es aditiva entre días y cuentas. */
  additive: boolean;
}

export const METRICS: Record<MetricKey, MetricDefinition> = {
  spend: {
    key: "spend",
    label: "Inversión",
    unit: "currency",
    source: "Meta Ads (campo spend)",
    definition: "Monto gastado según Meta, en la moneda de la cuenta publicitaria.",
    limits: "Meta lo reporta como estimado. Monedas distintas se muestran por separado: no se convierten ni se suman.",
    additive: true,
  },
  impressions: {
    key: "impressions",
    label: "Impresiones",
    unit: "count",
    source: "Meta Ads (impressions)",
    definition: "Veces que se mostraron los anuncios.",
    limits: "No equivale a personas alcanzadas.",
    additive: true,
  },
  clicks: {
    key: "clicks",
    label: "Clics (todos)",
    unit: "count",
    source: "Meta Ads (clicks)",
    definition: "Todos los clics en el anuncio, incluidos los que no llevan a un destino (p. ej. 'ver más', perfil).",
    limits: "No usar para CPC o CTR de tráfico: para eso se usan los clics en enlaces.",
    additive: true,
  },
  link_clicks: {
    key: "link_clicks",
    label: "Clics en enlaces",
    unit: "count",
    source: "Meta Ads (inline_link_clicks)",
    definition: "Clics en enlaces del anuncio que llevan a destinos dentro o fuera de Meta.",
    limits: "No equivale a sesiones en el sitio: GA4 puede registrar menos visitas por bloqueos, rebotes previos a la carga o consentimiento.",
    additive: true,
  },
  ctr: {
    key: "ctr",
    label: "CTR (enlaces)",
    unit: "percent",
    source: "Calculado con datos de Meta Ads",
    definition: "Proporción de impresiones que generaron un clic en enlace.",
    formula: "Clics en enlaces ÷ Impresiones",
    limits: "Se calcula a partir de los totales del periodo, no promediando CTR diarios.",
    additive: false,
  },
  cpc: {
    key: "cpc",
    label: "CPC (enlaces)",
    unit: "currency",
    source: "Calculado con datos de Meta Ads",
    definition: "Costo promedio por clic en enlace.",
    formula: "Inversión ÷ Clics en enlaces",
    limits: "Ponderado por volumen (totales del periodo). Sin clics, el CPC no está definido.",
    additive: false,
  },
  cpm: {
    key: "cpm",
    label: "CPM",
    unit: "currency",
    source: "Calculado con datos de Meta Ads",
    definition: "Costo por cada mil impresiones.",
    formula: "Inversión ÷ Impresiones × 1 000",
    limits: "Ponderado por volumen.",
    additive: false,
  },
  meta_leads: {
    key: "meta_leads",
    label: "Prospectos (Meta)",
    unit: "count",
    source: "Meta Ads (actions del tipo configurado)",
    definition: "Acciones del tipo definido como prospecto en Configuración, atribuidas por Meta.",
    limits:
      "Usa la configuración de atribución de Meta (se conserva por fila). No se suma con los eventos clave de GA4: son mediciones distintas del mismo embudo.",
    additive: true,
  },
  meta_cpl: {
    key: "meta_cpl",
    label: "Costo por prospecto (Meta)",
    unit: "currency",
    source: "Calculado con datos de Meta Ads",
    definition: "Inversión dividida entre prospectos atribuidos por Meta.",
    formula: "Inversión ÷ Prospectos (Meta)",
    limits: "Solo con prospectos de la misma fuente y moneda. No indica ventas.",
    additive: false,
  },
  meta_purchase_value: {
    key: "meta_purchase_value",
    label: "Valor de conversión atribuido (Meta)",
    unit: "currency",
    source: "Meta Ads (action_values del tipo de compra configurado)",
    definition: "Valor de las compras que Meta atribuye a los anuncios.",
    limits: "Son ingresos atribuidos según el modelo de Meta, no ingresos confirmados ni utilidad.",
    additive: true,
  },
  meta_roas: {
    key: "meta_roas",
    label: "ROAS atribuido (Meta)",
    unit: "ratio",
    source: "Calculado con datos de Meta Ads",
    definition: "Valor de conversión atribuido por cada unidad de inversión.",
    formula: "Valor de conversión atribuido ÷ Inversión",
    limits: "No es ROI: no descuenta costos, devoluciones ni márgenes. Depende de la atribución de Meta.",
    additive: false,
  },
  reach: {
    key: "reach",
    label: "Alcance",
    unit: "count",
    source: "Meta Ads (reach, consultado por periodo exacto)",
    definition: "Personas únicas estimadas que vieron los anuncios en el periodo.",
    limits: "No aditivo: no se suma entre días ni cuentas. Solo se muestra para periodos precalculados y una cuenta.",
    additive: false,
  },
  sessions: {
    key: "sessions",
    label: "Sesiones",
    unit: "count",
    source: "Google Analytics 4 (sessions)",
    definition: "Visitas iniciadas en el sitio.",
    limits: "Una persona puede tener varias sesiones. Depende del consentimiento y bloqueadores.",
    additive: true,
  },
  engaged_sessions: {
    key: "engaged_sessions",
    label: "Sesiones con interacción",
    unit: "count",
    source: "Google Analytics 4 (engagedSessions)",
    definition: "Sesiones de más de 10 segundos, con un evento clave o con 2+ vistas (definición de GA4).",
    limits: "Criterio definido por Google y configurable en la propiedad.",
    additive: true,
  },
  engagement_rate: {
    key: "engagement_rate",
    label: "Tasa de interacción",
    unit: "percent",
    source: "Calculado con datos de GA4",
    definition: "Proporción de sesiones con interacción.",
    formula: "Sesiones con interacción ÷ Sesiones",
    limits: "Ponderada por sesiones.",
    additive: false,
  },
  users: {
    key: "users",
    label: "Usuarios",
    unit: "count",
    source: "Google Analytics 4 (totalUsers, consultado por periodo exacto)",
    definition: "Usuarios únicos que registraron al menos un evento.",
    limits:
      "No aditivo: la suma de usuarios diarios contaría varias veces a la misma persona. Se muestra solo para una propiedad y periodos precalculados (presets) o un solo día.",
    additive: false,
  },
  page_views: {
    key: "page_views",
    label: "Vistas de página",
    unit: "count",
    source: "Google Analytics 4 (screenPageViews)",
    definition: "Vistas de páginas y pantallas.",
    limits: "Incluye vistas repetidas.",
    additive: true,
  },
  key_events: {
    key: "key_events",
    label: "Eventos clave",
    unit: "count",
    source: "Google Analytics 4 (keyEvents)",
    definition: "Eventos marcados como clave en la propiedad de GA4 (antes 'conversiones').",
    limits: "Mezcla todos los eventos clave configurados. No se suma con resultados de Meta.",
    additive: true,
  },
  ga4_leads: {
    key: "ga4_leads",
    label: "Prospectos (GA4)",
    unit: "count",
    source: "Google Analytics 4 (keyEvents del evento configurado)",
    definition: "Eventos clave del evento definido como prospecto en Configuración.",
    limits: "Requiere que el evento esté marcado como clave en GA4. No equivale a ventas.",
    additive: true,
  },
};
