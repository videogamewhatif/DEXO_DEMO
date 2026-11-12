/** Utilidades de fechas de calendario (YYYY-MM-DD) independientes de la zona del servidor. */
export interface DateRange {
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInRange(r: DateRange): number {
  return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function eachDay(r: DateRange): string[] {
  const out: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Periodo inmediatamente anterior de igual duración. */
export function previousPeriod(r: DateRange): DateRange {
  const n = daysInRange(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

export type PresetId = "last_7" | "last_28" | "last_90" | "this_month" | "last_month";

export const PRESET_LABELS: Record<PresetId, string> = {
  last_7: "Últimos 7 días",
  last_28: "Últimos 28 días",
  last_90: "Últimos 90 días",
  this_month: "Mes en curso",
  last_month: "Mes anterior",
};

/** Los presets "últimos N días" terminan ayer: solo días completos. */
export function presetRange(id: PresetId, today: string): DateRange {
  const yesterday = addDays(today, -1);
  switch (id) {
    case "last_7":
      return { from: addDays(today, -7), to: yesterday };
    case "last_28":
      return { from: addDays(today, -28), to: yesterday };
    case "last_90":
      return { from: addDays(today, -90), to: yesterday };
    case "this_month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
  }
}

/**
 * Periodos para los que el trabajador precalcula agregados no aditivos
 * (usuarios, alcance): presets "últimos N" y su periodo anterior.
 */
export function snapshotRanges(today: string): DateRange[] {
  const out: DateRange[] = [];
  for (const id of ["last_7", "last_28", "last_90"] as PresetId[]) {
    const r = presetRange(id, today);
    out.push(r, previousPeriod(r));
  }
  return out;
}

export function rangeEquals(a: DateRange, b: DateRange) {
  return a.from === b.from && a.to === b.to;
}
