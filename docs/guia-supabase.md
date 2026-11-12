# Guía de configuración de Supabase

Supabase aporta **Auth** (usuarios y contraseñas; la app no guarda contraseñas) y **Postgres** (datos con RLS). Crear un proyecto puede tener costo según el plan: elige el plan tú; esta guía no contrata nada.

## 1. Proyecto y claves

1. Crea el proyecto en el panel de Supabase.
2. *Project Settings → API Keys*: copia la **publishable key** (`sb_publishable_…`) a `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y la **secret key** (`sb_secret_…`) a `SUPABASE_SECRET_KEY` (solo servidor). La URL del proyecto va en `NEXT_PUBLIC_SUPABASE_URL`.
3. *Connect → Connection string*: copia la del **Transaction pooler** (puerto 6543) a `DATABASE_URL` con la contraseña de la base de datos. Para el trabajador de larga duración también sirve el *Session pooler* o la conexión directa.
4. *Authentication → Sign In / Providers*: **desactiva "Allow new users to sign up"** (acceso solo por invitación). Mantén Email habilitado.
5. *JWT Keys*: los proyectos nuevos usan claves asimétricas (ES256), con lo que `getClaims()` verifica localmente vía JWKS. Si tu proyecto usa el secreto heredado (HS256), funciona igual pero cada verificación consulta al servidor de Auth; se recomienda migrar (botón *Migrate JWT secret* y luego *Rotate keys*).

## 2. Migraciones

Aplica en orden los archivos de `supabase/migrations/`:

- **Con Supabase CLI** (recomendado): `npx supabase link --project-ref <ref>` y `npx supabase db push`.
- **Sin CLI**: pega cada archivo, en orden, en el *SQL Editor*.

No añadas el esquema `nexo` a *Data API → Exposed schemas*: la app accede desde el servidor.

Verifica:

```sql
select count(*) from nexo.role_permissions;            -- 20
select pg_has_role(current_user, 'authenticated', 'member'); -- true con el usuario de DATABASE_URL
```

y `GET /api/health` → `"database": "ok"`. Si devuelve `error_rol_o_migraciones`, el usuario de `DATABASE_URL` no puede asumir `authenticated` o faltan migraciones.

## 3. URLs y correo de Auth

*Authentication → URL Configuration*:

- **Site URL**: tu `APP_URL` (p. ej. `https://reportes.tudominio.com`).
- **Redirect URLs**: `https://reportes.tudominio.com/auth/confirm` (y `http://localhost:3000/auth/confirm` en desarrollo).

*Authentication → Emails → Templates → Reset password*: usa un enlace con `token_hash` (evita que los escáneres de correo consuman el enlace y funciona entre dispositivos):

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/restablecer">Crear una contraseña nueva</a>
```

El correo de Supabase por defecto tiene límites estrictos de envío y está pensado para pruebas. Para producción configura **SMTP propio** en *Authentication → Emails → SMTP Settings*.

> Las **invitaciones de la plataforma** no usan el correo de Supabase: usan `SMTP_*` de la app. Si no lo configuras, la app muestra el enlace para compartirlo manualmente y lo indica claramente.

## 4. Desarrollo local con Supabase CLI (opcional, requiere Docker)

```bash
npx supabase start          # muestra URL, publishable y secret keys locales
npx supabase db reset       # aplica migraciones + seed.sql (vacío)
```

Usa los valores que imprime en `.env.local`; `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `DATABASE_SSL=disable`. Los correos locales se ven en Mailpit (`http://127.0.0.1:54324`). `supabase/config.toml` ya desactiva el registro público y define la plantilla de recuperación.

## 5. Pruebas de RLS sin Supabase

`npm run db:local:start && npm run test:db` aplica las migraciones reales sobre PostgreSQL con un *shim* mínimo de `auth.users`/`auth.uid()` (`tests/db/sql/supabase-auth-shim.sql`, **solo pruebas**). Para máxima fidelidad, ejecuta también las pruebas contra un proyecto de Supabase de prueba: `TEST_DB_ADMIN_URL` debe apuntar a una base donde se pueda crear/eliminar la base `nexo_test` (en Supabase hospedado esto no está permitido; usa Supabase CLI local).
