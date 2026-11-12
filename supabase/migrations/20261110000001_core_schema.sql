-- =============================================================================
-- Nexo Analytics — esquema principal
-- -----------------------------------------------------------------------------
-- Decisiones:
--  * Las tablas viven en el esquema `nexo`, que NO debe añadirse a los
--    "Exposed schemas" de la API de Supabase (PostgREST). La aplicación accede
--    desde el servidor con el rol `authenticated` + claims verificados, por lo
--    que RLS se aplica igual que en PostgREST, pero el navegador no tiene una
--    vía directa a estas tablas.
--  * Las credenciales cifradas y los estados OAuth viven en `nexo_private`,
--    sin ningún privilegio para `anon` ni `authenticated`.
--  * Todo registro de empresa lleva `organization_id`. Las relaciones entre
--    tablas de empresa usan claves foráneas compuestas (id, organization_id)
--    para impedir relaciones entre empresas distintas.
-- =============================================================================

create schema if not exists nexo;
create schema if not exists nexo_private;

-- Ninguna función nueva en estos esquemas es ejecutable por PUBLIC por defecto.
alter default privileges in schema nexo revoke execute on functions from public;
alter default privileges in schema nexo_private revoke execute on functions from public;

revoke all on schema nexo_private from public;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type nexo.org_role as enum ('org_admin', 'analyst', 'viewer');
create type nexo.org_status as enum ('active', 'suspended');
create type nexo.integration_status as enum ('connected', 'needs_reauth', 'error', 'disconnected');
create type nexo.sync_status as enum ('pending', 'running', 'completed', 'partially_completed', 'failed', 'cancelled');
create type nexo.sync_kind as enum ('initial', 'scheduled', 'manual');

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create or replace function nexo.tg_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Impide mover registros entre empresas (apropiación por cambio de organization_id).
create or replace function nexo.tg_prevent_org_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id es inmutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Perfiles (sin contraseñas: la autenticación es de Supabase Auth)
-- -----------------------------------------------------------------------------
create table nexo.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on nexo.profiles (lower(email));
create trigger profiles_updated_at before update on nexo.profiles
  for each row execute function nexo.tg_set_updated_at();

-- Se crea/actualiza desde auth.users. Los metadatos de registro NUNCA otorgan roles.
create or replace function nexo.tg_sync_profile_from_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into nexo.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger nexo_on_auth_user_change
  after insert or update of email on auth.users
  for each row execute function nexo.tg_sync_profile_from_auth();

-- -----------------------------------------------------------------------------
-- Administradores de plataforma (solo asignables por procedimiento privilegiado)
-- -----------------------------------------------------------------------------
create table nexo.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null,
  note text
);

