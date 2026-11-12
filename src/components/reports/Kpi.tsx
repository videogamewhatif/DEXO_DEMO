import { METRICS, type MetricKey } from "@/lib/metrics/definitions";
import type { MetricCell } from "@/lib/reports/builder";
import { formatDelta, formatMetric } from "@/lib/format";
import { HelpTip, cx } from "@/components/ui/primitives";

/** Métricas de costo: una baja es favorable. */
const LOWER_IS_BETTER: MetricKey[] = ["cpc", "cpm", "meta_cpl"];

export function MetricHelpContent({ k }: { k: MetricKey }) {
  const d = METRICS[k];
  return (
    <dl className="space-y-1.5">
      <div><dt className="font-semibold">Qué es</dt><dd>{d.definition}</dd></div>
      {d.formula && <div><dt className="font-semibold">Fórmula</dt><dd>{d.formula}</dd></div>}
      <div><dt className="font-semibold">Fuente</dt><dd>{d.source}</dd></div>
      <div><dt className="font-semibold">Límites</dt><dd>{d.limits}</dd></div>
    </dl>
  );
}

export function KpiCard({ k, cell, currency, hidePartialNote = true }: { k: MetricKey; cell: MetricCell | undefined; currency?: string | null; hidePartialNote?: boolean }) {
  const def = METRICS[k];
  if (!cell) return null;
  const main = formatMetric(cell.current, def.unit, currency);
  const d = formatDelta(cell.delta);
  const good = d.trend === "flat" || d.trend === "none" ? null : LOWER_IS_BETTER.includes(k) ? d.trend === "down" : d.trend === "up";
  return (
    <div className="rounded-lg border border-line bg-surface p-3.5" data-metric={k}>
      <div className="flex items-center text-xs font-medium text-muted">
        <span>{def.label}</span>
        <HelpTip label={def.label}><MetricHelpContent k={k} /></HelpTip>
      </div>
      <p className={cx("tabular mt-1 text-xl font-semibold", cell.current.state !== "value" && "text-base text-muted")} title={main.note ?? undefined}>
        {main.text}
      </p>
      {main.note && !(hidePartialNote && cell.current.state === "value") && <p className="mt-0.5 text-xs text-muted">{main.note}</p>}
      {cell.delta && cell.current.state !== "unsupported" && (
        <p className="mt-1 text-xs">
          <span className={cx("font-medium", good === true && "text-ok", good === false && "text-danger", good === null && "text-muted")}>
            {d.trend === "up" ? "▲ " : d.trend === "down" ? "▼ " : ""}
            {d.text}
          </span>
          <span className="text-muted"> vs. periodo anterior</span>
          {d.note && <span className="block text-muted">{d.note}</span>}
        </p>
      )}
    </div>
  );
}

export function CoverageNote({ coveredDays, expectedDays, pending }: { coveredDays: number; expectedDays: number; pending: boolean }) {
  if (expectedDays === 0) return null;
  if (coveredDays === 0) return <p className="text-xs text-warn">{pending ? "Primera sincronización pendiente." : "Sin días sincronizados en este periodo."}</p>;
  if (coveredDays >= expectedDays) return <p className="text-xs text-muted">Cobertura completa del periodo.</p>;
  return (
    <p className="text-xs text-warn">
      Datos incompletos: {coveredDays} de {expectedDays} días-cuenta sincronizados. Los totales solo incluyen los días disponibles.
    </p>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}
