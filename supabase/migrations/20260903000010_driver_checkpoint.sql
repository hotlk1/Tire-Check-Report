-- Driver checkpoint: storage location for tires, tire metadata corrections,
-- driver feedback, system rules v3 (photo tread thresholds, PSI high band).

alter table tire_assets add column storage_location text;
alter table tire_assets alter column state set default 'unassigned';
alter type app.tire_event_type add value if not exists 'correction';

create table driver_feedback (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  driver_id   uuid references drivers(id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  message     text,
  page        text,
  app_version text,
  user_agent  text,
  locale      text,
  created_at  timestamptz not null default now()
);
create index driver_feedback_tenant_idx on driver_feedback(tenant_id, created_at desc);
alter table driver_feedback enable row level security;
create policy driver_feedback_insert on driver_feedback for insert with check (app.is_driver_of(tenant_id) and driver_id = app.current_driver_id());
-- Drivers may read back their own rows (INSERT … RETURNING needs the row to be visible).
create policy driver_feedback_read on driver_feedback for select using (
  (app.can_read_tenant(tenant_id) and app.current_actor() <> 'driver') or (app.is_driver_of(tenant_id) and driver_id = app.current_driver_id())
);
grant select, insert on driver_feedback to app_user;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert on driver_feedback to authenticated;
  end if;
end $$;

-- System rules v3: PSI high yellow band (121 PSI is a warning, not out of service);
-- photo mandatory under 3/32 on steer and 5/32 elsewhere, independent of colour status.
insert into threshold_versions (tenant_id, version, config, note)
select null, 3, $json$
{"schemaVersion":3,
 "tread32":{"steer":{"redMax":4,"yellowMax":8},"drive":{"redMax":2,"yellowMax":6},"trailer":{"redMax":2,"yellowMax":6},"spare":{"redMax":2,"yellowMax":6}},
 "psi":{"steer":{"redBelow":95,"yellowBelow":105,"yellowAbove":110,"redAbove":125},"drive":{"redBelow":86,"yellowBelow":100,"yellowAbove":105,"redAbove":120},"trailer":{"redBelow":86,"yellowBelow":100,"yellowAbove":105,"redAbove":120},"spare":{"redBelow":86,"yellowBelow":100,"yellowAbove":105,"redAbove":120}},
 "axle":{"psiDiffYellow":7,"psiDiffRed":10,"dualTreadMismatch":3},
 "photoPolicy":{"damagedRepairable":true,"damagedOos":true,"treadYellow":false,"treadRed":false,"psiYellow":false,"psiRed":false,"treadBelow32":{"steer":3,"drive":5,"trailer":5,"spare":5}}}
$json$::jsonb, 'System defaults v3: PSI high yellow band, photo under 3/32 steer and 5/32 elsewhere'
where not exists (select 1 from threshold_versions where tenant_id is null and version = 3);
