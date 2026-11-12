import type { MetricValue } from "@/lib/metrics/values";
import type { Report } from "./builder";

export const CSV_MAX_ROWS = 50_000;

/**
 * Celda CSV segura:
 *  - comillas escapadas,
 *  - neutraliza fórmulas (=, +, -, @, tab, CR) anteponiendo un apóstrofo para
 *    que Excel/Sheets no ejecuten contenido proveniente de fuentes externas.
 *    Los números generados por la app no pasan por esta neutralización.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  // BOM UTF-8: Excel muestra correctamente acentos y ñ.
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

const mv = (m: MetricValue): number | null => (m.state === "value" ? Math.round(m.value * 1e6) / 1e6 : null);
const st = (m: MetricValue): string => (m.state === "value" ? (m.partial ? "parcial" : "ok") : m.state === "missing" ? "sin_datos" : m.state === "pending" ? "pendiente" : m.state === "unsupported" ? "no_disponible" : "indefinido");

export type ExportKind = "campaigns" | "ads_daily" | "landing_pages" | "source_medium" | "web_daily";

export const EXPORT_LABELS: Record<ExportKind, string> = {
  campaigns: "Campañas (Meta Ads)",
  ads_daily: "Publicidad diaria por moneda (Meta Ads)",
  landing_pages: "Landing pages (GA4)",
  source_medium: "Fuente / medio (GA4)",
  web_daily: "Sitio web diario (GA4)",
};

export function buildExport(kind: ExportKind, report: Report): { headers: string[]; rows: Array<Array<string | number | null>> } {
  const p = [report.range.from, report.range.to] as const;
  switch (kind) {
    case "campaigns":
      return {
        headers: ["periodo_inicio", "periodo_fin", "fuente", "cuenta", "campaña", "id_campaña", "estado", "moneda", "inversion", "impresiones", "clics_todos", "clics_enlace", "ctr_enlace", "cpc_enlace", "prospectos_meta", "costo_por_prospecto", "valor_conversion_atribuido", "roas_atribuido", "atribucion", "estado_datos"],
        rows: report.campaigns.map((c) => [p[0], p[1], "Meta Ads", c.accountName, c.name, c.campaignId, c.status, c.currency, mv(c.spend), mv(c.impressions), mv(c.clicks), mv(c.linkClicks), mv(c.ctr), mv(c.cpc), mv(c.leads), mv(c.cpl), mv(c.purchaseValue), mv(c.roas), c.attributionSetting, st(c.spend)]),
      };
    case "ads_daily":
      return {
        headers: ["fecha", "fuente", "moneda", "inversion", "impresiones", "clics_enlace", "estado_datos"],
        rows: Object.entries(report.adsDaily).flatMap(([cur, pts]) =>
          pts.map((pt) => [pt.date, "Meta Ads", cur, pt.spend as number | null, pt.impressions as number | null, pt.linkClicks as number | null, pt.spend === null ? "sin_datos" : "ok"]),
        ),
      };
    case "landing_pages":
    case "source_medium": {
      const table = kind === "landing_pages" ? report.webTables.landing_page : report.webTables.source_medium;
      return {
        headers: ["periodo_inicio", "periodo_fin", "fuente", "propiedad", kind === "landing_pages" ? "landing_page" : "fuente_medio", "sesiones", "sesiones_con_interaccion", "tasa_interaccion", "eventos_clave"],
        rows: table.map((r) => [p[0], p[1], "Google Analytics 4", r.accountName, r.dimension, mv(r.sessions), mv(r.engagedSessions), mv(r.engagementRate), mv(r.keyEvents)]),
      };
    }
    case "web_daily":
      return {
        headers: ["fecha", "fuente", "sesiones", "sesiones_con_interaccion", "eventos_clave", "usuarios_dia", "estado_datos"],
        rows: report.webDaily.map((pt) => [pt.date, "Google Analytics 4", pt.sessions as number | null, pt.engagedSessions as number | null, pt.keyEvents as number | null, pt.users as number | null, pt.sessions === null ? "sin_datos" : "ok"]),
      };
  }
}
