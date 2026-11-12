"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { brand } from "@/config/brand";
import type { MetricUnit } from "@/lib/metrics/definitions";
import { formatShortDate, formatValue, formatDate } from "@/lib/format";
import type { DailyPoint } from "@/lib/reports/builder";

export interface SeriesDef {
  key: string;
  label: string;
  unit: MetricUnit;
  currency?: string | null;
  axis?: "left" | "right";
}

export function TrendChart({ title, data, series, description }: { title: string; data: DailyPoint[]; series: SeriesDef[]; description?: string }) {
  const hasRight = series.some((s) => s.axis === "right");
  const gaps = data.filter((d) => series.every((s) => d[s.key] === null)).length;
  const summary = `${title}. ${data.length} días. ${gaps > 0 ? `${gaps} días sin datos sincronizados se muestran como huecos.` : ""}`;
  return (
    <figure className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <figcaption className="mb-2">
        <span className="font-semibold">{title}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
        {gaps > 0 && <span className="block text-xs text-warn">Los huecos indican días sin datos sincronizados (no son ceros).</span>}
      </figcaption>
      <div role="img" aria-label={summary} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: hasRight ? 10 : 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatShortDate(d)} tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted)" }} width={70}
              tickFormatter={(v: number) => formatValue(v, "count")} />
            {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} width={60} tickFormatter={(v: number) => formatValue(v, "count")} />}
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--text)" }}
              labelFormatter={(d) => formatDate(String(d))}
              formatter={(value, name) => {
                const s = series.find((x) => x.label === name);
                if (value === null || value === undefined) return ["Sin datos", name];
                return [s ? formatValue(Number(value), s.unit, s.currency) : String(value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s, i) => (
              <Line key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.label}
                stroke={brand.chartColors[i % brand.chartColors.length]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="text-xs text-brand underline">Ver datos en tabla</summary>
        <div className="mt-2 max-h-64 overflow-auto" tabIndex={0} role="region" aria-label={`Datos: ${title}`}>
          <table className="w-full text-xs">
            <thead><tr><th className="p-1 text-left">Fecha</th>{series.map((s) => <th key={s.key} className="p-1 text-right">{s.label}</th>)}</tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date as string} className="border-t border-line">
                  <td className="p-1">{formatDate(d.date as string)}</td>
                  {series.map((s) => <td key={s.key} className="tabular p-1 text-right">{d[s.key] === null ? "Sin datos" : formatValue(Number(d[s.key]), s.unit, s.currency)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
