# Despliegue de la aplicación y del trabajador

No se ha desplegado nada a producción desde este trabajo. Elige proveedor y plan tú (pueden tener costo).

## Componentes

| Componente | Comando | Notas |
| --- | --- | --- |
| Aplicación web | `npm ci && npm run build && npm start` | Next.js 16, runtime Node. Cualquier plataforma con Node ≥ 20.9 (Vercel, Railway, Render, Fly.io, contenedor propio). |
| Trabajador | `npm run worker` | Proceso de larga duración; varios en paralelo son seguros (leases). Recomendado para importaciones grandes. |
| Programador | `POST /api/cron/sync` con `Authorization: Bearer $CRON_SECRET` | Alternativa o complemento al trabajador en plataformas serverless. Procesa con presupuesto de tiempo (`SYNC_CRON_TIME_BUDGET_MS`) y cede los trabajos con checkpoint. |
| Base de datos | Supabase | Migraciones en `supabase/migrations`. |

## Opción A — Plataforma con procesos (Railway, Render, Fly.io, VM)

- Servicio web: `npm start` (puerto `PORT`, p. ej. `next start -p $PORT`).
- Servicio *worker*: `npm run worker`.
- Ambos con las mismas variables de servidor. El trabajador no necesita `NEXT_PUBLIC_*` salvo para scripts.

## Opción B — Vercel (serverless)

- Despliega la app; configura variables en *Settings → Environment Variables* (marca secretas las de servidor).
- Programa `/api/cron/sync` (Vercel Cron u otro programador externo) cada 15–60 minutos enviando el encabezado `Authorization: Bearer <CRON_SECRET>`. Si tu plan no permite la frecuencia o duración necesarias, ejecuta además el trabajador en otro servicio.
- `maxDuration` del endpoint es 60 s; ajusta `SYNC_CRON_TIME_BUDGET_MS` por debajo de ese límite.

## Checklist de producción

- [ ] En una presentación sin Supabase/base de datos, la demo pública queda disponible automáticamente; define `DEMO_MODE_ENABLED=false` para desactivarla. En producción con datos reales, mantenla desactivada.
- [ ] `APP_URL` con HTTPS; redirect URIs registradas en Google y Meta con ese dominio.
- [ ] Registro público desactivado en Supabase; SMTP propio en Supabase y `SMTP_*` en la app.
- [ ] `TOKEN_ENCRYPTION_KEYS` y `CRON_SECRET` generados y guardados en el gestor de secretos.
- [ ] `GET /api/health` → `ok: true` y todos los componentes `configurado`.
- [ ] Primer platform admin creado con el script.
- [ ] Trabajador o cron activos (revisa *Administración → Estado de sincronizaciones*).
- [ ] Programar `select nexo.purge_operational_data(90);` (p. ej. diario con `pg_cron`).
- [ ] Copias de seguridad de la base de datos según tu plan de Supabase.
- [ ] Apps de Google y Meta verificadas/aprobadas (ver guías) antes de admitir clientes externos.

## Docker (opcional)

No se incluye Dockerfile verificado (el entorno de desarrollo no tenía acceso a registros de imágenes). Una imagen basada en `node:22-alpine` con `npm ci && npm run build` y comandos `npm start` / `npm run worker` es suficiente.
