# Crear el primer administrador de plataforma

El rol *platform admin* **no** se puede obtener desde la interfaz, el perfil ni los metadatos de registro (hay una prueba que lo verifica). Se otorga con un procedimiento de servidor, versionado y auditado.

## Procedimiento (recomendado)

En una máquina de confianza con acceso a las variables de servidor (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`) en `.env.local`:

```bash
npm run admin:create-platform-admin -- --email persona@tudominio.com --note "Responsable de plataforma"
```

- Si la cuenta no existe, se crea con correo confirmado y una contraseña aleatoria que no se muestra, y el script imprime **un enlace de un solo uso** para definir la contraseña. Entrégalo solo a esa persona por un canal seguro. (Requiere la plantilla de recuperación y la Redirect URL configuradas: ver guía de Supabase.)
- Si la cuenta existe, solo se le otorga el rol.
- Se registra `platform_admin.granted` en el registro de actividad.

## Alternativa manual (SQL Editor de Supabase)

1. Crea el usuario en *Authentication → Users → Add user* (correo confirmado).
2. Ejecuta:

```sql
insert into nexo.platform_admins (user_id, granted_by, note)
select id, 'sql-editor', 'Primer administrador' from auth.users where lower(email) = lower('persona@tudominio.com');
select nexo.write_audit(null, null, 'system', 'platform_admin.granted', 'user',
  (select id::text from auth.users where lower(email) = lower('persona@tudominio.com')), '{}');
```

## Retirar el rol

```sql
delete from nexo.platform_admins where user_id = (select id from auth.users where lower(email) = lower('persona@tudominio.com'));
select nexo.write_audit(null, null, 'system', 'platform_admin.revoked', 'user', '<id>', '{}');
```

No existen cuentas administrativas con contraseñas fijas en el código ni en semillas.
