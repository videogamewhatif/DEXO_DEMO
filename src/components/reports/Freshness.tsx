import type { Report } from "@/lib/reports/builder";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Alert } from "@/components/ui/primitives";

export function FreshnessBar({ report, timezone, demo }: { report: Report; timezone: string; demo?: boolean }) {
  const f = report.freshness;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Frescura de los datos">
      {f.newestSync ? (
        <span>
          Última sincronización: <strong className="text-fg">{formatRelative(f.newestSync)}</strong> ({formatDateTime(f.newestSync, timezone)})
          {f.oldestSync && f.oldestSync !== f.newestSync && <> · cuenta más desactualizada: {formatRelative(f.oldestSync)}</>}
        </span>
      ) : (
        <span>Aún no hay sincronizaciones completadas.</span>
      )}
      {f.anyActiveJob && <span className="text-info">Hay una sincronización en curso.</span>}
      <span>Fechas según la zona horaria de cada cuenta de origen. El día de hoy puede estar incompleto.</span>
      {demo && <span className="font-semibold text-warn">Datos de demostración</span>}
    </div>
  );
}

export function StaleWarnings({ report }: { report: Report }) {
  const reauth = report.accounts.filter((a) => a.integrationStatus === "needs_reauth");
  const pending = report.accounts.filter((a) => a.isSelected && !a.lastSuccessfulSyncAt);
  return (
    <div className="mb-4 space-y-2">
      {reauth.length > 0 && (
        <Alert tone="warn" title="Conexión caducada">
          {reauth.map((a) => a.name).join(", ")}: la autorización del proveedor caducó. Los datos mostrados llegan hasta la última sincronización exitosa; un administrador debe reconectar en Integraciones.
        </Alert>
      )}
      {pending.length > 0 && (
        <Alert tone="info" title="Sincronización inicial pendiente">
          {pending.map((a) => a.name).join(", ")}: los datos aparecerán al terminar la primera importación.
        </Alert>
      )}
    </div>
  );
}
