/** Errores de dominio con mensajes en español, seguros para mostrar al usuario. */
export const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Tu sesión no es válida o expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permisos para realizar esta acción.",
  organization_not_active: "La empresa está suspendida o no existe.",
  organization_not_found: "La empresa no existe.",
  already_member: "Esa persona ya es miembro de la empresa.",
  invalid_ttl: "La vigencia de la invitación no es válida.",
  invitation_invalid: "El enlace de invitación no es válido.",
  invitation_revoked: "Esta invitación fue revocada. Pide una nueva a tu administrador.",
  invitation_used: "Esta invitación ya fue utilizada.",
  invitation_expired: "Esta invitación venció. Pide una nueva a tu administrador.",
  invitation_email_mismatch:
    "Esta invitación pertenece a otro correo. Inicia sesión con el correo invitado.",
  invitation_not_pending: "La invitación ya no está pendiente.",
  member_not_found: "La persona no es miembro de la empresa.",
  last_org_admin: "No puedes eliminar ni degradar al último administrador de la empresa.",
  integration_not_connected: "La integración no está conectada.",
  account_not_selected: "La cuenta no está seleccionada para sincronizar.",
  sync_already_active: "Ya hay una sincronización pendiente o en curso para esta cuenta.",
  sync_rate_limited: "Ya se solicitó una actualización manual hace menos de 15 minutos.",
  job_not_pending: "El trabajo ya no está pendiente.",
  job_not_retryable: "Este trabajo no se puede reintentar.",
  reason_required: "Indica un motivo (mínimo 5 caracteres).",
  invalid_duration: "Duración no válida.",
  invalid_status: "Estado no válido.",
  validation: "Revisa los datos del formulario.",
  slug_taken: "Ese identificador ya está en uso.",
  invalid_timezone: "Zona horaria no válida.",
  integration_not_configured: "La integración no está configurada en el servidor.",
  oauth_state_invalid: "La autorización no es válida. Inicia la conexión de nuevo.",
  oauth_state_expired: "La autorización tardó demasiado. Inicia la conexión de nuevo.",
  oauth_state_user_mismatch: "La autorización se inició con otra sesión.",
  oauth_denied: "La autorización fue cancelada o rechazada en el proveedor.",
  oauth_exchange_failed: "No se pudo completar la conexión con el proveedor.",
  auth_not_configured: "La autenticación no está configurada en este entorno.",
  account_exists: "Ya existe una cuenta con este correo. Inicia sesión para aceptar.",
  account_create_failed: "No se pudo crear la cuenta.",
  unknown: "Ocurrió un error inesperado. Inténtalo de nuevo.",
};

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown);
    this.name = "AppError";
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
  hint?: string;
  constraint?: string;
}

/** Traduce errores de PostgreSQL a AppError sin filtrar detalles internos. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (err ?? {}) as PgLikeError;
  if (e.hint === "last_org_admin") return new AppError("last_org_admin");
  if (e.code === "42501") return new AppError("forbidden");
  if (e.code === "28000") return new AppError("not_authenticated");
  if (e.code === "P0001" && e.message && ERROR_MESSAGES[e.message]) return new AppError(e.message);
  if (e.code === "23505" && e.constraint === "organizations_slug_key") return new AppError("slug_taken");
  if (e.code === "22023" && e.message?.startsWith("Zona horaria")) return new AppError("invalid_timezone");
  if (e.code === "22023" && e.message && ERROR_MESSAGES[e.message]) return new AppError(e.message);
  if (e.code === "23514" || e.code === "22P02" || e.code === "22001") return new AppError("validation");
  return new AppError("unknown");
}
