# Variables de entorno

Todas se validan al arrancar (`src/config/env.ts`). Una variable vacía (`VAR=`) se trata como no definida.

**Públicas** (`NEXT_PUBLIC_*`) pueden llegar al navegador: no pongas secretos ahí. **Servidor**: solo app (servidor) y trabajador. Configura los secretos en el gestor de variables de tu plataforma (Vercel, Railway, etc.) o en `.env.local` en tu equipo; nunca en el repositorio ni en chats.

| Variable | Tipo | Requerida | Uso |
| --- | --- | --- | --- |
| `APP_URL` | Servidor | Sí (prod.) | URL pública base. Se usa para redirect URIs OAuth, enlaces de invitación y verificación de `Origin`. |
| `DEMO_MODE_ENABLED` | Servidor | No | `true`/`false`. Sin definir, está activa fuera de producción y también en producción cuando falta la configuración de Supabase o la base de datos. Con todo configurado, queda apagada en producción. `false` siempre la desactiva. |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | Sí (auth) | URL del proyecto Supabase. Se lee en tiempo de ejecución en el servidor. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública | Sí (auth) | Clave publicable `sb_publishable_…`. |
| `SUPABASE_SECRET_KEY` | **Secreta** | Sí (invitaciones) | Clave secreta `sb_secret_…`. Solo para crear la cuenta de una persona invitada tras validar su invitación y en scripts. Nunca para eludir RLS en peticiones de usuarios. |
| `DATABASE_URL` | **Secreta** | Sí (datos) | Conexión Postgres. En serverless usa el *Transaction pooler* (puerto 6543). El rol debe poder `SET ROLE authenticated` (el rol `postgres` de Supabase puede). |
| `DATABASE_SSL` | Servidor | No | `require` (defecto), `no-verify`, `disable` (solo local). |
| `DATABASE_POOL_MAX` | Servidor | No | Conexiones por proceso (defecto 5). |
| `TOKEN_ENCRYPTION_KEYS` | **Secreta** | Sí (integraciones) | `id:base64(32 bytes)` separados por coma. Genera con `npm run keys:generate -- v1`. |
| `TOKEN_ENCRYPTION_ACTIVE_KEY_ID` | Servidor | Sí (integraciones) | Id de la clave con la que se cifra. |
| `CRON_SECRET` | **Secreta** | Sí (cron) | `Authorization: Bearer …` para `/api/cron/sync`. Sin él, el endpoint rechaza todo. |
| `SYNC_LEASE_SECONDS` | Servidor | No | Duración del lease (defecto 300). |
| `SYNC_CRON_TIME_BUDGET_MS` | Servidor | No | Presupuesto de tiempo por invocación de cron (defecto 50 000). |
| `SYNC_WORKER_ID` | Servidor | No | Identificador del trabajador en logs/leases. |
| `SYNC_IDLE_MS` | Servidor | No | Espera entre ciclos del trabajador (defecto 30 000). |
| `GOOGLE_OAUTH_CLIENT_ID` | Servidor | Sí (GA4) | ID de cliente OAuth web. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | **Secreta** | Sí (GA4) | Secreto del cliente OAuth. |
| `GOOGLE_OAUTH_USE_PKCE` | Servidor | No | `true` (defecto). Ver guía de Google. |
| `META_APP_ID` | Servidor | Sí (Meta) | ID de la app de Meta. |
| `META_APP_SECRET` | **Secreta** | Sí (Meta) | Secreto de la app (intercambio de código y `appsecret_proof`). |
| `META_GRAPH_API_VERSION` | Servidor | No | Defecto `v25.0`. Revisa la vigencia en la página de versiones de Meta. |
| `META_LOGIN_CONFIG_ID` | Servidor | No | ID de configuración de *Facebook Login for Business*; si se define, sustituye a `scope`. |
| `META_ASYNC_POLL_TIMEOUT_MS` | Servidor | No | Espera máxima de reportes asíncronos (defecto 10 min). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` | Servidor | No | Envío de invitaciones. Sin `SMTP_HOST`/`SMTP_FROM` la app **no** envía correo y lo dice; muestra el enlace una vez para compartirlo manualmente. |
| `SMTP_PASSWORD` | **Secreta** | No | Contraseña SMTP. |

Variables solo de pruebas: `TEST_DB_ADMIN_URL` (Postgres para `test:db`, defecto `postgres://postgres@127.0.0.1:54329/postgres`), `E2E_DATABASE_URL`, `LOCAL_PG_PORT`, `LOCAL_PG_DIR`, `PGBIN`.

`NODE_ENV` la fija Next.js/Node.
