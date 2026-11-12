-- =============================================================================
-- Nexo Analytics — autorización: funciones auxiliares, privilegios y RLS
-- -----------------------------------------------------------------------------
-- Modelo:
--  * `authenticated` solo tiene SELECT sobre tablas de empresa, filtrado por RLS.
--  * No existe INSERT/UPDATE/DELETE directo para `authenticated`: todas las
--    escrituras de usuarios pasan por funciones SECURITY DEFINER que verifican
--    sesión, membresía, rol y estado de la empresa (ver migración 3).
--  * Las escrituras de datos de proveedores las hace exclusivamente el
--    trabajador de sincronización con la conexión privilegiada.
--  * RLS está habilitado en TODAS las tablas como defensa en profundidad: aunque
--    alguien concediera privilegios de escritura por error, no hay políticas de
--    escritura y las operaciones serían rechazadas.
-- =============================================================================

grant usage on schema nexo to authenticated;
revoke all on schema nexo from anon;

-- -----------------------------------------------------------------------------
-- Funciones auxiliares (STABLE, SECURITY DEFINER, search_path vacío)
-- -----------------------------------------------------------------------------
create or replace function nexo.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from nexo.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

-- Rol efectivo del usuario actual en una empresa ACTIVA.
-- Devuelve null si no es miembro, si la empresa está suspendida o no existe.
-- Un platform admin no obtiene acceso a datos de clientes por serlo: necesita
-- una sesión de soporte explícita (rol 'support', solo lectura, auditada).
create or replace function nexo.current_org_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select m.role::text
      from nexo.organization_members m
      join nexo.organizations o on o.id = m.organization_id
      where m.organization_id = p_org
        and m.user_id = (select auth.uid())
        and o.status = 'active'
    ),
    (
      select 'support'
      from nexo.support_sessions s
      join nexo.organizations o on o.id = s.organization_id
      join nexo.platform_admins pa on pa.user_id = s.admin_user_id
      where s.organization_id = p_org
        and s.admin_user_id = (select auth.uid())
        and s.ended_at is null
        and s.expires_at > now()
        and o.status = 'active'
      limit 1
    )
  );
$$;

create or replace function nexo.has_org_permission(p_org uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from nexo.role_permissions rp
    where rp.role = nexo.current_org_role(p_org)
      and rp.permission = p_permission
  );
$$;

-- Conjunto de empresas en las que el usuario actual tiene un permiso.
-- Las políticas usan `organization_id in (select ...)`: la subconsulta no está
-- correlacionada, se evalúa una sola vez por sentencia (initPlan) y escala mejor
-- que evaluar la función por cada fila.
create or replace function nexo.org_ids_with_permission(p_permission text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id
  from nexo.organization_members m
  join nexo.organizations o on o.id = m.organization_id and o.status = 'active'
  join nexo.role_permissions rp on rp.role = m.role::text and rp.permission = p_permission
  where m.user_id = (select auth.uid())
  union
  select s.organization_id
  from nexo.support_sessions s
  join nexo.organizations o on o.id = s.organization_id and o.status = 'active'
  join nexo.platform_admins pa on pa.user_id = s.admin_user_id
  join nexo.role_permissions rp on rp.role = 'support' and rp.permission = p_permission
  where s.admin_user_id = (select auth.uid())
    and s.ended_at is null
    and s.expires_at > now();
$$;

grant execute on function nexo.is_platform_admin() to authenticated;
grant execute on function nexo.org_ids_with_permission(text) to authenticated;
grant execute on function nexo.current_org_role(uuid) to authenticated;
grant execute on function nexo.has_org_permission(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Privilegios de lectura (columnas sensibles excluidas)
-- -----------------------------------------------------------------------------
grant select on nexo.profiles, nexo.platform_admins, nexo.organizations,
  nexo.organization_members, nexo.integrations, nexo.provider_accounts,
  nexo.campaigns, nexo.ad_campaign_daily, nexo.ad_campaign_daily_actions,
  nexo.web_daily, nexo.web_daily_key_events, nexo.metric_snapshots,
  nexo.data_coverage, nexo.sync_jobs, nexo.sync_runs, nexo.audit_logs,
  nexo.support_sessions, nexo.role_permissions
to authenticated;

-- El hash del token de invitación no se expone ni siquiera a administradores.
grant select (id, organization_id, email, role, expires_at, invited_by, email_delivery,
  created_at, accepted_at, accepted_by, revoked_at, revoked_by)
on nexo.invitations to authenticated;

revoke all on all tables in schema nexo_private from public, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table nexo.profiles enable row level security;
alter table nexo.platform_admins enable row level security;
alter table nexo.organizations enable row level security;
alter table nexo.organization_members enable row level security;
alter table nexo.invitations enable row level security;
alter table nexo.integrations enable row level security;
alter table nexo.provider_accounts enable row level security;
alter table nexo.campaigns enable row level security;
alter table nexo.ad_campaign_daily enable row level security;
alter table nexo.ad_campaign_daily_actions enable row level security;
alter table nexo.web_daily enable row level security;
alter table nexo.web_daily_key_events enable row level security;
alter table nexo.metric_snapshots enable row level security;
alter table nexo.data_coverage enable row level security;
alter table nexo.sync_jobs enable row level security;
alter table nexo.sync_runs enable row level security;
alter table nexo.audit_logs enable row level security;
alter table nexo.support_sessions enable row level security;
alter table nexo.role_permissions enable row level security;
alter table nexo_private.integration_credentials enable row level security;
alter table nexo_private.oauth_states enable row level security;

-- Perfiles: el propio, los de compañeros visibles para quien puede ver el equipo,
-- y todos para el platform admin (gestión de usuarios).
create policy profiles_select on nexo.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select nexo.is_platform_admin())
  or exists (
    select 1 from nexo.organization_members m
    where m.user_id = profiles.id
      and m.organization_id in (select nexo.org_ids_with_permission('members.view'))
  )
);

