# Resolución de errores

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Login muestra "La autenticación no está configurada" | Faltan `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` o `DATABASE_URL` | Completa variables y reinicia. Revisa `/api/health`. |
| `/api/health` → `database: error_rol_o_migraciones` | Migraciones no aplicadas o el usuario de `DATABASE_URL` no puede `SET ROLE authenticated` | Aplica migraciones; usa el usuario `postgres` de Supabase; verifica `select pg_has_role(current_user,'authenticated','member')`. |
| `database: sin_conexion` | Cadena, contraseña o SSL | Revisa `DATABASE_URL`; en local `DATABASE_SSL=disable`. |
| "Correo o contraseña incorrectos" con datos correctos | Usuario no confirmado o bloqueado en Supabase | Revisa *Authentication → Users*. |
| El enlace de recuperación lleva a "enlace no válido" | Plantilla sin `token_hash` o Redirect URL faltante | Ver guía de Supabase §3. |
| "Esta invitación pertenece a otro correo" | Sesión iniciada con otra cuenta | Cerrar sesión e iniciar con el correo invitado. |
| Invitación creada pero "no se envió correo" | `SMTP_*` sin configurar | Configura SMTP o comparte el enlace mostrado por un canal seguro. |
| Integración "no configurada en el servidor" | Faltan `GOOGLE_OAUTH_*` o `META_APP_*` | Ver guías de Google/Meta. |
| Google: `redirect_uri_mismatch` | URI no registrada exactamente | Registra `APP_URL/api/integrations/google_analytics/callback`. |
| Google: "no entregó un refresh token" | Consentimiento previo sin `prompt=consent` o cuenta con acceso ya concedido | Revoca el acceso de la app en la cuenta de Google y reconecta. |
| GA4 pasa a "Requiere reconexión" cada semana | App en estado *Testing* (refresh tokens de 7 días) | Publica y verifica la app. |
| Meta: "URL bloqueada" / redirect inválido | URI no registrada en el producto de inicio de sesión | Añade `APP_URL/api/integrations/meta_ads/callback`. |
| Meta: "No se concedió el permiso ads_read" | El usuario lo desmarcó o la app no tiene el permiso | Reconecta aceptando el permiso; revisa acceso estándar/avanzado. |
| Meta: no aparecen cuentas de clientes | Falta acceso avanzado a `ads_read` | Solicita revisión de la app. |
| Trabajo "Fallida" con `meta_ads:auth:190` | Token vencido o revocado | Reconecta desde Integraciones. |
| Trabajo "Pendiente" con `rate_limited` | Límite del proveedor | Se reintenta solo en la hora indicada. |
| Trabajo "Parcial" | Conjunto de GA4 incompatible o agregados por periodo no disponibles | Ver detalle del trabajo; el resto de datos sí se guardó. |
| Trabajos quedan "En curso" | Trabajador detenido | Al pasar el lease (`SYNC_LEASE_SECONDS`) se recuperan desde el checkpoint en el siguiente ciclo. |
| `/api/cron/sync` → 401 | Falta o no coincide `CRON_SECRET` | Envía `Authorization: Bearer <CRON_SECRET>`. |
| KPI "No disponible" en Usuarios o Alcance | Métrica no aditiva fuera de un periodo precalculado o con varias cuentas | Usa 7/28/90 días y filtra una propiedad/cuenta. |
| KPI "No disponible" en Prospectos | No se definió el evento/acción | *Configuración* → definir evento de GA4 y acción de Meta. |
| "Datos incompletos" | Días sin sincronizar en el periodo | Revisa el historial de sincronizaciones o solicita actualización. |
| `npm ci` falla por dependencias pares | Falta `.npmrc` | Debe existir con `legacy-peer-deps=true`. |