-- -----------------------------------------------------------------------------
-- Empresas
-- -----------------------------------------------------------------------------
create table nexo.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  status nexo.org_status not null default 'active',
  suspended_at timestamptz,
  suspended_reason text,
  logo_url text check (logo_url is null or (logo_url ~ '^https://' and char_length(logo_url) <= 500)),
  -- Moneda de presentación preferida. NO convierte montos: sin tipo de cambio
  -- implementado, los importes se muestran separados por moneda de origen.
  display_currency char(3) check (display_currency is null or display_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'America/Mexico_City',
  sync_frequency_hours integer not null default 24 check (sync_frequency_hours between 6 and 168),
  initial_import_days integer not null default 90 check (initial_import_days between 7 and 400),
  attribution_refresh_days integer not null default 7 check (attribution_refresh_days between 1 and 28),
  -- Definición explícita de "prospecto" y "compra" por fuente. Nulo = no definido.
  ga4_lead_event_name text check (ga4_lead_event_name is null or ga4_lead_event_name ~ '^[A-Za-z0-9_]{1,40}$'),
  meta_lead_action_type text check (meta_lead_action_type is null or meta_lead_action_type ~ '^[a-z0-9_.]{1,80}$'),
  meta_purchase_action_type text check (meta_purchase_action_type is null or meta_purchase_action_type ~ '^[a-z0-9_.]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on nexo.organizations
  for each row execute function nexo.tg_set_updated_at();

create or replace function nexo.tg_validate_org_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria inválida: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
create trigger organizations_validate_tz before insert or update of timezone on nexo.organizations
  for each row execute function nexo.tg_validate_org_timezone();

-- -----------------------------------------------------------------------------
-- Membresías
-- -----------------------------------------------------------------------------
create table nexo.organization_members (
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role nexo.org_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on nexo.organization_members (user_id);
create trigger organization_members_updated_at before update on nexo.organization_members
  for each row execute function nexo.tg_set_updated_at();
create trigger organization_members_org_immutable before update on nexo.organization_members
  for each row execute function nexo.tg_prevent_org_change();

-- Protección contra eliminar o degradar al último administrador de una empresa.
create or replace function nexo.tg_guard_last_org_admin() returns trigger
language plpgsql set search_path = '' as $$
declare
  remaining integer;
begin
  if old.role <> 'org_admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'org_admin' then
    return new;
  end if;
  -- Si la empresa se está eliminando (cascada), no aplica.
  if not exists (select 1 from nexo.organizations where id = old.organization_id) then
    return coalesce(new, old);
  end if;
  select count(*) into remaining
  from nexo.organization_members
  where organization_id = old.organization_id
    and role = 'org_admin'
    and user_id <> old.user_id;
  if remaining = 0 then
    raise exception 'No se puede eliminar ni degradar al último administrador de la empresa'
      using errcode = 'P0001', hint = 'last_org_admin';
  end if;
  return coalesce(new, old);
end $$;
create trigger organization_members_last_admin
  before update of role or delete on nexo.organization_members
  for each row execute function nexo.tg_guard_last_org_admin();

-- -----------------------------------------------------------------------------
-- Invitaciones (vencen, revocables, de un solo uso, ligadas a empresa+correo+rol)
-- -----------------------------------------------------------------------------
create table nexo.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  role nexo.org_role not null,
  -- Solo se guarda el hash SHA-256 (hex) del token; el token en claro viaja en el enlace.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  invited_by uuid references auth.users (id) on delete set null,
  email_delivery text not null default 'pending' check (email_delivery in ('pending', 'sent', 'not_configured', 'failed')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  check (not (accepted_at is not null and revoked_at is not null))
);
create unique index invitations_one_pending_per_email
  on nexo.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_org_idx on nexo.invitations (organization_id, created_at desc);
create trigger invitations_org_immutable before update on nexo.invitations
  for each row execute function nexo.tg_prevent_org_change();

-- -----------------------------------------------------------------------------
-- Integraciones y credenciales
-- -----------------------------------------------------------------------------
create table nexo.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  status nexo.integration_status not null,
  external_user_label text check (external_user_label is null or char_length(external_user_label) <= 200),
  granted_scopes text[] not null default '{}',
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  token_expires_at timestamptz,
  last_validated_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 500),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index integrations_one_active_per_provider
  on nexo.integrations (organization_id, provider) where status <> 'disconnected';
create trigger integrations_updated_at before update on nexo.integrations
  for each row execute function nexo.tg_set_updated_at();
create trigger integrations_org_immutable before update on nexo.integrations
  for each row execute function nexo.tg_prevent_org_change();

-- Credenciales cifradas (AES-256-GCM en la aplicación, clave fuera de la BD).
create table nexo_private.integration_credentials (
  integration_id uuid primary key,
  organization_id uuid not null,
  key_id text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  foreign key (integration_id, organization_id)
    references nexo.integrations (id, organization_id) on delete cascade
);

-- Estados OAuth: impredecibles (solo hash), de un uso, con vencimiento,
-- ligados a usuario + empresa + proveedor.
create table nexo_private.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  pkce_verifier_enc text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index oauth_states_expires_idx on nexo_private.oauth_states (expires_at);

-- -----------------------------------------------------------------------------
-- Cuentas de proveedor (propiedades GA4, cuentas publicitarias de Meta)
-- -----------------------------------------------------------------------------
create table nexo.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  integration_id uuid,
  provider text not null,
  account_type text not null check (account_type in ('ga4_property', 'meta_ad_account')),
  external_id text not null check (char_length(external_id) between 1 and 100),
  name text not null check (char_length(name) <= 300),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  timezone text,
  external_status text,
  is_selected boolean not null default false,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider, external_id),
  foreign key (integration_id, organization_id)
    references nexo.integrations (id, organization_id) on delete set null (integration_id)
);
create index provider_accounts_org_idx on nexo.provider_accounts (organization_id);
create trigger provider_accounts_updated_at before update on nexo.provider_accounts
  for each row execute function nexo.tg_set_updated_at();
