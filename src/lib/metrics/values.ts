/**
 * Representación explícita de valores de métricas. Nunca se convierte un dato
 * ausente o un error en cero.
 *
 *  value       → número calculado (puede ser un cero real).
 *  missing     → no hay datos sincronizados para el periodo.
 *  pending     → la cuenta está seleccionada pero su primera sincronización no terminó.
 *  unsupported → la fuente no ofrece esta métrica o no puede agregarse correctamente.
 *  undefined   → ratio con denominador cero (p. ej. CPC sin clics).
 */
export type MetricValue =
  | { state: "value"; value: number; partial?: { coveredDays: number; expectedDays: number } }
  | { state: "missing" }
  | { state: "pending" }
  | { state: "unsupported"; reason: string }
  | { state: "undefined"; reason: "zero_denominator" };

export type DeltaValue =
  | { state: "pct"; pct: number }
  | { state: "both_zero" }
  | { state: "from_zero" }
  | { state: "unavailable" };

export const v = (value: number, partial?: { coveredDays: number; expectedDays: number }): MetricValue =>
  partial && partial.coveredDays < partial.expectedDays ? { state: "value", value, partial } : { state: "value", value };
export const MISSING: MetricValue = { state: "missing" };
export const PENDING: MetricValue = { state: "pending" };
export const unsupported = (reason: string): MetricValue => ({ state: "unsupported", reason });

export function isValue(m: MetricValue): m is Extract<MetricValue, { state: "value" }> {
  return m.state === "value";
}

/** División segura: denominador cero → indefinido; operandos no disponibles → se propaga el estado. */
export function safeDivide(n: MetricValue, d: MetricValue, multiplier = 1): MetricValue {
  if (!isValue(n)) return n;
  if (!isValue(d)) return d;
  if (d.value === 0) return { state: "undefined", reason: "zero_denominator" };
  const partial = n.partial ?? d.partial;
  return v((n.value / d.value) * multiplier, partial);
}

/** Variación porcentual. Base cero → sin porcentaje infinito. */
export function delta(current: MetricValue, previous: MetricValue): DeltaValue {
  if (!isValue(current) || !isValue(previous)) return { state: "unavailable" };
  if (previous.value === 0) return current.value === 0 ? { state: "both_zero" } : { state: "from_zero" };
  return { state: "pct", pct: (current.value - previous.value) / Math.abs(previous.value) };
}

/** Suma de valores con conocimiento de cobertura. */
export function sumWithCoverage(values: Array<number | null>, coveredDays: number, expectedDays: number, pending: boolean): MetricValue {
  if (coveredDays === 0) return pending ? PENDING : MISSING;
  const present = values.filter((x): x is number => x !== null && Number.isFinite(x));
  // Días cubiertos sin filas = cero real (el proveedor omite filas en cero).
  // Si hay filas pero el campo vino nulo en todas, el proveedor no entregó el dato.
  if (values.length > 0 && present.length === 0) return MISSING;
  const total = present.reduce((a, b) => a + b, 0);
  return v(total, { coveredDays, expectedDays });
}
