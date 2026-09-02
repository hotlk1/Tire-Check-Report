-- ============================================================================
-- Row Level Security
--
-- Two access paths, both enforced in the database:
--  1. App server (postgres.js, role `app_user`, NO bypassrls). Every request
--     runs inside a transaction that sets:
--        app.tenant_id  – the tenant the request is scoped to
--        app.actor      – 'driver' | 'admin' | 'editor' | 'super_admin' | 'system'
--        app.driver_id  – for driver sessions
--        app.user_id    – for admin sessions
--     via set_config(..., true). Policies below read those settings.
--  2. Supabase PostgREST/Dashboard with a Supabase Auth user (auth.uid()):
--     membership-based access for admins/editors (Phase 2 admin UI can use
--     either path). auth.uid() is wrapped so the schema also works on plain
--     Postgres in local development.
-- ============================================================================

create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function app.current_actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), 'anon')
$$;

create or replace function app.current_driver_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.driver_id', true), '')::uuid
$$;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- auth.uid() exists on Supabase; on plain Postgres we return null.
create or replace function app.auth_uid() returns uuid
language plpgsql stable as $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    return (select auth.uid());
  end if;
  return null;
end;
$$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.current_actor() = 'super_admin'
      or exists (select 1 from users u where u.id = coalesce(app.current_user_id(), app.auth_uid()) and u.is_super_admin)
$$;

-- Tenants the current admin/editor user belongs to (either access path).
create or replace function app.member_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select m.tenant_id from memberships m
  where m.user_id = coalesce(app.current_user_id(), app.auth_uid())
$$;

create or replace function app.member_role(p_tenant uuid) returns app.role
language sql stable security definer set search_path = public, app, pg_temp as $$
  select m.role from memberships m
  where m.user_id = coalesce(app.current_user_id(), app.auth_uid()) and m.tenant_id = p_tenant
$$;

-- "Can read rows of this tenant"
create or replace function app.can_read_tenant(p_tenant uuid) returns boolean
language sql stable as $$
  select app.is_super_admin()
      or (app.current_tenant_id() = p_tenant and app.current_actor() in ('driver','admin','editor','system'))
      or p_tenant in (select app.member_tenant_ids())
$$;

-- "Can write (admin/editor) rows of this tenant"
create or replace function app.can_manage_tenant(p_tenant uuid) returns boolean
language sql stable as $$
  select app.is_super_admin()
      or (app.current_tenant_id() = p_tenant and app.current_actor() in ('admin','editor','system'))
      or app.member_role(p_tenant) in ('admin','editor','super_admin')
$$;

-- "Is admin of this tenant" (config, thresholds, users)
create or replace function app.is_tenant_admin(p_tenant uuid) returns boolean
language sql stable as $$
  select app.is_super_admin()
      or (app.current_tenant_id() = p_tenant and app.current_actor() in ('admin','system'))
      or app.member_role(p_tenant) in ('admin','super_admin')
$$;

-- "Driver session scoped to this tenant"
create or replace function app.is_driver_of(p_tenant uuid) returns boolean
language sql stable as $$
  select app.current_actor() = 'driver' and app.current_tenant_id() = p_tenant and app.current_driver_id() is not null
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere
-- ----------------------------------------------------------------------------
alter table tenants            enable row level security;
alter table users              enable row level security;
alter table memberships        enable row level security;
alter table drivers            enable row level security;
alter table integrations       enable row level security;
alter table assets             enable row level security;
alter table threshold_versions enable row level security;
alter table tire_assets        enable row level security;
alter table inspections        enable row level security;
alter table tire_entries       enable row level security;
alter table photos             enable row level security;
alter table service_tickets    enable row level security;
alter table audit_log          enable row level security;
alter table app.rate_limits    enable row level security;

-- tenants: readable by members / scoped sessions; managed only by super admins
create policy tenants_read on tenants for select using (app.can_read_tenant(id) or app.current_actor() = 'anon_lookup');
create policy tenants_admin on tenants for all using (app.is_super_admin()) with check (app.is_super_admin());

-- users: a user sees themself + users sharing a tenant; super admins see all
create policy users_read on users for select using (
  app.is_super_admin()
  or id = coalesce(app.current_user_id(), app.auth_uid())
  or exists (select 1 from memberships m where m.user_id = users.id and app.is_tenant_admin(m.tenant_id))
);
create policy users_self_update on users for update using (id = coalesce(app.current_user_id(), app.auth_uid()) or app.is_super_admin());
create policy users_insert on users for insert with check (app.is_super_admin() or app.current_actor() = 'system' or id = app.auth_uid());

