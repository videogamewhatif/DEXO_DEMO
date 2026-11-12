# Resumen de pruebas

Ejecutadas el 10-nov-2026 en el entorno de desarrollo (Linux, Node 22.23, PostgreSQL 16.15). Resultados de la última ejecución completa:

| Verificación | Comando | Resultado |
| --- | --- | --- |
| Tipos (TypeScript estricto) | `npm run typecheck` | ✅ sin errores |
| Lint (ESLint + reglas Next/React + restricción de acceso privilegiado) | `npm run lint` | ✅ sin errores |
| Unitarias | `npm test` | ✅ 39/39 |
| Integración con PostgreSQL real | `npm run test:db` | ✅ 36/36 |
| Build de producción | `npm run build` | ✅ |
| E2E (Playwright, Chromium) | `npm run test:e2e` | ✅ 18/18 |
| Instalación limpia desde lockfile | `npm ci` | ✅ |

## Qué tipo de prueba es cada una

| Categoría | Qué usa | Qué demuestra | Qué NO demuestra |
| --- | --- | --- | --- |
| **Fixtures / mocks** (unitarias de conectores, motor con proveedores simulados) | Respuestas simuladas con la forma documentada de Google y Meta (`tests/support/provider-mocks.ts`) | Paginación, clasificación de errores, límites, reintentos, normalización, idempotencia, recuperación | Que las APIs reales respondan igual hoy |
| **Base de datos real** (`tests/db`) | PostgreSQL 16 con las **migraciones reales**, rol `authenticated` y RLS; Supabase Auth sustituido por un *shim* mínimo de `auth.users`/`auth.uid()` | Aislamiento multiempresa (SELECT/INSERT/UPDATE/DELETE), roles, funciones de autorización, triggers, leases, sustitución idempotente | Comportamiento del Postgres gestionado de Supabase (versión 17, roles propios) |
| **E2E** (`tests/e2e`) | App compilada (`next start`), Postgres real, **doble de prueba de Supabase Auth** (`tests/e2e/mock-gotrue.mjs`) | Cableado completo: cookies, proxy, guardas, formularios, RLS a través de la interfaz, exportación, demo, móvil | El servicio real de Supabase Auth (correos, políticas de contraseña, JWKS) |
| **Proveedor externo real** | — | — | **No ejecutado**: no hay credenciales de Google ni Meta en este entorno |
| **Verificación manual pendiente** | — | Ver lista al final | — |

## Detalle

### Aislamiento y permisos (Postgres real)

- Ana (Empresa A) no lee filas de B en 15 tablas; Luis (B) no lee A.
- Credenciales y estados OAuth inaccesibles para usuarios; hash de invitaciones no legible ni para administradores.
- El repositorio de reportes no devuelve datos de otra empresa aunque se pidan sus IDs.
- INSERT de métricas denegado (en B y en la propia empresa: solo escribe el trabajador); UPDATE/DELETE en B denegados; no se insertan membresías en otra empresa.
- `organization_id` inmutable incluso con acceso privilegiado; FKs compuestas impiden relacionar empresas distintas.
- Lector: no invita, no gestiona integraciones, no sincroniza, no cambia configuración ni roles; no ve invitaciones, integraciones, auditoría ni trabajos.
- Admin de A no sincroniza ni selecciona cuentas de B; nadie se autoasigna platform admin (ni con metadatos de registro).
- La matriz de permisos de la BD coincide con la de la app.
- Usuario retirado pierde acceso aunque conozca IDs; último administrador protegido (también vía privilegiada).
- Empresa suspendida: sin lectura, sin sincronización manual, el trabajador no la toma, no se programan trabajos; el histórico se conserva y se restaura al reactivar.
- Platform admin sin acceso a reportes salvo sesión de soporte (solo lectura, auditada, visible para la empresa, termina al finalizarla).
- Invitaciones: un solo uso, solo el correo invitado, vencidas y revocadas rechazadas, no se crean para otra empresa.

### OAuth, sincronización y datos (Postgres real + proveedores simulados)

- Conexión de Meta: credenciales cifradas (sin el token en claro), alcance verificado, cuentas listadas.
- `state` de un solo uso, ligado al usuario, consumido incluso si lo usa otro usuario; la empresa sale del state, no de la URL; reutilización y vencimiento rechazados. *(Esta prueba detectó y permitió corregir un defecto: el state no se consumía cuando la validación fallaba.)*
- No se inicia conexión para otra empresa ni sin permiso.
- Sincronización Meta completa e **idempotente** (dos ejecuciones = mismos conteos y montos); reconciliación: filas eliminadas en el proveedor desaparecen al reconsultar.
- Un solo trabajo activo por cuenta; dos trabajadores no toman el mismo trabajo.
- Trabajo interrumpido recuperado desde su checkpoint sin re-consultar el primer bloque ni duplicar.
- Límite del proveedor: trabajo reprogramado según `estimated_time_to_regain_access`, sin escribir datos.
- Google `invalid_grant`: integración → requiere reconexión, sin consultas de datos ni nuevos trabajos programados.
- GA4: reportes por desglose, banderas de umbral, moneda y zona horaria de la propiedad; RLS en los datos sincronizados.
- Usuario de otra empresa no dispara sincronizaciones; límite de 15 min para actualizaciones manuales.
- Desconexión: revocación, credenciales borradas, **cero llamadas** al proveedor después, histórico conservado.

### Unitarias

Métricas (división segura, base cero, ausente/cero/pendiente, monedas separadas, CTR/CPC/CPM ponderados, huecos vs ceros, usuarios no aditivos, prospectos por fuente sin duplicar tipos, ROAS, periodos comparables, campañas vs cuenta), periodos, cifrado (ida y vuelta, AAD, manipulación, rotación, longitud de clave, vector PKCE RFC 7636), redacción de secretos, CSV seguro (fórmulas, comillas, BOM), redirecciones seguras, filtros, cliente HTTP restringido, conectores GA4 y Meta, reintentos y backoff.

### E2E

Demo (listado, aviso permanente, filtros, comparación, fuente, monedas separadas, conexión caducada, datos incompletos, CSV con BOM/periodo/fuente/moneda, rol simulado de lector, Próximamente sin botones, tabla ordenable, móvil sin scroll horizontal y menú, enlace "saltar al contenido"). Auth (rutas protegidas, error genérico, aislamiento A/B por interfaz y exportación, logout, lector sin administración ni exportación, cambio entre empresas, invitación sin SMTP con alta de cuenta y uso único, platform admin con acceso de soporte, usuario normal sin acceso a administración, recuperación genérica, cron con secreto, health).

## Cómo ejecutarlas

```bash
npm ci
npm run db:local:start      # PostgreSQL local en 54329 (o define TEST_DB_ADMIN_URL)
npm test && npm run test:db
npm run build && npm run test:e2e
```

## Verificación manual pendiente

- Supabase Auth real: login, recuperación por correo, creación de cuenta invitada (`admin.createUser`), política de contraseñas, JWKS.
- Migraciones sobre un proyecto Supabase real (Postgres 17) y `GET /api/health` = ok.
- GA4 y Meta con credenciales reales: conexión, listado, sincronización, comparación de totales con las interfaces de Google y del Administrador de anuncios, revocación y reconexión.
- Envío real de invitaciones por SMTP.
- Revisión de accesibilidad con lector de pantalla y contraste en modo oscuro.
