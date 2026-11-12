# Estado de funciones (lista honesta)

Leyenda: ✅ implementado y probado · 🟡 implementado, verificación externa pendiente · ⏳ pendiente · 🔜 Próximamente (solo arquitectura/UI informativa)

## P0

| Función | Estado | Notas |
| --- | --- | --- |
| Autenticación (login, logout, sesiones, rutas protegidas) | 🟡 | Probada E2E con un doble de Supabase Auth; falta probar con Supabase real. |
| Recuperación y restablecimiento de contraseña | 🟡 | Flujo implementado (`/recuperar`, `/auth/confirm`, `/restablecer`); el envío del correo lo hace Supabase y no se probó aquí. |
| Invitaciones (vencimiento, revocación, un uso, correo ligado) | ✅ | BD + E2E. Envío por SMTP 🟡 (sin SMTP: enlace manual, indicado claramente). |
| Modelo multiempresa, roles, RLS, aislamiento | ✅ | Probado contra PostgreSQL real con migraciones reales. |
| Panel administrativo de plataforma | ✅ | Empresas, usuarios, sincronizaciones (reintento), actividad, soporte auditado. |
| Dashboard (resumen, publicidad, web) | ✅ | Con estados de carga, vacío, error y permisos. |
| Infraestructura modular de conectores | ✅ | Contrato, registro, HTTP restringido, errores, reintentos. |
| Conector GA4 | 🟡 | Probado con respuestas simuladas; falta prueba con cuenta real y verificación de la app en Google. |
| Conector Meta Ads | 🟡 | Probado con respuestas simuladas; falta prueba con cuenta real, acceso avanzado y revisión de la app. |
| Sincronización persistente, idempotente, con leases y recuperación | ✅ | Trabajador (`npm run worker`) y cron autenticado. |
| Modo demostración | ✅ | Separado, en memoria, siempre identificado. |
| Pruebas críticas | ✅ | 39 unitarias, 36 de integración con Postgres, 18 E2E. |
| Documentación de instalación | ✅ | README + `docs/`. |

## P1

| Función | Estado |
| --- | --- |
| Exportación CSV (filtros, permisos, BOM, anti-fórmulas, límite, auditoría) | ✅ |
| Comparación entre periodos | ✅ |
| Invitaciones y gestión de miembros (roles, retiro, último admin) | ✅ |
| Registro de actividad (empresa y plataforma) | ✅ |
| Preferencias de empresa (nombre, logo URL, zona horaria, moneda preferida, definiciones de prospecto/compra, frecuencia, ventana de reconsulta) | ✅ |
| Conexiones caducadas (estado, avisos en dashboard, reconexión, vencimiento de Meta visible) | ✅ |
| Subida de archivo de logotipo (hoy: URL HTTPS) | ⏳ |
| El logotipo de empresa aún no se muestra en el encabezado | ⏳ |

## P2 — Próximamente (sin botones de conexión)

Google Ads, Search Console, Instagram orgánico, Facebook Pages, YouTube Analytics, TikTok Ads, LinkedIn Ads, CRM/formularios/ventas, reportes PDF, envío programado. La arquitectura (contrato de conectores, familias de datos, `docs/guia-conectores.md`) está lista para añadirlos.

## Pendientes conocidos antes de clientes reales

1. Probar con Supabase real, GA4 real y Meta real (ver `docs/resumen-de-pruebas.md`).
2. Verificación de la app de Google (publicación fuera de *Testing*) y revisión de Meta (acceso avanzado a `ads_read`, verificación del negocio).
3. SMTP propio (app y Supabase), dominio con HTTPS, política de privacidad y términos publicados.
4. Content-Security-Policy con nonces; límites de frecuencia propios para endpoints (hoy: los de Supabase Auth y el límite de sincronización manual).
5. Programar `nexo.purge_operational_data` y copias de seguridad.
6. Conversión de monedas (si se requiere un total en moneda de presentación): no implementada a propósito.
7. Flujo de eliminación definitiva de empresa con confirmación (hoy: procedimiento SQL documentado).
8. Agregados en SQL para volúmenes grandes: hoy el dashboard carga filas diarias de nivel campaña y agrega en el servidor (adecuado para cientos de campañas y ≤ 400 días).
9. Revisión de accesibilidad con lector de pantalla.
10. ESLint 9 está marcado como obsoleto por su autor; se mantiene porque `eslint-config-next` 16.4 aún depende de un plugin que no admite ESLint 10.
