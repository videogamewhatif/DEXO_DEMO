-- =============================================================================
-- Nexo Analytics — operaciones de usuario (SECURITY DEFINER con verificación)
-- -----------------------------------------------------------------------------
-- Cada función:
--   1. Obtiene el usuario de la sesión verificada (auth.uid()). Nunca recibe
--      el id del usuario actuante como parámetro.
--   2. Verifica permiso con la matriz de roles y el estado de la empresa.
--   3. Registra auditoría.
-- Los errores usan mensajes-código estables que la aplicación traduce.
-- =============================================================================

create or replace function nexo.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function nexo.require_permission(p_org uuid, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not nexo.has_org_permission(p_org, p_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- Interna: sin GRANT a authenticated.
create or replace function nexo.write_audit(
  p_org uuid, p_actor uuid, p_actor_type text, p_action text,
  p_target_type text, p_target_id text, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into nexo.audit_logs (organization_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
  values (p_org, p_actor, p_actor_type, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Tipo de actor: platform_admin solo si actúa sin ser miembro con el permiso.
create or replace function nexo.actor_type_for(p_org uuid, p_permission text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when nexo.has_org_permission(p_org, p_permission) then 'user'
    when nexo.is_platform_admin() then 'platform_admin'
    else null
  end;
$$;

-- -----------------------------------------------------------------------------
-- Empresas del usuario (incluye suspendidas para poder informar su estado)
-- -----------------------------------------------------------------------------
create or replace function nexo.my_organizations()
returns table (id uuid, name text, slug text, status nexo.org_status, role text, logo_url text, access text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, o.status, m.role::text, o.logo_url, 'member'
  from nexo.organization_members m
  join nexo.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
  union all
  select o.id, o.name, o.slug, o.status, 'support', o.logo_url, 'support'
  from nexo.support_sessions s
  join nexo.organizations o on o.id = s.organization_id
  join nexo.platform_admins pa on pa.user_id = s.admin_user_id
  where s.admin_user_id = (select auth.uid())
    and s.ended_at is null and s.expires_at > now()
    and not exists (
      select 1 from nexo.organization_members m2
      where m2.organization_id = o.id and m2.user_id = (select auth.uid())
    )
  order by 2;
$$;

-- -----------------------------------------------------------------------------
-- Invitaciones
-- -----------------------------------------------------------------------------
create or replace function nexo.create_invitation(
  p_org uuid, p_email text, p_role nexo.org_role, p_token_hash text, p_ttl_hours integer default 168
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_actor text := nexo.actor_type_for(p_org, 'members.manage');
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from nexo.organizations where id = p_org and status = 'active') then
    raise exception 'organization_not_active' using errcode = 'P0001';
  end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 336 then
    raise exception 'invalid_ttl' using errcode = '22023';
  end if;
  if exists (
    select 1 from nexo.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- Una invitación nueva sustituye cualquier invitación pendiente (vencida o no).
  update nexo.invitations
     set revoked_at = now(), revoked_by = v_user
   where organization_id = p_org and email = v_email
     and accepted_at is null and revoked_at is null;

  insert into nexo.invitations (organization_id, email, role, token_hash, expires_at, invited_by)
  values (p_org, v_email, p_role, p_token_hash, now() + make_interval(hours => p_ttl_hours), v_user)
  returning id into v_id;

  perform nexo.write_audit(p_org, v_user, v_actor, 'invitation.created', 'invitation', v_id::text,
    jsonb_build_object('email', v_email, 'role', p_role, 'ttl_hours', p_ttl_hours));
  return v_id;
end $$;

create or replace function nexo.set_invitation_delivery(p_invitation uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_org uuid;
begin
  select organization_id into v_org from nexo.invitations where id = p_invitation;
  if v_org is null or nexo.actor_type_for(v_org, 'members.manage') is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'not_configured', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update nexo.invitations set email_delivery = p_status
   where id = p_invitation and email_delivery = 'pending';
end $$;

create or replace function nexo.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_org uuid;
  v_actor text;
begin
  select organization_id into v_org from nexo.invitations where id = p_invitation;
  v_actor := case when v_org is null then null else nexo.actor_type_for(v_org, 'members.manage') end;
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update nexo.invitations set revoked_at = now(), revoked_by = v_user
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;
  perform nexo.write_audit(v_org, v_user, v_actor, 'invitation.revoked', 'invitation', p_invitation::text, '{}');
end $$;

-- Aceptación: un solo uso, vigente, no revocada y para el MISMO correo de la sesión.
create or replace function nexo.accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_email text;
  v_inv nexo.invitations%rowtype;
begin
  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv from nexo.invitations where token_hash = p_token_hash for update;
  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  elsif v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = 'P0001';
  elsif v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = 'P0001';
  elsif v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = 'P0001';
  elsif v_email is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if not exists (select 1 from nexo.organizations where id = v_inv.organization_id and status = 'active') then
    raise exception 'organization_not_active' using errcode = 'P0001';
  end if;

  insert into nexo.organization_members (organization_id, user_id, role, invited_by)
  values (v_inv.organization_id, v_user, v_inv.role, v_inv.invited_by)
  on conflict (organization_id, user_id) do nothing;

  update nexo.invitations set accepted_at = now(), accepted_by = v_user where id = v_inv.id;

  perform nexo.write_audit(v_inv.organization_id, v_user, 'user', 'invitation.accepted', 'invitation',
    v_inv.id::text, jsonb_build_object('role', v_inv.role));
  return v_inv.organization_id;
end $$;

-- -----------------------------------------------------------------------------
-- Miembros
-- -----------------------------------------------------------------------------
create or replace function nexo.update_member_role(p_org uuid, p_user uuid, p_role nexo.org_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := nexo.require_user();
  v_actor text := nexo.actor_type_for(p_org, 'members.manage');
  v_old nexo.org_role;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select role into v_old from nexo.organization_members where organization_id = p_org and user_id = p_user;
  if v_old is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  update nexo.organization_members set role = p_role where organization_id = p_org and user_id = p_user;
  perform nexo.write_audit(p_org, v_actor_id, v_actor, 'member.role_changed', 'user', p_user::text,
    jsonb_build_object('from', v_old, 'to', p_role));
end $$;

create or replace function nexo.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := nexo.require_user();
  v_actor text := nexo.actor_type_for(p_org, 'members.manage');
begin
  -- Un miembro puede retirarse a sí mismo (salvo que sea el último administrador).
  if v_actor is null and p_user = v_actor_id
     and exists (select 1 from nexo.organization_members where organization_id = p_org and user_id = v_actor_id) then
    v_actor := 'user';
  end if;
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from nexo.organization_members where organization_id = p_org and user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  perform nexo.write_audit(p_org, v_actor_id, v_actor, 'member.removed', 'user', p_user::text, '{}');
end $$;

-- -----------------------------------------------------------------------------
-- Preferencias de empresa (no alteran moneda ni zona horaria de las fuentes)
-- -----------------------------------------------------------------------------
create or replace function nexo.update_organization_settings(
  p_org uuid,
  p_name text,
  p_logo_url text,
  p_display_currency text,
  p_timezone text,
  p_ga4_lead_event_name text,
  p_meta_lead_action_type text,
  p_meta_purchase_action_type text,
  p_sync_frequency_hours integer,
  p_attribution_refresh_days integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_actor text := nexo.actor_type_for(p_org, 'settings.manage');
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update nexo.organizations set
    name = btrim(p_name),
    logo_url = nullif(btrim(coalesce(p_logo_url, '')), ''),
    display_currency = nullif(upper(btrim(coalesce(p_display_currency, ''))), ''),
    timezone = p_timezone,
    ga4_lead_event_name = nullif(btrim(coalesce(p_ga4_lead_event_name, '')), ''),
    meta_lead_action_type = nullif(btrim(coalesce(p_meta_lead_action_type, '')), ''),
    meta_purchase_action_type = nullif(btrim(coalesce(p_meta_purchase_action_type, '')), ''),
    sync_frequency_hours = p_sync_frequency_hours,
    attribution_refresh_days = p_attribution_refresh_days
  where id = p_org;
  perform nexo.write_audit(p_org, v_user, v_actor, 'organization.settings_updated', 'organization', p_org::text,
    jsonb_build_object('name', p_name, 'timezone', p_timezone, 'display_currency', p_display_currency,
      'sync_frequency_hours', p_sync_frequency_hours, 'attribution_refresh_days', p_attribution_refresh_days));
end $$;

-- -----------------------------------------------------------------------------
-- Cuentas y sincronización solicitadas por usuarios
-- -----------------------------------------------------------------------------
create or replace function nexo.account_today(p_account uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(
    (select pa.timezone from nexo.provider_accounts pa
      where pa.id = p_account
        and exists (select 1 from pg_catalog.pg_timezone_names t where t.name = pa.timezone)),
    (select o.timezone from nexo.provider_accounts pa join nexo.organizations o on o.id = pa.organization_id where pa.id = p_account),
    'UTC'))::date;
$$;

create or replace function nexo.set_account_selection(p_account uuid, p_selected boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_acc nexo.provider_accounts%rowtype;
  v_org nexo.organizations%rowtype;
  v_job uuid;
  v_today date;
begin
  select * into v_acc from nexo.provider_accounts where id = p_account;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform nexo.require_permission(v_acc.organization_id, 'integrations.manage');
  select * into v_org from nexo.organizations where id = v_acc.organization_id;

  if p_selected and not exists (
    select 1 from nexo.integrations i where i.id = v_acc.integration_id and i.status = 'connected'
  ) then
    raise exception 'integration_not_connected' using errcode = 'P0001';
  end if;

  update nexo.provider_accounts set is_selected = p_selected where id = p_account;

  if p_selected then
    v_today := nexo.account_today(p_account);
    insert into nexo.sync_jobs (organization_id, provider_account_id, kind, requested_by, date_from, date_to)
    select v_acc.organization_id, p_account,
           case when v_acc.last_successful_sync_at is null then 'initial'::nexo.sync_kind else 'manual'::nexo.sync_kind end,
           v_user,
           case when v_acc.last_successful_sync_at is null then v_today - v_org.initial_import_days
                else v_today - v_org.attribution_refresh_days end,
           v_today
    where not exists (
      select 1 from nexo.sync_jobs j where j.provider_account_id = p_account and j.status in ('pending', 'running')
    )
    returning id into v_job;
  else
    update nexo.sync_jobs set status = 'cancelled', finished_at = now(), error_code = 'account_deselected'
     where provider_account_id = p_account and status = 'pending';
  end if;

  perform nexo.write_audit(v_acc.organization_id, v_user, 'user',
    case when p_selected then 'account.selected' else 'account.deselected' end,
    'provider_account', p_account::text, jsonb_build_object('external_id', v_acc.external_id, 'provider', v_acc.provider));
  return v_job;
end $$;

-- Actualización manual con límite de frecuencia (15 minutos por cuenta).
create or replace function nexo.request_manual_sync(p_account uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_acc nexo.provider_accounts%rowtype;
  v_org nexo.organizations%rowtype;
  v_job uuid;
  v_today date;
begin
  select * into v_acc from nexo.provider_accounts where id = p_account;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform nexo.require_permission(v_acc.organization_id, 'sync.trigger');
  select * into v_org from nexo.organizations where id = v_acc.organization_id;

  if not v_acc.is_selected then
    raise exception 'account_not_selected' using errcode = 'P0001';
  end if;
  if not exists (select 1 from nexo.integrations i where i.id = v_acc.integration_id and i.status = 'connected') then
    raise exception 'integration_not_connected' using errcode = 'P0001';
  end if;
  if exists (select 1 from nexo.sync_jobs j where j.provider_account_id = p_account and j.status in ('pending', 'running')) then
    raise exception 'sync_already_active' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from nexo.sync_jobs j
    where j.provider_account_id = p_account and j.kind = 'manual' and j.created_at > now() - interval '15 minutes'
  ) then
    raise exception 'sync_rate_limited' using errcode = 'P0001';
  end if;

  v_today := nexo.account_today(p_account);
  insert into nexo.sync_jobs (organization_id, provider_account_id, kind, requested_by, date_from, date_to)
  values (v_acc.organization_id, p_account, 'manual', v_user,
          case when v_acc.last_successful_sync_at is null then v_today - v_org.initial_import_days
               else v_today - v_org.attribution_refresh_days end,
          v_today)
  returning id into v_job;

  perform nexo.write_audit(v_acc.organization_id, v_user, 'user', 'sync.requested', 'sync_job', v_job::text,
    jsonb_build_object('provider_account_id', p_account));
  return v_job;
end $$;

create or replace function nexo.cancel_sync_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_org uuid;
  v_actor text;
begin
  select organization_id into v_org from nexo.sync_jobs where id = p_job;
  v_actor := case when v_org is null then null else nexo.actor_type_for(v_org, 'sync.trigger') end;
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update nexo.sync_jobs set status = 'cancelled', finished_at = now(), error_code = 'cancelled_by_user'
   where id = p_job and status = 'pending';
  if not found then
    raise exception 'job_not_pending' using errcode = 'P0001';
  end if;
  perform nexo.write_audit(v_org, v_user, v_actor, 'sync.cancelled', 'sync_job', p_job::text, '{}');
end $$;

-- Evento de aplicación auditado por el propio usuario (p. ej. exportaciones).
create or replace function nexo.log_user_event(p_org uuid, p_action text, p_metadata jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
begin
  if p_action not in ('report.exported') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if nexo.current_org_role(p_org) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform nexo.write_audit(p_org, v_user,
    case when nexo.current_org_role(p_org) = 'support' then 'platform_admin' else 'user' end,
    p_action, 'organization', p_org::text, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- Operaciones de platform admin
-- -----------------------------------------------------------------------------
create or replace function nexo.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := nexo.require_user();
begin
  if not nexo.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function nexo.platform_create_organization(
  p_name text, p_slug text, p_timezone text, p_display_currency text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_platform_admin();
  v_id uuid;
begin
  insert into nexo.organizations (name, slug, timezone, display_currency)
  values (btrim(p_name), lower(btrim(p_slug)), coalesce(p_timezone, 'America/Mexico_City'),
          nullif(upper(btrim(coalesce(p_display_currency, ''))), ''))
  returning id into v_id;
  perform nexo.write_audit(v_id, v_user, 'platform_admin', 'organization.created', 'organization', v_id::text,
    jsonb_build_object('name', p_name, 'slug', p_slug));
  return v_id;
end $$;

create or replace function nexo.platform_set_organization_status(p_org uuid, p_status nexo.org_status, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_platform_admin();
begin
  if p_status = 'suspended' and (p_reason is null or char_length(btrim(p_reason)) < 5) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update nexo.organizations set
    status = p_status,
    suspended_at = case when p_status = 'suspended' then now() else null end,
    suspended_reason = case when p_status = 'suspended' then btrim(p_reason) else null end
  where id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;
  if p_status = 'suspended' then
    -- Se detienen nuevas sincronizaciones; el histórico se conserva.
    update nexo.sync_jobs set status = 'cancelled', finished_at = now(), error_code = 'organization_suspended'
     where organization_id = p_org and status = 'pending';
    update nexo.support_sessions set ended_at = now() where organization_id = p_org and ended_at is null;
  end if;
  perform nexo.write_audit(p_org, v_user, 'platform_admin',
    case when p_status = 'suspended' then 'organization.suspended' else 'organization.reactivated' end,
    'organization', p_org::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function nexo.platform_retry_job(p_job uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_platform_admin();
  v_job nexo.sync_jobs%rowtype;
  v_new uuid;
begin
  select * into v_job from nexo.sync_jobs where id = p_job;
  if not found or v_job.status not in ('failed', 'partially_completed', 'cancelled') then
    raise exception 'job_not_retryable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from nexo.organizations where id = v_job.organization_id and status = 'active') then
    raise exception 'organization_not_active' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from nexo.provider_accounts pa join nexo.integrations i on i.id = pa.integration_id
    where pa.id = v_job.provider_account_id and pa.is_selected and i.status = 'connected'
  ) then
    raise exception 'integration_not_connected' using errcode = 'P0001';
  end if;
  insert into nexo.sync_jobs (organization_id, provider_account_id, kind, requested_by, date_from, date_to)
  values (v_job.organization_id, v_job.provider_account_id, 'manual', v_user, v_job.date_from, v_job.date_to)
  returning id into v_new;
  perform nexo.write_audit(v_job.organization_id, v_user, 'platform_admin', 'sync.retried', 'sync_job', v_new::text,
    jsonb_build_object('previous_job_id', p_job));
  return v_new;
exception when unique_violation then
  raise exception 'sync_already_active' using errcode = 'P0001';
end $$;

create or replace function nexo.start_support_session(p_org uuid, p_reason text, p_minutes integer default 60)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_platform_admin();
  v_id uuid;
begin
  if p_minutes < 5 or p_minutes > 240 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if not exists (select 1 from nexo.organizations where id = p_org and status = 'active') then
    raise exception 'organization_not_active' using errcode = 'P0001';
  end if;
  update nexo.support_sessions set ended_at = now()
   where organization_id = p_org and admin_user_id = v_user and ended_at is null;
  insert into nexo.support_sessions (organization_id, admin_user_id, reason, expires_at)
  values (p_org, v_user, btrim(p_reason), now() + make_interval(mins => p_minutes))
  returning id into v_id;
  perform nexo.write_audit(p_org, v_user, 'platform_admin', 'support.session_started', 'support_session', v_id::text,
    jsonb_build_object('reason', p_reason, 'minutes', p_minutes));
  return v_id;
end $$;

create or replace function nexo.end_support_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nexo.require_user();
  v_org uuid;
begin
  update nexo.support_sessions set ended_at = now()
   where id = p_session and admin_user_id = v_user and ended_at is null
  returning organization_id into v_org;
  if v_org is not null then
    perform nexo.write_audit(v_org, v_user, 'platform_admin', 'support.session_ended', 'support_session', p_session::text, '{}');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Permisos de ejecución
-- -----------------------------------------------------------------------------
grant execute on function
  nexo.my_organizations(),
  nexo.create_invitation(uuid, text, nexo.org_role, text, integer),
  nexo.set_invitation_delivery(uuid, text),
  nexo.revoke_invitation(uuid),
  nexo.accept_invitation(text),
  nexo.update_member_role(uuid, uuid, nexo.org_role),
  nexo.remove_member(uuid, uuid),
  nexo.update_organization_settings(uuid, text, text, text, text, text, text, text, integer, integer),
  nexo.set_account_selection(uuid, boolean),
  nexo.request_manual_sync(uuid),
  nexo.cancel_sync_job(uuid),
  nexo.log_user_event(uuid, text, jsonb),
  nexo.platform_create_organization(text, text, text, text),
  nexo.platform_set_organization_status(uuid, nexo.org_status, text),
  nexo.platform_retry_job(uuid),
  nexo.start_support_session(uuid, text, integer),
  nexo.end_support_session(uuid)
to authenticated;
