# Guía de configuración de Google Analytics 4

Verificado contra la documentación oficial de Google en noviembre de 2026 (fuentes al final). Las consolas cambian: si un nombre de menú no coincide, busca la opción equivalente.

## 1. Proyecto de Google Cloud

1. Crea (o elige) un proyecto en Google Cloud Console.
2. *APIs y servicios → Biblioteca*: habilita **Google Analytics Data API** (reportes, `analyticsdata.googleapis.com`) y **Google Analytics Admin API** (listado de propiedades, moneda y zona horaria, `analyticsadmin.googleapis.com`).

## 2. Pantalla de consentimiento OAuth

1. Tipo de usuario **Externo** (para que otras empresas conecten sus cuentas).
2. Datos de la app, dominio autorizado (el de `APP_URL`), página de inicio y **política de privacidad** publicadas en ese dominio.
3. Permiso (scope): **`https://www.googleapis.com/auth/analytics.readonly`**, el único que usa la app (solo lectura).
4. Mientras la app esté en estado **"Testing"**, solo pueden conectarse los usuarios de prueba que añadas, y Google emite **refresh tokens que vencen a los 7 días**: la integración pasará a "Requiere reconexión" cada semana. Para clientes reales hay que **publicar** la app y completar la **verificación** de Google (dominio verificado, política de privacidad, justificación del permiso y, para permisos sensibles, video de demostración del flujo OAuth). Revisa en la consola si el permiso aparece como sensible.

## 3. Cliente OAuth

*Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*:

- **URI de redireccionamiento autorizado** (exacto, incluido el esquema y sin barra final):
  - Producción: `https://TU_DOMINIO/api/integrations/google_analytics/callback`
  - Desarrollo: `http://localhost:3000/api/integrations/google_analytics/callback`
- Copia el ID a `GOOGLE_OAUTH_CLIENT_ID` y el secreto a `GOOGLE_OAUTH_CLIENT_SECRET` (secreto: solo en el gestor de variables).

## 4. Cómo funciona la conexión

1. Un administrador de empresa pulsa **Conectar** en *Integraciones*. El servidor crea un `state` aleatorio de un solo uso (10 min) ligado a usuario y empresa y un verificador PKCE, y redirige a Google con `access_type=offline` y `prompt=consent` (para obtener refresh token también al reconectar).
2. En el callback se consume el `state`, se vuelve a verificar el permiso, se intercambia el código (con `client_secret` y `code_verifier`) y se guardan los tokens **cifrados**.
3. Se listan las propiedades con `accountSummaries.list` (paginado). El administrador elige cuáles sincronizar.
4. Antes de la primera sincronización se leen moneda y zona horaria de la propiedad (`properties.get`) y se valida cada conjunto de reportes con `properties:checkCompatibility`. Un conjunto incompatible se omite y el trabajo queda como *Parcial*.

**PKCE**: Google documenta `code_challenge`/`code_verifier` en el mismo endpoint de autorización para apps instaladas; la guía de apps web de servidor no lo menciona. La app lo envía además del `client_secret`. Si tu cliente lo rechazara, pon `GOOGLE_OAUTH_USE_PKCE=false`.

## 5. Datos sincronizados

Reportes separados y compatibles (no todo en una consulta), por día, en la zona horaria de la propiedad:

| Conjunto | Dimensiones | Métricas |
| --- | --- | --- |
| `web_total` | `date` | `sessions`, `engagedSessions`, `totalUsers`, `newUsers`, `screenPageViews`, `keyEvents` |
| `web_source_medium` | `date`, `sessionSourceMedium` | `sessions`, `engagedSessions`, `keyEvents` |
| `web_campaign` | `date`, `sessionCampaignName` | idem |
| `web_landing_page` | `date`, `landingPage` (sin query string) | idem |
| `web_device` | `date`, `deviceCategory` | idem |
| `web_key_events` | `date`, `eventName` | `keyEvents` |
| Agregados exactos | (sin dimensiones) | `totalUsers`, `activeUsers` para 7/28/90 días y sus periodos anteriores |

Paginación con `limit`/`offset` (10 000 filas por página, máximo 50 páginas por reporte). Se guardan las banderas `subjectToThresholding`, `dataLossFromOtherRow` y muestreo y se avisan en el dashboard. `returnPropertyQuota=true` registra la cuota restante.

**Cuotas** (propiedades estándar, documentación de Google): 200 000 tokens/propiedad/día, 40 000/hora, 14 000 por proyecto y propiedad por hora, 10 solicitudes concurrentes. Un 429 `RESOURCE_EXHAUSTED` reprograma el trabajo (respeta `Retry-After` si llega; si no, espera 1 h). Las cuotas diarias se reinician a medianoche del Pacífico.

## 6. Renovación, caducidad y desconexión

- El access token dura ~1 h; el trabajador lo renueva con el refresh token.
- `invalid_grant` al renovar (revocado, 6 meses sin uso, app en Testing tras 7 días, cambio de contraseña con ciertos permisos, límite de 100 refresh tokens por cuenta y cliente) → la integración pasa a **Requiere reconexión** y no se hacen más consultas.
- **Desconectar** revoca el token en `https://oauth2.googleapis.com/revoke`, borra las credenciales y cancela trabajos pendientes; el histórico se conserva.

## 7. Qué verificar con credenciales reales (pendiente)

Las pruebas automatizadas usan respuestas simuladas. Antes de admitir clientes: conectar una propiedad real, confirmar nombres de métricas con `checkCompatibility` (la app ya lo hace), revisar los totales contra la interfaz de GA4 para el mismo periodo y zona horaria, y probar la reconexión.

## Fuentes

- OAuth 2.0 para apps web de servidor: https://developers.google.com/identity/protocols/oauth2/web-server
- PKCE (apps instaladas): https://developers.google.com/identity/protocols/oauth2/native-app
- Caducidad de refresh tokens: https://developers.google.com/identity/protocols/oauth2#expiration
- runReport: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- Esquema de dimensiones y métricas: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- Cuotas: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- accountSummaries.list: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
- Verificación de apps OAuth: https://support.google.com/cloud/answer/13464321
