# Incorporar empresas y usuarios

## Alta de una empresa (platform admin)

1. *Administración de plataforma → Empresas → Crear empresa*: nombre, identificador de URL (`/app/<identificador>`), zona horaria y moneda preferida.
2. En la tarjeta de la empresa, **Invitar administrador de empresa** con su correo.
   - Con SMTP configurado se envía el correo.
   - Sin SMTP la app **no** envía nada, lo dice y muestra el enlace **una sola vez** para compartirlo por un canal seguro.
3. La persona abre el enlace: si no tiene cuenta, crea su contraseña; si ya la tiene, inicia sesión con **el mismo correo** y acepta.

Las invitaciones vencen (1–14 días, 7 por defecto), son de un solo uso, se pueden revocar, están ligadas a empresa + correo + rol y una nueva invitación al mismo correo revoca la anterior.

## Gestión del equipo (administrador de empresa)

*Equipo*: invitar (con rol), cambiar roles, retirar personas y revocar invitaciones. No es posible dejar a la empresa sin administrador (protección en la base de datos). Una persona retirada pierde el acceso de inmediato, aunque conserve su sesión o conozca identificadores.

Una persona puede pertenecer a varias empresas con roles distintos y cambiar entre ellas con el selector superior.

## Suspender / reactivar

*Empresas → Suspender* (motivo obligatorio): bloquea el acceso a los datos para todos los miembros, cancela trabajos pendientes, impide nuevas sincronizaciones y termina sesiones de soporte. **No borra** el histórico. *Reactivar* restablece el acceso.

## Acceso de soporte

Para revisar los reportes de un cliente, el platform admin inicia un **acceso de soporte** desde la tarjeta de la empresa (motivo obligatorio, 30 min a 2 h). Es de solo lectura, muestra un aviso permanente y queda en el registro de actividad visible para los administradores de la empresa. No existe suplantación de usuarios.

## Eliminar definitivamente una empresa

No hay botón (irreversible). Procedimiento manual tras confirmar con el cliente y exportar lo necesario:

```sql
-- Revisa primero qué se borrará
select * from nexo.organizations where slug = 'empresa-x';
delete from nexo.organizations where slug = 'empresa-x'; -- borra en cascada membresías, integraciones, credenciales y métricas
```

Los registros de `audit_logs` se conservan (no tienen clave foránea).