create policy memberships_read on memberships for select using (app.can_read_tenant(tenant_id));
create policy memberships_manage on memberships for all using (app.is_tenant_admin(tenant_id)) with check (app.is_tenant_admin(tenant_id));

-- drivers: the public phone lookup runs as actor 'anon_lookup' and may only
-- SELECT (the server function still requires an exact tenant+phone match).
create policy drivers_read on drivers for select using (
  app.can_read_tenant(tenant_id)
  or (app.current_actor() = 'anon_lookup' and app.current_tenant_id() = tenant_id)
);
create policy drivers_manage on drivers for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

create policy integrations_read on integrations for select using (app.is_tenant_admin(tenant_id) or (app.current_actor() = 'system' and app.current_tenant_id() = tenant_id));
create policy integrations_manage on integrations for all using (app.is_tenant_admin(tenant_id)) with check (app.is_tenant_admin(tenant_id));

create policy assets_read on assets for select using (app.can_read_tenant(tenant_id));
create policy assets_manage on assets for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

-- thresholds: platform defaults (tenant_id null) are readable by everyone scoped; tenant versions by members
create policy thresholds_read on threshold_versions for select using (tenant_id is null or app.can_read_tenant(tenant_id));
create policy thresholds_insert on threshold_versions for insert with check (
  (tenant_id is null and app.is_super_admin()) or (tenant_id is not null and app.is_tenant_admin(tenant_id))
);
-- versions are immutable: no update/delete policies.

create policy tire_assets_read on tire_assets for select using (app.can_read_tenant(tenant_id));
create policy tire_assets_manage on tire_assets for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

-- inspections: drivers insert their own; read their own; admins/editors manage
create policy inspections_read on inspections for select using (
  app.can_read_tenant(tenant_id) and (app.current_actor() <> 'driver' or driver_id = app.current_driver_id())
);
create policy inspections_driver_insert on inspections for insert with check (
  app.is_driver_of(tenant_id) and driver_id = app.current_driver_id()
);
create policy inspections_driver_update on inspections for update using (
  app.is_driver_of(tenant_id) and driver_id = app.current_driver_id()
) with check (app.is_driver_of(tenant_id) and driver_id = app.current_driver_id());
create policy inspections_manage on inspections for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

create policy tire_entries_read on tire_entries for select using (
  app.can_read_tenant(tenant_id) and (
    app.current_actor() <> 'driver'
    or exists (select 1 from inspections i where i.id = tire_entries.inspection_id and i.driver_id = app.current_driver_id())
  )
);
create policy tire_entries_driver_insert on tire_entries for insert with check (
  app.is_driver_of(tenant_id)
  and exists (select 1 from inspections i where i.id = tire_entries.inspection_id and i.driver_id = app.current_driver_id())
);
create policy tire_entries_manage on tire_entries for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

create policy photos_read on photos for select using (
  app.can_read_tenant(tenant_id) and (
    app.current_actor() <> 'driver'
    or exists (select 1 from inspections i where i.id = photos.inspection_id and i.driver_id = app.current_driver_id())
  )
);
create policy photos_driver_insert on photos for insert with check (
  app.is_driver_of(tenant_id)
  and exists (select 1 from inspections i where i.id = photos.inspection_id and i.driver_id = app.current_driver_id())
);
create policy photos_manage on photos for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

create policy tickets_read on service_tickets for select using (app.can_read_tenant(tenant_id) and app.current_actor() <> 'driver');
create policy tickets_manage on service_tickets for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

-- audit log: append-only. Readable by tenant admins; inserted by any scoped actor.
create policy audit_read on audit_log for select using (app.is_tenant_admin(tenant_id) or (tenant_id is null and app.is_super_admin()));
create policy audit_insert on audit_log for insert with check (
  app.is_super_admin()
  or (tenant_id is not null and app.current_tenant_id() = tenant_id and app.current_actor() in ('driver','admin','editor','system'))
  or (tenant_id is not null and tenant_id in (select app.member_tenant_ids()))
);

-- rate_limits: only via the security definer function
-- (no policies → no direct access for non-owners)

-- ----------------------------------------------------------------------------
-- Application role (no bypassrls). A LOGIN role must be created that is a
-- member of app_user – see scripts/local-db.sh and supabase/README.md.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin nobypassrls;
  end if;
end $$;

grant usage on schema public, app to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
grant execute on function app.rate_limit_hit(text, int, int) to app_user;
grant execute on all functions in schema app to app_user;
grant select, insert on app.schema_migrations to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public grant usage, select on sequences to app_user;

-- Supabase's `authenticated` role (PostgREST path) – only if it exists.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema app to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema app to authenticated;
  end if;
end $$;
