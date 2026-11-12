import { redactSecrets } from "@/lib/security/redact";

/** Clasificación de errores de proveedor: decide reintento, espera o reconexión. */
export type ProviderErrorKind =
  | "rate_limited" // cuota o límite: esperar retryAfterMs
  | "auth" // token caducado/revocado: requiere reconexión
  | "permission" // sin permiso sobre el recurso
  | "transient" // red/5xx: reintentar con backoff
  | "too_much_data" // reducir ventana o usar reporte asíncrono
  | "invalid_request" // error permanente de la petición
  | "not_configured"; // faltan credenciales de la aplicación

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly provider: string,
    message: string,
    public readonly details: {
      status?: number;
      providerCode?: string | number;
      providerSubcode?: string | number;
      retryAfterMs?: number;
      traceId?: string;
    } = {},
  ) {
    super(redactSecrets(message).slice(0, 500));
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "transient";
  }

  /** Código estable para persistir (sin secretos). */
  get code(): string {
    const pc = this.details.providerCode !== undefined ? `:${this.details.providerCode}` : "";
    const ps = this.details.providerSubcode !== undefined ? `/${this.details.providerSubcode}` : "";
    return `${this.provider}:${this.kind}${pc}${ps}`;
  }
}

/** Interpreta Retry-After (segundos o fecha HTTP). */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}
