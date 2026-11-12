# Arquitectura, decisiones y supuestos

## Resumen

```
Navegador ──► Next.js 16 (App Router, Node)
               │  proxy.ts: renueva sesión de Supabase (cookies)
               │  getClaims(): verifica el JWT (JWKS o servidor de Auth)
               │
               ├─ withUserDb(identidad) ─► Postgres: SET LOCAL ROLE authenticated
               │                           + request.jwt.claims  ──► RLS
               │
               └─ acceso privilegiado acotado (credenciales, OAuth state, alta de invitados)
                                            ▲
Trabajador (npm run worker / cron) ─────────┘  claim con lease ► proveedor ► sustitución del periodo
```

## Decisiones

1. **Supabase Auth para identidad; Postgres directo para datos.** La app no usa PostgREST para datos de empresas. Cada petición de usuario abre una transacción, ejecuta `SET LOCAL ROLE authenticated` y fija `request.jwt.claims` con el `sub` del JWT verificado: es el mismo mecanismo que usa PostgREST, así que las políticas RLS se aplican igual. Ventajas: transacciones reales (sustitución idempotente de periodos), consultas de reporte complejas en SQL y, sobre todo, que **el mismo código se prueba contra Postgres real** (ver `tests/db`). Referencia del mecanismo: guía oficial de Supabase para probar RLS (`set local role authenticated` + claims).
2. **Esquema `nexo` no expuesto por la API REST.** Aunque RLS protege todas las tablas, el navegador no tiene acceso directo a ellas. Las credenciales y estados OAuth están en `nexo_private`, sin privilegios para `authenticated`.
3. **Sin escrituras directas de usuarios.** `authenticated` solo tiene `SELECT`. Toda mutación de usuario es una función `SECURITY DEFINER` que obtiene el usuario de `auth.uid()`, verifica permiso y estado de la empresa y audita. El trabajador escribe con la conexión privilegiada.
4. **Aislamiento estructural.** Todas las tablas de empresa llevan `organization_id`; las relaciones usan claves foráneas compuestas `(id, organization_id)`; un trigger hace inmutable `organization_id`; el último administrador está protegido por trigger.
5. **Platform admin sin acceso implícito a datos de clientes.** Ve metadatos operativos (empresas, integraciones, trabajos, auditoría). Para ver reportes inicia una **sesión de soporte** temporal (5–240 min), de solo lectura, con motivo obligatorio, visible para los administradores de la empresa.
6. **Tablas separadas por familia de datos** (`ad_campaign_daily`, `ad_campaign_daily_actions`, `web_daily`, `web_daily_key_events`, `metric_snapshots`, `data_coverage`) en lugar de una tabla universal.
7. **Cobertura explícita** (`data_coverage`): permite distinguir cero real (día consultado sin filas) de dato ausente (día no consultado) y de sincronización pendiente.
8. **Agregados no aditivos** (usuarios GA4, alcance Meta) se consultan al proveedor para periodos exactos (`metric_snapshots`) en lugar de sumarse.
9. **Demostración separada** en `/demo`, en memoria, sin base de datos ni autenticación.

## Modelo de datos

| Tabla | Granularidad / propósito |
| --- | --- |
| `organizations` | Empresa, estado, preferencias (zona horaria, moneda preferida, definiciones de prospecto/compra, frecuencia) |
| `organization_members` | Usuario × empresa × rol (`org_admin`, `analyst`, `viewer`) |
| `platform_admins` | Solo asignable por script privilegiado |
| `invitations` | Hash del token, correo, rol, vencimiento, revocación, uso único, estado de envío |
| `integrations` | Conexión por empresa y proveedor (una activa), estado y último error |
| `nexo_private.integration_credentials` | Tokens cifrados AES-256-GCM (AAD = integración + empresa) |
| `nexo_private.oauth_states` | Hash del state, usuario, empresa, verificador PKCE cifrado, vencimiento 10 min, un uso |
| `provider_accounts` | Propiedad GA4 / cuenta publicitaria, con moneda y zona horaria de origen |
| `campaigns` | Metadatos de campañas |
| `ad_campaign_daily` | Campaña × día (zona de la cuenta). Clave: empresa, cuenta, campaña, fecha |
| `ad_campaign_daily_actions` | Campaña × día × tipo de acción (valor y valor monetario atribuido) |
| `web_daily` | Propiedad × día × desglose (`total`, `source_medium`, `campaign`, `landing_page`, `device`) × valor |
| `web_daily_key_events` | Propiedad × día × evento |
| `metric_snapshots` | Métrica no aditiva × periodo exacto |
| `data_coverage` | Cuenta × conjunto de datos × día consultado con éxito (+ banderas de calidad) |
| `sync_jobs` / `sync_runs` | Trabajos persistentes (lease, checkpoint, intentos) y cada ejecución |
| `audit_logs` | Auditoría (sin FK, conserva historial) |
| `support_sessions` | Accesos de soporte |
| `role_permissions` | Matriz de permisos usada por las políticas |

Dinero: `numeric(18,4)`. Fechas de métricas: `date` en la zona horaria de la cuenta de origen. Marcas de tiempo: `timestamptz`.

### Retención y eliminación

- Desconectar una integración elimina credenciales y detiene sincronizaciones; **conserva** el histórico.
- Suspender una empresa bloquea acceso y sincronizaciones; **conserva** el histórico.
- `nexo.purge_operational_data(días)` elimina estados OAuth vencidos y ejecuciones/trabajos terminados antiguos (por defecto 90 días). Prográmala (p. ej. `pg_cron`) o ejecútala periódicamente.
- No se almacenan respuestas crudas de los proveedores ni datos personales de visitantes: solo agregados. `landingPage` se usa sin query string para evitar parámetros con datos personales.
- Eliminación completa del histórico de una empresa: pendiente de un flujo con confirmación (hoy, procedimiento manual documentado en `docs/empresas-y-usuarios.md`).

## Supuestos

- Una conexión activa por proveedor y empresa (la misma conexión puede autorizar varias cuentas).
- No hay conversión de monedas: los importes se muestran por moneda de origen.
- Las fechas de cada fuente están en su zona horaria; no se reetiquetan a la zona de la empresa (sería falso). Los presets usan la zona de la empresa para calcular "hoy".
- Actualización diaria por defecto, reconsulta de los últimos 7 días (configurable 1–28) e importación inicial de 90 días (configurable).
- El dashboard muestra solo datos persistidos; nunca consulta al proveedor al abrir una pantalla.
