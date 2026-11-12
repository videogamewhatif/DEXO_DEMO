"use client";
import { useMemo, useState } from "react";
import type { MetricUnit } from "@/lib/metrics/definitions";
import type { MetricValue } from "@/lib/metrics/values";
import { formatMetric } from "@/lib/format";

export type Cell = string | number | null | MetricValue;

export interface Column {
  key: string;
  label: string;
  kind: "text" | "metric";
  unit?: MetricUnit;
  /** Clave de la fila que contiene la moneda (para unidades monetarias). */
  currencyKey?: string;
}

export type Row = Record<string, Cell> & { _key: string };

function sortValue(c: Cell): number | string {
  if (c === null || c === undefined) return -Infinity;
  if (typeof c === "string" || typeof c === "number") return c;
  return c.state === "value" ? c.value : -Infinity;
}

export function DataTable({ caption, columns, rows, pageSize = 10, initialSort, emptyText = "Sin filas para este periodo." }: {
  caption: string;
  columns: Column[];
  rows: Row[];
  pageSize?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyText?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const out = [...rows].sort((a, b) => {
      const av = sortValue(a[sort.key] ?? null);
      const bv = sortValue(b[sort.key] ?? null);
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "es") : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  function toggle(key: string) {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${c.kind === "metric" ? "text-right" : "text-left"} ${i === 0 ? "sticky left-0 bg-surface-2" : ""}`}>
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-fg">
                    {c.label}
                    <span aria-hidden>{sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted">{emptyText}</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r._key} className="border-t border-line">
                {columns.map((c, i) => {
                  const v = r[c.key] ?? null;
                  let text: string;
                  let note: string | null = null;
                  if (c.kind === "metric" && v !== null && typeof v === "object") {
                    const cur = c.currencyKey ? (r[c.currencyKey] as string | null) : null;
                    const f = formatMetric(v, c.unit ?? "count", cur);
                    text = f.text;
                    note = f.note;
                  } else text = v === null ? "—" : String(v);
                  return (
                    <td key={c.key} title={note ?? undefined}
                      className={`px-3 py-2 ${c.kind === "metric" ? "tabular text-right" : "max-w-[22rem] truncate"} ${i === 0 ? "sticky left-0 bg-surface font-medium" : ""}`}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="mt-2 flex items-center justify-end gap-2 text-sm" aria-label={`Paginación: ${caption}`}>
          <button type="button" className="min-h-9 rounded border border-line px-3 disabled:opacity-40" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</button>
          <span className="text-muted" aria-live="polite">Página {current + 1} de {pages} · {sorted.length} filas</span>
          <button type="button" className="min-h-9 rounded border border-line px-3 disabled:opacity-40" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Siguiente</button>
        </nav>
      )}
    </div>
  );
}
