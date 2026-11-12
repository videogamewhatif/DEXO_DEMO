import { z } from "zod";
import { addDays, daysInRange, isIsoDate, presetRange, PRESET_LABELS, type DateRange, type PresetId } from "@/lib/metrics/periods";
import type { ReportFilters } from "./types";

export const MAX_RANGE_DAYS = 400;

export interface ParsedFilters extends ReportFilters {
  preset: PresetId | "custom";
  today: string;
  error: string | null;
}

const presetSchema = z.enum(Object.keys(PRESET_LABELS) as [PresetId, ...PresetId[]]);

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

/** Los filtros solo seleccionan dentro de lo autorizado: nunca otorgan acceso. */
export function parseFilters(sp: SP, today: string): ParsedFilters {
  let error: string | null = null;
  const presetParam = first(sp.preset);
  const preset = presetSchema.safeParse(presetParam);
  let range: DateRange;
  let presetId: ParsedFilters["preset"] = "last_28";
  const from = first(sp.from);
  const to = first(sp.to);
  if (presetParam === "custom" && isIsoDate(from) && isIsoDate(to)) {
    range = { from, to };
    presetId = "custom";
    if (from > to) {
      error = "La fecha inicial es posterior a la final; se usaron los últimos 28 días.";
      range = presetRange("last_28", today);
      presetId = "last_28";
    } else if (to > today) {
      range = { from, to: today };
    }
    if (daysInRange(range) > MAX_RANGE_DAYS) {
      error = `El periodo máximo es de ${MAX_RANGE_DAYS} días; se ajustó la fecha inicial.`;
      range = { from: addDays(range.to, -(MAX_RANGE_DAYS - 1)), to: range.to };
    }
  } else {
    if (presetParam === "custom") error = "Fechas personalizadas inválidas; se usaron los últimos 28 días.";
    presetId = preset.success ? preset.data : "last_28";
    range = presetRange(presetId, today);
  }
  const sourceParam = first(sp.source);
  const source = sourceParam === "meta_ads" || sourceParam === "google_analytics" ? sourceParam : "all";
  const compare = first(sp.compare) !== "0";
  const accountIds = all(sp.account).filter((x) => UUIDISH.test(x)).slice(0, 50);
  return { range, preset: presetId, compare, source, accountIds, today, error };
}

export function filtersToQuery(f: Pick<ParsedFilters, "preset" | "range" | "compare" | "source" | "accountIds">): string {
  const q = new URLSearchParams();
  q.set("preset", f.preset);
  if (f.preset === "custom") {
    q.set("from", f.range.from);
    q.set("to", f.range.to);
  }
  if (!f.compare) q.set("compare", "0");
  if (f.source !== "all") q.set("source", f.source);
  for (const a of f.accountIds) q.append("account", a);
  return q.toString();
}
