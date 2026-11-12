# Matriz de permisos

Fuente única: `src/lib/authz/permissions.ts` (servidor e interfaz) y `nexo.role_permissions` (base de datos, usada por RLS y funciones). La prueba `tests/db/isolation.test.ts › la matriz de permisos…` falla si divergen.

| Permiso | Admin. de empresa | Analista | Lector | Soporte (temporal) |
| --- | :---: | :---: | :---: | :---: |
| Ver la empresa (`org.view`) | ✓ | ✓ | ✓ | ✓ |
| Consultar reportes (`reports.view`) | ✓ | ✓ | ✓ | ✓ |
| Exportar CSV (`reports.export`) | ✓ | ✓ | — | — |
| Ver el equipo (`members.view`) | ✓ | ✓ | — | — |
| Invitar, cambiar roles, retirar (`members.manage`) | ✓ | — | — | — |
| Ver integraciones y sincronizaciones (`integrations.view`) | ✓ | ✓ | — | ✓ |
| Conectar / configurar / desconectar (`integrations.manage`) | ✓ | — | — | — |
| Solicitar actualización manual (`sync.trigger`) | ✓ | — | — | — |
| Cambiar preferencias (`settings.manage`) | ✓ | — | — | — |
| Registro de actividad (`audit.view`) | ✓ | — | — | — |

**Platform admin** (fuera de la matriz de empresa): crear, editar, suspender y reactivar empresas; invitar administradores; ver usuarios, integraciones, trabajos y actividad de todas las empresas; reintentar trabajos; iniciar accesos de soporte. **No** ve datos de reportes sin una sesión de soporte.

## Dónde se aplica

| Capa | Mecanismo |
| --- | --- |
| Base de datos | Políticas RLS `organization_id in (select nexo.org_ids_with_permission(...))`; `authenticated` sin INSERT/UPDATE/DELETE; funciones `SECURITY DEFINER` que llaman a `nexo.require_permission`. Empresas suspendidas = sin permisos. |
| Servidor | `requireOrgContext` (membresía) + funciones de BD que reverifican; rutas de exportación y OAuth verifican el permiso y la BD lo vuelve a comprobar. |
| Interfaz | Navegación y botones deshabilitados con explicación según `can(rol, permiso)`. La interfaz nunca es la barrera de seguridad. |
