/**
 * Matriz de permisos — fuente única para servidor e interfaz.
 * La base de datos tiene la misma matriz en nexo.role_permissions
 * (supabase/migrations/20261110000001_core_schema.sql) y la prueba
 * tests/db/permissions-matrix.test.ts verifica que coincidan.
 */
export const ORG_ROLES = ["org_admin", "analyst", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
/** 'support' = acceso temporal y auditado de un platform admin (solo lectura). */
export type EffectiveRole = OrgRole | "support";

export const PERMISSIONS = [
  "org.view",
  "reports.view",
  "reports.export",
  "members.view",
  "members.manage",
  "integrations.view",
  "integrations.manage",
  "sync.trigger",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<EffectiveRole, readonly Permission[]> = {
  org_admin: [
    "org.view",
    "reports.view",
    "reports.export",
    "members.view",
    "members.manage",
    "integrations.view",
    "integrations.manage",
    "sync.trigger",
    "settings.manage",
    "audit.view",
  ],
  analyst: ["org.view", "reports.view", "reports.export", "members.view", "integrations.view"],
  viewer: ["org.view", "reports.view"],
  support: ["org.view", "reports.view", "integrations.view"],
};

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  org_admin: "Administrador de empresa",
  analyst: "Analista",
  viewer: "Lector",
  support: "Soporte (temporal)",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "org.view": "Ver la empresa",
  "reports.view": "Consultar reportes",
  "reports.export": "Exportar reportes (CSV)",
  "members.view": "Ver el equipo",
  "members.manage": "Invitar, cambiar roles y retirar miembros",
  "integrations.view": "Ver integraciones y estado de sincronización",
  "integrations.manage": "Conectar, configurar y desconectar integraciones",
  "sync.trigger": "Solicitar actualización manual",
  "settings.manage": "Cambiar preferencias de la empresa",
  "audit.view": "Consultar el registro de actividad",
};

export function can(role: EffectiveRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isOrgRole(v: unknown): v is OrgRole {
  return typeof v === "string" && (ORG_ROLES as readonly string[]).includes(v);
}
