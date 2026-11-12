import type { Permission } from "@/lib/authz/permissions";

export interface NavItem {
  segment: string;
  label: string;
  permission: Permission;
}

export const ORG_NAV: NavItem[] = [
  { segment: "resumen", label: "Resumen", permission: "reports.view" },
  { segment: "publicidad", label: "Publicidad", permission: "reports.view" },
  { segment: "web", label: "Sitio web y landings", permission: "reports.view" },
  { segment: "redes", label: "Redes sociales", permission: "reports.view" },
  { segment: "reportes", label: "Reportes", permission: "reports.view" },
  { segment: "integraciones", label: "Integraciones", permission: "integrations.view" },
  { segment: "equipo", label: "Equipo", permission: "members.view" },
  { segment: "configuracion", label: "Configuración", permission: "settings.manage" },
];

export const ADMIN_NAV = [
  { href: "/admin/empresas", label: "Empresas" },
  { href: "/admin/usuarios", label: "Usuarios" },
  { href: "/admin/sincronizaciones", label: "Estado de sincronizaciones" },
  { href: "/admin/actividad", label: "Actividad administrativa" },
];