create trigger provider_accounts_org_immutable before update on nexo.provider_accounts
  for each row execute function nexo.tg_prevent_org_change();

-- -----------------------------------------------------------------------------
-- Campañas
-- -----------------------------------------------------------------------------
create table nexo.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  provider_account_id uuid not null,
  external_id text not null,
  name text not null,
  status text,
  objective text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_account_id, external_id),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);
create index campaigns_org_idx on nexo.campaigns (organization_id);
create trigger campaigns_updated_at before update on nexo.campaigns
  for each row execute function nexo.tg_set_updated_at();
create trigger campaigns_org_immutable before update on nexo.campaigns
  for each row execute function nexo.tg_prevent_org_change();

-- -----------------------------------------------------------------------------
-- Métricas publicitarias diarias (granularidad: campaña × día, zona horaria de la cuenta)
-- Las métricas nulas significan "el proveedor no entregó el dato", no cero.
-- -----------------------------------------------------------------------------
create table nexo.ad_campaign_daily (
  organization_id uuid not null,
  provider_account_id uuid not null,
  campaign_external_id text not null,
  date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric(18, 4) check (spend is null or spend >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  link_clicks bigint check (link_clicks is null or link_clicks >= 0),
  reach bigint check (reach is null or reach >= 0), -- no aditivo: válido solo para su campaña y día
  attribution_setting text,
  synced_at timestamptz not null default now(),
  sync_job_id uuid,
  primary key (organization_id, provider_account_id, campaign_external_id, date),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);
create index ad_campaign_daily_range_idx on nexo.ad_campaign_daily (organization_id, date);

create table nexo.ad_campaign_daily_actions (
  organization_id uuid not null,
  provider_account_id uuid not null,
  campaign_external_id text not null,
  date date not null,
  action_type text not null,
  value numeric(20, 4),
  action_value numeric(18, 4),
  attribution_setting text,
  synced_at timestamptz not null default now(),
  sync_job_id uuid,
  primary key (organization_id, provider_account_id, campaign_external_id, date, action_type),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);
create index ad_campaign_daily_actions_range_idx on nexo.ad_campaign_daily_actions (organization_id, date);

-- -----------------------------------------------------------------------------
-- Analítica web diaria (GA4). Cada "breakdown" es un conjunto de reportes
-- compatible consultado por separado. total_users solo es válido por fila/día.
-- -----------------------------------------------------------------------------
create table nexo.web_daily (
  organization_id uuid not null,
  provider_account_id uuid not null,
  date date not null,
  breakdown text not null check (breakdown in ('total', 'source_medium', 'campaign', 'landing_page', 'device')),
  dimension_value text not null default '',
  sessions bigint,
  engaged_sessions bigint,
  total_users bigint,
  new_users bigint,
  screen_page_views bigint,
  key_events numeric(20, 4),
  synced_at timestamptz not null default now(),
  sync_job_id uuid,
  primary key (organization_id, provider_account_id, breakdown, date, dimension_value),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);
create index web_daily_range_idx on nexo.web_daily (organization_id, breakdown, date);

create table nexo.web_daily_key_events (
  organization_id uuid not null,
  provider_account_id uuid not null,
  date date not null,
  event_name text not null,
  key_events numeric(20, 4),
  synced_at timestamptz not null default now(),
  sync_job_id uuid,
  primary key (organization_id, provider_account_id, date, event_name),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);

-- Agregados no aditivos calculados por el proveedor para un periodo exacto
-- (usuarios de GA4, alcance de Meta). Nunca se suman entre días.
create table nexo.metric_snapshots (
  organization_id uuid not null,
  provider_account_id uuid not null,
  metric text not null check (metric in ('total_users', 'active_users', 'reach')),
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  value numeric(20, 4),
  computed_at timestamptz not null default now(),
  sync_job_id uuid,
  primary key (organization_id, provider_account_id, metric, date_from, date_to),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);

-- Cobertura: qué días de qué conjunto de datos se consultaron con éxito.
-- Permite distinguir "cero real" (día cubierto sin filas) de "dato ausente".
create table nexo.data_coverage (
  organization_id uuid not null,
  provider_account_id uuid not null,
  dataset text not null,
  date date not null,
  synced_at timestamptz not null default now(),
  sync_job_id uuid,
  quality_flags jsonb not null default '{}'::jsonb,
  primary key (organization_id, provider_account_id, dataset, date),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Sincronización
-- -----------------------------------------------------------------------------
create table nexo.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  provider_account_id uuid not null,
  kind nexo.sync_kind not null,
  status nexo.sync_status not null default 'pending',
  requested_by uuid references auth.users (id) on delete set null,
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  checkpoint jsonb not null default '{}'::jsonb,
  rows_written integer not null default 0,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (provider_account_id, organization_id)
    references nexo.provider_accounts (id, organization_id) on delete cascade
);
-- Un único trabajo activo por cuenta: evita ejecuciones duplicadas.
create unique index sync_jobs_one_active_per_account
  on nexo.sync_jobs (provider_account_id) where status in ('pending', 'running');
create index sync_jobs_claim_idx on nexo.sync_jobs (status, run_after);
create index sync_jobs_org_idx on nexo.sync_jobs (organization_id, created_at desc);
create trigger sync_jobs_updated_at before update on nexo.sync_jobs
  for each row execute function nexo.tg_set_updated_at();
create trigger sync_jobs_org_immutable before update on nexo.sync_jobs
  for each row execute function nexo.tg_prevent_org_change();

create table nexo.sync_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references nexo.sync_jobs (id) on delete cascade,
  organization_id uuid not null,
  attempt integer not null,
  worker_id text not null,
  status nexo.sync_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  stats jsonb not null default '{}'::jsonb
);
create index sync_runs_job_idx on nexo.sync_runs (job_id, started_at desc);
create index sync_runs_org_idx on nexo.sync_runs (organization_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Auditoría (sin FK a organizations para conservar el historial)
-- -----------------------------------------------------------------------------
create table nexo.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'platform_admin', 'system')),
  action text not null check (action ~ '^[a-z_.]{3,80}$'),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on nexo.audit_logs (organization_id, created_at desc);
