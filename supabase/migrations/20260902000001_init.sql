-- ============================================================================
-- Tire Check – core schema (Phase 1)
-- Multi-tenant from day one. Every business table carries tenant_id and is
-- protected by RLS (see 20260902000002_rls.sql).
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type app.role as enum ('super_admin', 'admin', 'editor', 'driver');
create type app.record_status as enum ('active', 'inactive');
create type app.asset_type as enum ('truck', 'trailer');
create type app.asset_source as enum ('manual', 'telematics', 'import');
create type app.inspection_mode as enum ('truck', 'trailer', 'truck_trailer');
create type app.inspection_status as enum ('submitted', 'deleted');
create type app.damage_status as enum ('none', 'repairable', 'non_repairable');
create type app.tire_status as enum ('none', 'green', 'yellow', 'red');
create type app.integration_kind as enum ('telematics', 'export', 'workflow', 'ai');
create type app.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type app.ticket_priority as enum ('low', 'normal', 'high', 'critical');

-- ----------------------------------------------------------------------------
-- Tenants
-- ----------------------------------------------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,            -- used in the public inspection link /t/{slug}
  name        text not null,
  status      app.record_status not null default 'active',
  settings    jsonb not null default '{}'::jsonb, -- tenant preferences (default locale, units, ...)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Users (admin/editor logins, backed by Supabase Auth) + memberships
-- ----------------------------------------------------------------------------
create table users (
  id          uuid primary key,                   -- = auth.users.id when using Supabase Auth
  email       citext not null unique,
  full_name   text,
  is_super_admin boolean not null default false,  -- platform-wide operator (SaaS owner)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        app.role not null default 'editor',
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on memberships(user_id);

-- ----------------------------------------------------------------------------
-- Drivers (no login; identified by tenant-scoped phone lookup)
-- ----------------------------------------------------------------------------
create table drivers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  full_name   text not null,
  phone       char(10) not null check (phone ~ '^[0-9]{10}$'),  -- 10-digit US number, digits only
  status      app.record_status not null default 'active',
  locale      text,                                            -- preferred UI language
  external_ref text,                                           -- id in payroll/TMS/ELD
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index drivers_tenant_status_idx on drivers(tenant_id, status);

-- ----------------------------------------------------------------------------
-- Integrations (per-tenant, credentials encrypted app-side with APP_ENCRYPTION_KEY)
-- ----------------------------------------------------------------------------
create table integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        app.integration_kind not null,
  provider    text not null,                     -- 'samsara' | 'motive' | 'geotab' | 'airtable' | 'webhook' | ...
  label       text not null,
  status      app.record_status not null default 'active',
  credentials_ciphertext text,                   -- AES-256-GCM envelope (base64), never plaintext
  config      jsonb not null default '{}'::jsonb, -- non-secret settings (base ids, field mappings, filters)
  last_sync_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index integrations_tenant_idx on integrations(tenant_id, kind);

-- ----------------------------------------------------------------------------
-- Assets: trucks and trailers (normalized regardless of telematics provider)
-- ----------------------------------------------------------------------------
create table assets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  type          app.asset_type not null,
  unit_number   citext not null,
  vin           text,
  make          text,
  model         text,
  year          int,
  license_plate text,
  status        app.record_status not null default 'active',
  source        app.asset_source not null default 'manual',
  integration_id uuid references integrations(id) on delete set null,
  external_id   text,                             -- provider asset id
  axle_config   jsonb,                            -- future: non-standard layouts
  last_odometer numeric(12,1),
  last_odometer_at timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, type, unit_number)
);
create index assets_tenant_type_status_idx on assets(tenant_id, type, status);
create unique index assets_external_idx on assets(integration_id, external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- Threshold versions (immutable; each inspection references the active one)
-- tenant_id NULL = platform default.
-- ----------------------------------------------------------------------------
create table threshold_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  version     int not null,
  config      jsonb not null,
  note        text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, version)
);
create unique index threshold_versions_system_idx on threshold_versions(version) where tenant_id is null;

-- ----------------------------------------------------------------------------
-- Physical tires (future identity tracking; referenced optionally now)
-- ----------------------------------------------------------------------------
create table tire_assets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  serial      text,                              -- DOT / serial / QR payload (future)
  make        text,
  model       text,
  size        text,
  dot_date    date,                              -- future: DOT date reading → tire age alerts
  status      app.record_status not null default 'active',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index tire_assets_serial_idx on tire_assets(tenant_id, serial) where serial is not null;

-- ----------------------------------------------------------------------------
-- Inspections
-- ----------------------------------------------------------------------------
create table inspections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  driver_id       uuid references drivers(id) on delete set null,
  mode            app.inspection_mode not null,
  truck_asset_id  uuid references assets(id) on delete set null,
  trailer_asset_id uuid references assets(id) on delete set null,
  odometer        numeric(12,1),
  hubometer       numeric(12,1),
  threshold_version_id uuid not null references threshold_versions(id),
  status          app.inspection_status not null default 'submitted',
  client_draft_id uuid not null,                  -- idempotency key from the device
  started_at      timestamptz,                    -- when the driver began (device clock)
  submitted_at    timestamptz not null default now(),
  location        jsonb,                          -- {lat,lng,accuracy,captured_at}
  context         jsonb not null default '{}'::jsonb, -- weather/temperature etc. (future)
  notes           text,
  summary         jsonb not null default '{}'::jsonb, -- denormalized counters for dashboards
  photos_expected int not null default 0,
  photos_uploaded int not null default 0,
  edited_at       timestamptz,
  edited_by       uuid references users(id),
  deleted_at      timestamptz,
  deleted_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, client_draft_id),
  check (mode = 'trailer' or truck_asset_id is not null),
  check (mode = 'truck' or trailer_asset_id is not null)
);
create index inspections_tenant_submitted_idx on inspections(tenant_id, submitted_at desc);
create index inspections_tenant_driver_idx on inspections(tenant_id, driver_id, submitted_at desc);
create index inspections_truck_idx on inspections(truck_asset_id, submitted_at desc);
create index inspections_trailer_idx on inspections(trailer_asset_id, submitted_at desc);
create index inspections_status_idx on inspections(tenant_id, status);

