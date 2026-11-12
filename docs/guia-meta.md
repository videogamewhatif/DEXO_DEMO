# Guía de configuración de Meta Ads

Verificado contra la documentación oficial de Meta en noviembre de 2026 (fuentes al final). Algunas páginas de referencia de Meta no pudieron consultarse durante el desarrollo; donde algo no se confirmó, se indica.

## 1. Versión de la API

La tabla oficial de versiones indica que **Marketing API v25.0** (publicada el 18-feb-2026) es la única versión de Marketing API vigente en noviembre de 2026 (v24.0 venció el 6-oct-2026); Graph API v26.0 se publicó el 29-jul-2026. La app usa `META_GRAPH_API_VERSION=v25.0` por defecto: revisa la tabla periódicamente y actualiza la variable antes de cada vencimiento.

## 2. App de Meta

1. En *Meta for Developers* crea una app (tipo **Business** recomendado) asociada al portafolio comercial de tu empresa.
2. Añade el producto **Marketing API** y un producto de inicio de sesión:
   - **Facebook Login** (flujo manual con `scope=ads_read`) — comportamiento por defecto de la app; o
   - **Facebook Login for Business**: crea una *configuración* con el permiso `ads_read` y pon su ID en `META_LOGIN_CONFIG_ID` (la app enviará `config_id` en lugar de `scope`). *No se pudo confirmar en la documentación consultada cuál es obligatorio para tu tipo de app; Meta lo indicará en el panel.*
3. En la configuración del inicio de sesión, **URI de redireccionamiento OAuth válidos** (exacto):
   - Producción: `https://TU_DOMINIO/api/integrations/meta_ads/callback`
   - Desarrollo: `http://localhost:3000/api/integrations/meta_ads/callback` (Meta puede exigir HTTPS; usa un túnel HTTPS en desarrollo si lo rechaza).
4. *Configuración → Básica*: copia el **ID de la app** a `META_APP_ID` y la **clave secreta** a `META_APP_SECRET` (solo servidor).
5. Recomendado: *Configuración → Avanzada → "Requerir clave secreta de la app"*: todas las llamadas de la app ya envían `appsecret_proof` (HMAC-SHA256 del token con el secreto).

## 3. Permisos, acceso y revisión

- Permiso usado: **`ads_read`** (solo lectura de reportes). No se solicita `ads_management`.
- **Acceso estándar**: suficiente para **tus propias cuentas publicitarias** y para usuarios con rol en la app (administradores, desarrolladores, testers) mientras la app está en desarrollo. Es de bajo límite de llamadas (nivel de desarrollo) y Meta indica que no es para producción con anunciantes reales.
- **Acceso avanzado a `ads_read`**: necesario para leer cuentas de **otras empresas**. Se solicita en *Revisión de la app → Permisos y funciones*; requiere revisión de Meta y, para datos sensibles, **verificación del negocio**. Meta exige además mantener actividad (≥ 1 500 llamadas en 15 días con < 15 % de errores) para conservarlo.
- Publica la app (modo *Live*) cuando la revisión esté aprobada.

## 4. Tokens: diferencias con Google

- El código se intercambia (servidor a servidor, con `client_secret`) por un token de corta duración y luego por un **token de larga duración (~60 días)** con `grant_type=fb_exchange_token`.
- **No existe refresh token.** La app muestra la fecha de vencimiento en *Integraciones*; cuando vence o Meta devuelve el error **190**, la integración pasa a **Requiere reconexión** y no se hacen más consultas hasta que un administrador reconecte.
- **PKCE**: la guía oficial del flujo manual no lo describe; la app no lo usa. La protección es el `state` de un solo uso ligado a usuario y empresa, el intercambio en servidor y `appsecret_proof`.
- **Desconectar** llama a `DELETE /me/permissions` (revocación), borra credenciales y cancela trabajos. *La documentación muestra dos formas de este endpoint; si Meta rechazara la revocación, la app lo indica y el usuario puede retirar el acceso desde la configuración de su cuenta.*

## 5. Datos sincronizados

- Cuentas: `GET /me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status` (paginado por cursor). *La referencia de este edge no pudo consultarse; los campos de la cuenta sí se verificaron en la referencia de Ad Account.*
- Insights: `GET /act_{id}/insights` con `level=campaign`, `time_increment=1`, `time_range={since,until}`, `use_unified_attribution_setting=true` y campos `campaign_id, campaign_name, account_currency, spend, impressions, clicks, inline_link_clicks, reach, actions, action_values, attribution_setting, date_start, date_stop`. Ventanas de 7 días; paginación por cursor `after` (nunca se sigue la URL `next`, que incluye el token).
- Si Meta responde "demasiados datos" (código 100, subcódigo 1487534) se usa un **reporte asíncrono** (`POST …/insights` → `report_run_id` → sondeo de `async_status` → resultados paginados).
- Campañas: `GET /act_{id}/campaigns?fields=id,name,status,objective`.
- Alcance por periodo exacto: `level=account`, campo `reach`.
- **Atribución**: se conserva `attribution_setting` por fila y el dashboard la muestra. Meta anunció que desde el 12-ene-2026 dejaría de devolver las ventanas `7d_view` y `28d_view`; la app no fuerza ventanas y usa la configuración unificada del conjunto de anuncios.
- Meta indica que los insights se actualizan cada ~15 minutos y no cambian después de 28 días: por eso se reconsulta una ventana reciente configurable (1–28 días, 7 por defecto).
- Retención de Meta: hasta 37 meses para totales (importación inicial por defecto: 90 días).

## 6. Límites

Se leen `X-Business-Use-Case(-Usage)` y `X-FB-Ads-Insights-Throttle`. Con uso ≥ 90 % se hace una pausa; los errores 4, 17, 32, 613 y 80000–80014 reprograman el trabajo según `estimated_time_to_regain_access` (o 5 min).

## 7. Qué verificar con credenciales reales (pendiente)

Las pruebas automatizadas usan respuestas simuladas. Antes de admitir clientes: conectar una cuenta real, comparar inversión, impresiones y clics en enlaces con el Administrador de anuncios para el mismo periodo y zona horaria, confirmar el comportamiento de la revocación y del inicio de sesión (Facebook Login o Login for Business), y obtener el acceso avanzado.

## Fuentes

- Versiones: https://developers.facebook.com/docs/graph-api/changelog/versions/
- Flujo manual de inicio de sesión: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
- Tokens de larga duración: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- appsecret_proof: https://developers.facebook.com/docs/graph-api/securing-requests
- Autorización y niveles de acceso: https://developers.facebook.com/docs/marketing-api/get-started/authorization
- Insights: https://developers.facebook.com/docs/marketing-api/insights/ y https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/
- Buenas prácticas y asíncronos: https://developers.facebook.com/docs/marketing-api/insights/best-practices/
- Límites: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
- Cambios de métricas 2025–2026: https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/
- Ad Account: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account
- Permisos de usuario (revocación): https://developers.facebook.com/docs/graph-api/reference/user/permissions/