create index audit_logs_created_idx on nexo.audit_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- Acceso de soporte explícito, temporal y auditado (sin suplantación)
-- -----------------------------------------------------------------------------
create table nexo.support_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nexo.organizations (id) on delete cascade,
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index support_sessions_lookup on nexo.support_sessions (organization_id, admin_user_id, expires_at);

-- -----------------------------------------------------------------------------
-- Matriz de permisos (la misma matriz existe en src/lib/authz/permissions.ts;
-- una prueba verifica que coincidan).
-- -----------------------------------------------------------------------------
create table nexo.role_permissions (
  role text not null check (role in ('org_admin', 'analyst', 'viewer', 'support')),
  permission text not null,
  primary key (role, permission)
);

insert into nexo.role_permissions (role, permission) values
  ('org_admin', 'org.view'), ('org_admin', 'reports.view'), ('org_admin', 'reports.export'),
  ('org_admin', 'members.view'), ('org_admin', 'members.manage'),
  ('org_admin', 'integrations.view'), ('org_admin', 'integrations.manage'),
  ('org_admin', 'sync.trigger'), ('org_admin', 'settings.manage'), ('org_admin', 'audit.view'),
  ('analyst', 'org.view'), ('analyst', 'reports.view'), ('analyst', 'reports.export'),
  ('analyst', 'members.view'), ('analyst', 'integrations.view'),
  ('viewer', 'org.view'), ('viewer', 'reports.view'),
  ('support', 'org.view'), ('support', 'reports.view'), ('support', 'integrations.view');