-- ----------------------------------------------------------------------------
-- Tire entries: one row per tire per inspection
-- ----------------------------------------------------------------------------
create table tire_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  inspection_id uuid not null references inspections(id) on delete cascade,
  asset_id      uuid references assets(id) on delete set null,    -- the truck or trailer this tire is on
  tire_number   smallint not null check (tire_number between 1 and 20),
  position_code text not null,                                    -- L, R, LO, LI, RI, RO, SP
  axle_key      text not null,
  psi           numeric(5,1),
  tread_32nds   smallint check (tread_32nds between 0 and 40),
  damage        app.damage_status not null default 'none',
  tire_make     text,
  tire_model    text,
  tire_size     text,
  tire_asset_id uuid references tire_assets(id) on delete set null, -- future physical tire identity
  psi_status    app.tire_status not null default 'none',
  tread_status  app.tire_status not null default 'none',
  overall_status app.tire_status not null default 'none',
  notes         text,
  ai_suggestion jsonb,                                              -- {tread32, confidence, defects[], quality, accepted}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (inspection_id, tire_number)
);
create index tire_entries_tenant_idx on tire_entries(tenant_id, created_at desc);
create index tire_entries_asset_pos_idx on tire_entries(asset_id, tire_number, created_at desc);
create index tire_entries_status_idx on tire_entries(tenant_id, overall_status);
create index tire_entries_tire_asset_idx on tire_entries(tire_asset_id) where tire_asset_id is not null;

-- ----------------------------------------------------------------------------
-- Photos
-- ----------------------------------------------------------------------------
create table photos (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  inspection_id   uuid not null references inspections(id) on delete cascade,
  tire_entry_id   uuid references tire_entries(id) on delete cascade,
  client_photo_id uuid not null,                 -- idempotency key from the device
  storage_provider text not null default 'supabase',
  storage_path    text not null,
  content_type    text not null,
  byte_size       int,
  width           int,
  height          int,
  taken_at        timestamptz,
  ai_analysis     jsonb,
  created_at      timestamptz not null default now(),
  unique (inspection_id, client_photo_id)
);
create index photos_tire_entry_idx on photos(tire_entry_id);
create index photos_tenant_idx on photos(tenant_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Service tickets (DB first; pushed to Asana/Airtable/Telegram later)
-- ----------------------------------------------------------------------------
create table service_tickets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  inspection_id uuid references inspections(id) on delete set null,
  tire_entry_id uuid references tire_entries(id) on delete set null,
  asset_id      uuid references assets(id) on delete set null,
  title         text not null,
  description   text,
  status        app.ticket_status not null default 'open',
  priority      app.ticket_priority not null default 'normal',
  assignee      text,
  external_refs jsonb not null default '{}'::jsonb, -- {asana: {gid}, airtable: {recordId}, ...}
  created_by    uuid references users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index service_tickets_tenant_status_idx on service_tickets(tenant_id, status, created_at desc);

-- ----------------------------------------------------------------------------
-- Audit log
-- ----------------------------------------------------------------------------
create table audit_log (
  id            bigint generated always as identity primary key,
  tenant_id     uuid references tenants(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  actor_driver_id uuid references drivers(id) on delete set null,
  actor_label   text,                            -- denormalized display name at time of action
  action        text not null,                   -- 'create' | 'update' | 'delete' | 'config' | 'sync' | ...
  entity_type   text not null,                   -- 'inspection' | 'driver' | 'threshold_version' | ...
  entity_id     text,
  old_value     jsonb,
  new_value     jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id, created_at desc);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Rate limiting (DB-backed so it works on Vercel without Redis)
-- ----------------------------------------------------------------------------
create table app.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null default 0
);

-- Returns true when the call is allowed, false when the limit is exceeded.
create or replace function app.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_count int;
begin
  insert into app.rate_limits(key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set count = case when app.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds) then 1 else app.rate_limits.count + 1 end,
        window_start = case when app.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds) then v_now else app.rate_limits.window_start end
  returning count into v_count;
  -- opportunistic cleanup
  if random() < 0.01 then
    delete from app.rate_limits where window_start < v_now - interval '1 day';
  end if;
  return v_count <= p_limit;
end;
$$;

-- ----------------------------------------------------------------------------
-- Migration bookkeeping for scripts/migrate.ts (separate from Supabase CLI's)
-- ----------------------------------------------------------------------------
create table if not exists app.schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tenants','users','drivers','integrations','assets','tire_assets','inspections','tire_entries','service_tickets']
  loop
    execute format('create trigger %I_set_updated_at before update on %I for each row execute function app.set_updated_at()', t, t);
  end loop;
end $$;
