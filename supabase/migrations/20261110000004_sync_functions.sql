-- =============================================================================
-- Nexo Analytics — funciones del trabajador de sincronización
-- Solo ejecutables por la conexión privilegiada del servidor (propietario).
-- NO se conceden a `authenticated`.
-- =============================================================================

-- Toma el siguiente trabajo disponible con un lease. FOR UPDATE SKIP LOCKED
-- garantiza que dos trabajadores no tomen el mismo trabajo.
create or replace function nexo.claim_next_sync_job(p_worker text, p_lease_seconds integer default 300)
returns setof nexo.sync_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select j.id into v_id
  from nexo.sync_jobs j
  join nexo.organizations o on o.id = j.organization_id and o.status = 'active'
  join nexo.provider_accounts pa on pa.id = j.provider_account_id and pa.is_selected
  join nexo.integrations i on i.id = pa.integration_id and i.status = 'connected'
  where j.status = 'pending' and j.run_after <= now()
  order by j.run_after, j.created_at
  for update of j skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update nexo.sync_jobs set
    status = 'running',
    attempts = attempts + 1,
    lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(started_at, now()),
    error_code = null,
    error_message = null
  where id = v_id
  returning *;
end $$;

-- Renueva el lease solo si el trabajo sigue siendo de este trabajador.
create or replace function nexo.heartbeat_sync_job(p_job uuid, p_worker text, p_lease_seconds integer default 300)
returns boolean
language sql security definer set search_path = '' as $$
  update nexo.sync_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_job and status = 'running' and lease_owner = p_worker
  returning true;
$$;

-- Recupera trabajos interrumpidos (lease vencido): vuelven a 'pending' con su
-- checkpoint, o pasan a 'failed' si agotaron los intentos.
create or replace function nexo.recover_stale_sync_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update nexo.sync_runs r set status = 'failed', finished_at = now(), error_code = 'interrupted',
         error_message = 'El trabajador dejó de renovar el lease'
   from nexo.sync_jobs j
   where r.job_id = j.id and r.finished_at is null
     and j.status = 'running' and j.lease_expires_at < now();

  with stale as (
    update nexo.sync_jobs set
      status = case when attempts >= max_attempts then 'failed'::nexo.sync_status else 'pending'::nexo.sync_status end,
      finished_at = case when attempts >= max_attempts then now() else null end,
      run_after = now(),
      lease_owner = null,
      lease_expires_at = null,
      error_code = 'interrupted',
      error_message = 'Trabajo interrumpido; se reanuda desde el último checkpoint'
    where status = 'running' and lease_expires_at < now()
    returning 1
  )
  select count(*) into v_count from stale;
  return v_count;
end $$;

-- Programa la actualización periódica: ventana reciente configurable para
-- recoger cambios de atribución. Idempotente: respeta el índice único de
-- un trabajo activo por cuenta.
create or replace function nexo.enqueue_scheduled_sync_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with candidates as (
    select pa.id as account_id, pa.organization_id, o.attribution_refresh_days, o.initial_import_days,
           pa.last_successful_sync_at
    from nexo.provider_accounts pa
    join nexo.organizations o on o.id = pa.organization_id and o.status = 'active'
    join nexo.integrations i on i.id = pa.integration_id and i.status = 'connected'
    where pa.is_selected
      and not exists (
        select 1 from nexo.sync_jobs j
        where j.provider_account_id = pa.id
          and (j.status in ('pending', 'running')
               or (j.created_at > now() - make_interval(hours => o.sync_frequency_hours)
                   and j.status in ('completed', 'partially_completed', 'pending', 'running'))
               or (j.kind = 'scheduled' and j.status = 'failed' and j.created_at > now() - interval '1 hour'))
      )
  ), ins as (
    insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to)
    select c.organization_id, c.account_id,
           case when c.last_successful_sync_at is null then 'initial'::nexo.sync_kind else 'scheduled'::nexo.sync_kind end,
           nexo.account_today(c.account_id) - case when c.last_successful_sync_at is null
                                                   then c.initial_import_days else c.attribution_refresh_days end,
           nexo.account_today(c.account_id)
    from candidates c
    on conflict (provider_account_id) where status in ('pending', 'running') do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- Limpieza y retención operativa.
create or replace function nexo.purge_operational_data(p_sync_run_days integer default 90) returns void
language sql security definer set search_path = '' as $$
  delete from nexo_private.oauth_states where expires_at < now() - interval '1 day';
  delete from nexo.sync_runs where started_at < now() - make_interval(days => p_sync_run_days);
  delete from nexo.sync_jobs where finished_at < now() - make_interval(days => p_sync_run_days)
    and status in ('completed', 'cancelled');
$$;
