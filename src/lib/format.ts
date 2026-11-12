import { brand } from "@/config/brand";
import type { MetricUnit } from "@/lib/metrics/definitions";
import type { DeltaValue, MetricValue } from "@/lib/metrics/values";

const LOCALE = brand.locale;

export function formatNumber(n: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFractionDigits }).format(n);
}

export function formatCurrency(n: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return formatNumber(n, 2);
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${formatNumber(n, 2)} ${currency}`;
  }
}

export function formatPercent(ratio: number, digits = 2): string {
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(ratio);
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", timeZone: "UTC" }).format(d);
}

export function formatDateTime(isoTimestamp: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(isoTimestamp));
  } catch {
    return new Date(isoTimestamp).toISOString();
  }
}

export function formatRelative(isoTimestamp: string, now = Date.now()): string {
  const diff = Math.round((now - Date.parse(isoTimestamp)) / 60000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  if (Math.abs(diff) < 60) return rtf.format(-diff, "minute");
  if (Math.abs(diff) < 60 * 48) return rtf.format(-Math.round(diff / 60), "hour");
  return rtf.format(-Math.round(diff / 1440), "day");
}

export function formatValue(n: number, unit: MetricUnit, currency?: string | null): string {
  switch (unit) {
    case "currency":
      return currency ? formatCurrency(n, currency) : formatNumber(n, 2);
    case "percent":
      return formatPercent(n);
    case "ratio":
      return `${formatNumber(n, 2)}×`;
    default:
      return formatNumber(n, Number.isInteger(n) ? 0 : 1);
  }
}

/** Texto visible + explicación accesible para cualquier estado de métrica. */
export function formatMetric(m: MetricValue, unit: MetricUnit, currency?: string | null): { text: string; note: string | null } {
  switch (m.state) {
    case "value":
      return {
        text: formatValue(m.value, unit, currency),
        note: m.partial ? `Datos incompletos: ${m.partial.coveredDays} de ${m.partial.expectedDays} días-cuenta sincronizados` : null,
      };
    case "missing":
      return { text: "Sin datos", note: "No hay datos sincronizados para este periodo." };
    case "pending":
      return { text: "Pendiente", note: "La primera sincronización aún no termina." };
    case "unsupported":
      return { text: "No disponible", note: m.reason };
    case "undefined":
      return { text: "—", note: "No se puede calcular: el denominador es cero." };
  }
}

export function formatDelta(d: DeltaValue | null): { text: string; note: string | null; trend: "up" | "down" | "flat" | "none" } {
  if (!d) return { text: "", note: null, trend: "none" };
  switch (d.state) {
    case "pct":
      if (Math.abs(d.pct) < 0.0005) return { text: "Sin cambio (±0.1 %)", note: null, trend: "flat" };
      return {
        text: `${d.pct > 0 ? "+" : ""}${formatPercent(d.pct, 1)}`,
        note: null,
        trend: Math.abs(d.pct) < 0.0005 ? "flat" : d.pct > 0 ? "up" : "down",
      };
    case "both_zero":
      return { text: "Sin cambio", note: "Ambos periodos en cero.", trend: "flat" };
    case "from_zero":
      return { text: "Nuevo", note: "El periodo anterior fue cero: la variación porcentual no está definida.", trend: "up" };
    case "unavailable":
      return { text: "Sin comparación", note: "No hay datos comparables en el periodo anterior.", trend: "none" };
  }
}
