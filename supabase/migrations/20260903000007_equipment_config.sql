-- ============================================================================
-- Generalized equipment configuration, physical tire identity, rules v2.
--
--  * asset_configurations: versioned axle/wheel/spare definitions per asset
--    (assets without one use the built-in default template for their kind).
--  * inspections.equipment: immutable layout snapshot used at submission
--    (NULL = legacy fixed 20-position layout derived from `mode`).
--  * inspection_components: which assets (tractor, jeep, trailer, dolly,
--    booster, second trailer) an inspection covered, for per-asset history.
--  * tire_entries: readings keyed by layout position; tire_number stays as
--    the human-friendly label within the inspection.
--  * tire_assets + tire_mount_events: physical tires with lifecycle state and
--    append-only mount history.
--  * Rules v2: spare class + photo policy, seeded as system version 2.
-- All changes are additive so the previous application version keeps working
-- against the migrated database.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Asset configurations
-- ----------------------------------------------------------------------------
create table asset_configurations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  asset_id     uuid not null references assets(id) on delete cascade,
  version      int not null,
  config       jsonb not null,                       -- EquipmentConfig (schemaVersion 1)
  template_key text,
  note         text,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  unique (asset_id, version)
);
create index asset_configurations_asset_idx on asset_configurations(asset_id, version desc);
comment on table asset_configurations is 'Immutable configuration versions of an asset (axles, wheels, spare slots). Newest version is current.';

-- ----------------------------------------------------------------------------
-- Inspections: layout snapshot, components, photo completion
-- ----------------------------------------------------------------------------
alter table inspections add column equipment jsonb;
comment on column inspections.equipment is 'InspectionLayout snapshot at submission (components, axles, numbered positions). NULL = legacy 20-position layout by mode.';
alter table inspections add column required_photos_missing int not null default 0;
alter table inspections add column completed_at timestamptz;
update inspections set completed_at = submitted_at where completed_at is null;

create table inspection_components (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  inspection_id    uuid not null references inspections(id) on delete cascade,
  slot             text not null,                     -- truck | jeep | trailer | dolly | booster | trailer2
  asset_id         uuid references assets(id) on delete set null,
  configuration_id uuid references asset_configurations(id) on delete set null,
  position         smallint not null,                 -- road order
  unique (inspection_id, slot)
);
create index inspection_components_asset_idx on inspection_components(asset_id, inspection_id);

insert into inspection_components (tenant_id, inspection_id, slot, asset_id, position)
select tenant_id, id, 'truck', truck_asset_id, 0 from inspections where truck_asset_id is not null;
insert into inspection_components (tenant_id, inspection_id, slot, asset_id, position)
select tenant_id, id, 'trailer', trailer_asset_id, 1 from inspections where trailer_asset_id is not null;

-- ----------------------------------------------------------------------------
-- Tire entries: layout position keys
-- ----------------------------------------------------------------------------
alter table tire_entries drop constraint if exists tire_entries_tire_number_check;
alter table tire_entries add constraint tire_entries_tire_number_check check (tire_number between 1 and 200);
alter table tire_entries add column component_slot text;
alter table tire_entries add column position_key text;      -- `${slot}/${axleKey}:${ABBR}` or `${slot}/${spareKey}`
alter table tire_entries add column photo_required boolean not null default false;
-- Legacy rows: truck-steer/L → truck/steer:L, trailer-axle-1/LO → trailer/axle-1:LO, truck-spare/SP → truck/spare-1
update tire_entries set
  component_slot = case when axle_key like 'truck%' then 'truck' else 'trailer' end,
  position_key = case
    when position_code = 'SP' then (case when axle_key like 'truck%' then 'truck' else 'trailer' end) || '/spare-1'
    else (case when axle_key like 'truck%' then 'truck' else 'trailer' end) || '/' || regexp_replace(axle_key, '^(truck|trailer)-', '') || ':' || position_code
  end
where position_key is null;
create index tire_entries_position_idx on tire_entries(asset_id, position_key, created_at desc);

-- ----------------------------------------------------------------------------
-- Physical tires
-- ----------------------------------------------------------------------------
create type app.tire_asset_state as enum ('mounted', 'spare', 'unmounted', 'damaged', 'removed', 'disposed', 'lost');
create type app.tire_event_type as enum ('mount', 'unmount', 'move', 'replace', 'status', 'inspected');

create sequence app.tire_asset_code_seq;
create or replace function app.next_tire_code() returns text
language sql volatile as $$
  select 'T' || lpad(nextval('app.tire_asset_code_seq')::text, 6, '0')
$$;
grant usage on sequence app.tire_asset_code_seq to app_user;