create policy platform_admins_select_self on nexo.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Metadatos de empresa: miembros activos y platform admin (operación, no datos).
create policy organizations_select on nexo.organizations for select to authenticated using (
  id in (select nexo.org_ids_with_permission('org.view')) or (select nexo.is_platform_admin())
);

create policy organization_members_select on nexo.organization_members for select to authenticated using (
  user_id = (select auth.uid())
  or organization_id in (select nexo.org_ids_with_permission('members.view'))
  or (select nexo.is_platform_admin())
);

create policy invitations_select on nexo.invitations for select to authenticated using (
  organization_id in (select nexo.org_ids_with_permission('members.manage')) or (select nexo.is_platform_admin())
);

create policy integrations_select on nexo.integrations for select to authenticated using (
  organization_id in (select nexo.org_ids_with_permission('integrations.view')) or (select nexo.is_platform_admin())
);

create policy provider_accounts_select on nexo.provider_accounts for select to authenticated using (
  organization_id in (select nexo.org_ids_with_permission('integrations.view'))
  or organization_id in (select nexo.org_ids_with_permission('reports.view'))
  or (select nexo.is_platform_admin())
);

-- Datos de reportes: SOLO con permiso reports.view (miembro activo o soporte explícito).
create policy campaigns_select on nexo.campaigns for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy ad_campaign_daily_select on nexo.ad_campaign_daily for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy ad_campaign_daily_actions_select on nexo.ad_campaign_daily_actions for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy web_daily_select on nexo.web_daily for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy web_daily_key_events_select on nexo.web_daily_key_events for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy metric_snapshots_select on nexo.metric_snapshots for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));
create policy data_coverage_select on nexo.data_coverage for select to authenticated
  using (organization_id in (select nexo.org_ids_with_permission('reports.view')));

create policy sync_jobs_select on nexo.sync_jobs for select to authenticated using (
  organization_id in (select nexo.org_ids_with_permission('integrations.view')) or (select nexo.is_platform_admin())
);
create policy sync_runs_select on nexo.sync_runs for select to authenticated using (
  organization_id in (select nexo.org_ids_with_permission('integrations.view')) or (select nexo.is_platform_admin())
);

create policy audit_logs_select on nexo.audit_logs for select to authenticated using (
  (organization_id is not null and organization_id in (select nexo.org_ids_with_permission('audit.view')))
  or (select nexo.is_platform_admin())
);

-- Transparencia: los administradores de la empresa ven los accesos de soporte.
create policy support_sessions_select on nexo.support_sessions for select to authenticated using (
  admin_user_id = (select auth.uid())
  or organization_id in (select nexo.org_ids_with_permission('audit.view'))
  or (select nexo.is_platform_admin())
);

create policy role_permissions_select on nexo.role_permissions for select to authenticated using (true);

-- nexo_private: sin políticas => ningún acceso para roles sujetos a RLS.
