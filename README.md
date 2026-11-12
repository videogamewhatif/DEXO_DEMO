# Nexo Analytics

Plataforma web multiempresa de reportes de marketing digital (publicidad, sitio web y landing pages). Cada persona entra con su usuario; los datos de cada empresa están aislados por autenticación, autorización y Row Level Security en la base de datos.

> Nombre, logotipo y colores provisionales: `src/config/brand.ts` y `public/brand/logo.svg`.

## Contenido

| Tema | Documento |
| --- | --- |
| Estado honesto: qué funciona y qué falta | [docs/estado-funciones.md](docs/estado-funciones.md) |
| Arquitectura, decisiones y supuestos | [docs/arquitectura.md](docs/arquitectura.md) |
| Variables de entorno (públicas vs. servidor) | [docs/variables-de-entorno.md](docs/variables-de-entorno.md) |
| Supabase (Auth + Postgres) | [docs/guia-supabase.md](docs/guia-supabase.md) |
| Google Analytics 4 | [docs/guia-google.md](docs/guia-google.md) |
| Meta Ads | [docs/guia-meta.md](docs/guia-meta.md) |
| Primer administrador de plataforma | [docs/primer-administrador.md](docs/primer-administrador.md) |
| Alta de empresas y usuarios | [docs/empresas-y-usuarios.md](docs/empresas-y-usuarios.md) |
| Añadir conectores | [docs/guia-conectores.md](docs/guia-conectores.md) |
| Despliegue de app y trabajador | [docs/despliegue.md](docs/despliegue.md) |
| Resolución de errores | [docs/resolucion-de-errores.md](docs/resolucion-de-errores.md) |
| Matriz de permisos | [docs/matriz-de-permisos.md](docs/matriz-de-permisos.md) |
| Métricas, fórmulas y reglas de calidad | [docs/metricas.md](docs/metricas.md) |
| Seguridad, cifrado y rotación de claves | [docs/seguridad.md](docs/seguridad.md) |
| Resumen de pruebas | [docs/resumen-de-pruebas.md](docs/resumen-de-pruebas.md) |

## Requisitos

- Node.js 20.9 o superior (probado con 22).
- npm (el repositorio incluye `package-lock.json` y `.npmrc` con `legacy-peer-deps=true`, necesario porque `eslint-config-next` aún declara ESLint ≤ 9 en una dependencia transitiva).
- Para datos reales: un proyecto de Supabase (o Supabase CLI con Docker para local).
- Para pruebas de integración: PostgreSQL 15+ local (sin Docker) o cualquier Postgres accesible.

## Arranque rápido: solo demostración (sin credenciales)

```bash
npm ci
npm run dev
# abre http://localhost:3000/demo
```

La demostración usa dos empresas ficticias con 120 días de datos generados **en memoria**. Siempre muestra «Datos de demostración», no guarda nada, no se conecta a Google ni Meta y su selector de rol es solo visual. Se desactiva por defecto en producción (`DEMO_MODE_ENABLED`).

## Arranque con autenticación y base de datos reales

1. Crea un proyecto en Supabase y aplica las migraciones (`supabase/migrations`) — ver [docs/guia-supabase.md](docs/guia-supabase.md).
2. Copia `.env.example` a `.env.local` y completa las variables (sin pegarlas en chats ni repositorios).
3. Genera la clave de cifrado: `npm run keys:generate -- v1` y guárdala en `TOKEN_ENCRYPTION_KEYS`.
4. Crea el primer administrador de plataforma: `npm run admin:create-platform-admin -- --email tu@correo` ([guía](docs/primer-administrador.md)).
5. `npm run dev` (app) y en otra terminal `npm run worker` (sincronización).
6. Entra en `/login`, crea una empresa en **Administración de plataforma → Empresas** e invita a su administrador.
7. Configura Google y Meta ([guía Google](docs/guia-google.md), [guía Meta](docs/guia-meta.md)) y conéctalos desde **Integraciones**.

Comprueba la configuración en `GET /api/health` (no expone secretos).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` / `build` / `start` | Aplicación Next.js |
| `npm run worker` | Trabajador de sincronización (proceso de larga duración) |
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | ESLint (incluye regla que impide usar acceso privilegiado a BD desde la interfaz) |
| `npm test` | Pruebas unitarias |
| `npm run db:local:start` | Inicia PostgreSQL local para pruebas (puerto 54329) |
| `npm run test:db` | Pruebas de integración contra PostgreSQL real (RLS, sincronización, OAuth) |
| `npm run test:e2e` | Playwright (requiere `npm run build` y Postgres de pruebas) |
| `npm run keys:generate` / `keys:rotate` | Claves de cifrado de credenciales |
| `npm run admin:create-platform-admin` | Alta controlada de platform admin |

## Estructura

```
supabase/migrations/     Esquema, RLS, funciones de autorización y del trabajador
src/config/              Marca y variables de entorno (validadas con Zod)
src/lib/auth/            Supabase Auth (getClaims), sesión, invitaciones
src/lib/authz/           Matriz de permisos y verificación en servidor
src/lib/db/              withUserDb (rol authenticated + RLS) y acceso privilegiado acotado
src/lib/orgs/            Contexto de empresa y consultas de gestión
src/lib/integrations/    Contrato de conectores, registro, HTTP restringido, OAuth, cifrado, GA4, Meta
src/lib/sync/            Motor de sincronización, escritura idempotente, reintentos
src/lib/metrics/         Valores con estado (dato/ausente/pendiente/no disponible), periodos, definiciones
src/lib/reports/         Repositorios (real y demo), construcción de reportes, filtros, CSV
src/lib/demo/            Datos ficticios en memoria
src/worker/              Proceso del trabajador
src/app/                 Rutas (app, demo, admin, auth, API)
tests/                   unit, db (Postgres real), e2e (Playwright)
docs/                    Guías
```
