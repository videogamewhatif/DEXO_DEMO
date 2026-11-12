# Seguridad

## Autenticación

- Supabase Auth gestiona usuarios y contraseñas; la app no almacena contraseñas.
- En el servidor se usa `getClaims()` (verifica el JWT); nunca `getSession()` para decisiones de acceso.
- Sesiones en cookies gestionadas por `@supabase/ssr`; `src/proxy.ts` las renueva.
- Acceso solo por invitación; registro público desactivado en Supabase.
- Mensajes de login genéricos (no revelan si la cuenta existe); recuperación con respuesta genérica.
- Redirecciones post-login solo a rutas internas (`safeNextPath`).

## Autorización y aislamiento

Ver `docs/arquitectura.md` y `docs/matriz-de-permisos.md`. Resumen: RLS en todas las tablas, sin escrituras directas de usuarios, funciones `SECURITY DEFINER` con `search_path` vacío que verifican permiso con `auth.uid()`, FKs compuestas, `organization_id` inmutable, empresa suspendida sin acceso. El cliente nunca aporta `organization_id`, rol ni identidad: la empresa se resuelve entre las del usuario y la BD reverifica.

El acceso privilegiado a la base de datos está confinado a `src/lib/db/privileged.ts`; ESLint impide importarlo desde `src/app` y `src/components`. Se usa solo para: credenciales y estados OAuth, el trabajador, la vista previa de invitaciones (por hash del token) y scripts.

## OAuth

- `state` de 256 bits; solo se guarda su hash; vence en 10 min; ligado a usuario, empresa y proveedor; **se consume aunque la validación falle** (un state robado no puede reintentarse). La empresa se toma del registro, nunca de la URL.
- PKCE S256 en Google (verificador cifrado en BD). Meta: sin PKCE (no documentado), intercambio en servidor + `appsecret_proof`.
- Permisos mínimos: `analytics.readonly` y `ads_read`.
- Inicio de conexión solo por POST con verificación de `Origin`; permiso verificado al iniciar y al completar.
- Redirect URIs fijas derivadas de `APP_URL`.

## Credenciales

- Cifrado AES-256-GCM con IV aleatorio; AAD = `integration:<id>:org:<id>` (un texto cifrado copiado a otra fila o empresa no descifra).
- Claves fuera de la BD (`TOKEN_ENCRYPTION_KEYS`); cada texto cifrado indica su id de clave.
- Al desconectar: revocación en el proveedor (si es posible) y borrado de la fila de credenciales.
- Tokens nunca en logs, URLs visibles, respuestas, exportaciones ni mensajes de error: `redactSecrets` depura todo mensaje de proveedor; el cliente HTTP no registra URLs; en Meta se sigue el cursor `after` y no la URL `next` (que trae el token).

### Rotación de claves de cifrado

1. Genera una clave nueva: `npm run keys:generate -- v2`.
2. Despliega con `TOKEN_ENCRYPTION_KEYS="v2:<nueva>,v1:<anterior>"` y `TOKEN_ENCRYPTION_ACTIVE_KEY_ID=v2` (app y trabajador). Las credenciales nuevas usan v2; las antiguas siguen descifrándose con v1.
3. Recifra todo: `npm run keys:rotate`.
4. Verifica: `select key_id, count(*) from nexo_private.integration_credentials group by 1;` (solo v2).
5. Retira v1 de `TOKEN_ENCRYPTION_KEYS` y despliega. Destruye la clave anterior según tu política.

Si una clave se compromete: rota de inmediato y, además, desconecta y reconecta las integraciones (o revoca los tokens en Google/Meta), porque los tokens pudieron exponerse.

## Exportaciones

Respetan filtros y permisos (`reports.export` verificado en servidor y BD; datos bajo RLS), se generan al momento sin enlaces públicos, `Cache-Control: private, no-store`, límite de 50 000 filas, neutralización de fórmulas y registro en auditoría.

## Sincronización

`/api/cron/sync` exige `CRON_SECRET` (comparación en tiempo constante). Los usuarios solo pueden solicitar actualizaciones manuales de cuentas de su empresa con permiso, con límite de una cada 15 min por cuenta. Los errores persistidos están depurados.

## Cabeceras

`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva. Pendiente: Content-Security-Policy con nonces (ver estado de funciones).

## Riesgos conocidos

- La conexión `DATABASE_URL` (usuario `postgres`) ignora RLS si se usara sin `withUserDb`; mitigado con un único punto de acceso, regla de ESLint y revisión. Opcional: un rol de login dedicado miembro de `authenticated` sin privilegios propios (fallaría de forma cerrada).
- La confirmación del correo de una persona invitada sin cuenta se basa en la posesión del enlace de un solo uso enviado a ese correo. Si el administrador comparte el enlace manualmente, debe hacerlo por un canal seguro.
