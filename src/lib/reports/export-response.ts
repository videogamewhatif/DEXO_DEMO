import { NextResponse } from "next/server";
import { todayInTimeZone } from "@/lib/metrics/periods";
import { CSV_MAX_ROWS, EXPORT_LABELS, buildExport, toCsv, type ExportKind } from "./csv";
import { parseFilters } from "./filters";
import { loadReport } from "./load";
import type { ReportRepository } from "./types";

export function parseExportKind(v: string | null): ExportKind | null {
  return v && v in EXPORT_LABELS ? (v as ExportKind) : null;
}

/** Genera el CSV con los mismos filtros y el mismo repositorio (autorizado) que la pantalla. */
export async function csvResponse(repo: ReportRepository, timezone: string, url: URL, filePrefix: string) {
  const kind = parseExportKind(url.searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "Tipo de exportación inválido" }, { status: 400 });
  const sp: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    sp[key] = all.length > 1 ? all : all[0]!;
  }
  const filters = parseFilters(sp, todayInTimeZone(timezone));
  const { report } = await loadReport(repo, { ...filters, compare: false });
  const { headers, rows } = buildExport(kind, report);
  if (rows.length > CSV_MAX_ROWS) {
    return NextResponse.json({ error: `La exportación supera ${CSV_MAX_ROWS} filas. Reduce el periodo o filtra cuentas.` }, { status: 413 });
  }
  const filename = `${filePrefix}-${kind}-${filters.range.from}_${filters.range.to}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    kind,
    rows: rows.length,
    range: filters.range,
    response: new NextResponse(toCsv(headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  };
}