alter table tire_assets add column code text not null default app.next_tire_code();
alter table tire_assets add column state app.tire_asset_state not null default 'unmounted';
alter table tire_assets add column current_asset_id uuid references assets(id) on delete set null;
alter table tire_assets add column current_position_key text;   -- `axleKey:ABBR` / `spare-1` (without the inspection slot)
alter table tire_assets add column mounted_at timestamptz;
alter table tire_assets add column retired_at timestamptz;
alter table tire_assets add column last_inspected_at timestamptz;
alter table tire_assets add column last_tread_32nds smallint;
alter table tire_assets add column last_psi numeric(5,1);
alter table tire_assets add column notes text;
create unique index tire_assets_code_idx on tire_assets(tenant_id, code);
create unique index tire_assets_current_position_idx on tire_assets(current_asset_id, current_position_key) where current_asset_id is not null and state in ('mounted', 'spare');
create index tire_assets_tenant_state_idx on tire_assets(tenant_id, state);
comment on column tire_assets.code is 'Internal physical tire id shown to people (until serial/QR workflows exist).';

create table tire_mount_events (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references tenants(id) on delete cascade,
  tire_asset_id     uuid not null references tire_assets(id) on delete cascade,
  event_type        app.tire_event_type not null,
  asset_id          uuid references assets(id) on delete set null,
  position_key      text,
  from_asset_id     uuid references assets(id) on delete set null,
  from_position_key text,
  from_state        app.tire_asset_state,
  to_state          app.tire_asset_state,
  inspection_id     uuid references inspections(id) on delete set null,
  actor_user_id     uuid references users(id) on delete set null,
  actor_driver_id   uuid references drivers(id) on delete set null,
  actor_label       text,
  note              text,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index tire_mount_events_tire_idx on tire_mount_events(tire_asset_id, occurred_at desc);
create index tire_mount_events_asset_idx on tire_mount_events(asset_id, occurred_at desc);
comment on table tire_mount_events is 'Append-only mount/move/status history of physical tires. Never updated.';

-- ----------------------------------------------------------------------------
-- Rules v2 (spare class + photo policy) as system default version 2
-- ----------------------------------------------------------------------------
insert into threshold_versions (tenant_id, version, config, note)
select null, 2, $json$
{"schemaVersion":2,
 "tread32":{"steer":{"redMax":4,"yellowMax":8},"drive":{"redMax":2,"yellowMax":6},"trailer":{"redMax":2,"yellowMax":6},"spare":{"redMax":2,"yellowMax":6}},
 "psi":{"steer":{"redBelow":95,"yellowBelow":105,"redAbove":110},"drive":{"redBelow":86,"yellowBelow":100,"redAbove":105},"trailer":{"redBelow":86,"yellowBelow":100,"redAbove":105},"spare":{"redBelow":86,"yellowBelow":100,"redAbove":105}},
 "axle":{"psiDiffYellow":7,"psiDiffRed":10,"dualTreadMismatch":3},
 "photoPolicy":{"damagedRepairable":true,"damagedOos":true,"treadYellow":true,"treadRed":true,"psiYellow":false,"psiRed":false}}
$json$::jsonb, 'System defaults v2: spare class, photo policy'
where not exists (select 1 from threshold_versions where tenant_id is null and version = 2);

-- ----------------------------------------------------------------------------
-- RLS + grants
-- ----------------------------------------------------------------------------
alter table asset_configurations  enable row level security;
alter table inspection_components enable row level security;
alter table tire_mount_events     enable row level security;

create policy asset_configurations_read on asset_configurations for select using (app.can_read_tenant(tenant_id));
create policy asset_configurations_insert on asset_configurations for insert with check (app.is_tenant_admin(tenant_id));
-- versions are immutable: no update/delete policies.

create policy inspection_components_read on inspection_components for select using (
  app.can_read_tenant(tenant_id) and (
    app.current_actor() <> 'driver'
    or exists (select 1 from inspections i where i.id = inspection_components.inspection_id and i.driver_id = app.current_driver_id())
  )
);
create policy inspection_components_driver_insert on inspection_components for insert with check (
  app.is_driver_of(tenant_id)
  and exists (select 1 from inspections i where i.id = inspection_components.inspection_id and i.driver_id = app.current_driver_id())
);
create policy inspection_components_manage on inspection_components for all using (app.can_manage_tenant(tenant_id)) with check (app.can_manage_tenant(tenant_id));

-- Drivers create/update physical tires while submitting (mount reconciliation); admins/editors manage.
create policy tire_assets_driver_insert on tire_assets for insert with check (app.is_driver_of(tenant_id));
create policy tire_assets_driver_update on tire_assets for update using (app.is_driver_of(tenant_id)) with check (app.is_driver_of(tenant_id));

create policy tire_mount_events_read on tire_mount_events for select using (app.can_read_tenant(tenant_id) and app.current_actor() <> 'driver');
create policy tire_mount_events_insert on tire_mount_events for insert with check (app.is_driver_of(tenant_id) or app.can_manage_tenant(tenant_id));
-- append-only: no update/delete policies.

grant select, insert, update, delete on asset_configurations, inspection_components, tire_mount_events to app_user;
grant usage, select on all sequences in schema public to app_user;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on asset_configurations, inspection_components, tire_mount_events to authenticated;
  end if;
end $$;
