-- ============================================================================
-- Global tire product catalog (brand → model/pattern → variant/SKU).
--
-- Rows with tenant_id NULL are the shared catalog (maintained by super admins
-- or synced from an external provider). Rows with a tenant_id are tenant
-- custom entries (maintained by that tenant's admins) — a tire that is not in
-- the shared catalog never blocks an inspection. Provider columns let an
-- external catalog (Tirelibrary, TyreAPI, manufacturer APIs, …) be synced
-- later without changing the schema.
-- ============================================================================

create type app.tire_application as enum ('steer', 'drive', 'trailer', 'all_position');
create type app.catalog_status as enum ('active', 'discontinued');

create table tire_brands (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references tenants(id) on delete cascade,   -- NULL = shared catalog
  name                 text not null,
  slug                 citext not null,
  country              text,
  website              text,
  status               app.catalog_status not null default 'active',
  provider             text not null default 'manual',                  -- 'manual' | 'tirelibrary' | 'tyreapi' | ...
  provider_external_id text,
  last_synced_at       timestamptz,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index tire_brands_slug_idx on tire_brands(coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create unique index tire_brands_provider_idx on tire_brands(provider, provider_external_id) where provider_external_id is not null;

create table tire_models (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references tenants(id) on delete cascade,
  brand_id             uuid not null references tire_brands(id) on delete cascade,
  name                 text not null,                                     -- pattern / model line, e.g. "X Line Energy Z"
  application          app.tire_application not null default 'all_position',
  category             text,                                              -- long haul / regional / mixed service / urban
  status               app.catalog_status not null default 'active',
  provider             text not null default 'manual',
  provider_external_id text,
  last_synced_at       timestamptz,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (brand_id, name)
);
create index tire_models_brand_idx on tire_models(brand_id, status);
create unique index tire_models_provider_idx on tire_models(provider, provider_external_id) where provider_external_id is not null;

create table tire_variants (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references tenants(id) on delete cascade,
  brand_id             uuid not null references tire_brands(id) on delete cascade, -- denormalized for search
  model_id             uuid not null references tire_models(id) on delete cascade,
  size                 text not null,                                     -- e.g. 295/75R22.5, 11R22.5
  part_number          text,                                              -- manufacturer part / product code
  application          app.tire_application not null default 'all_position',
  load_range           text,                                              -- G, H, J, L
  ply_rating           smallint,
  load_index_single    smallint,
  load_index_dual      smallint,
  speed_rating         text,                                              -- L, M, ...
  max_cold_psi         smallint,
  original_tread_32nds numeric(4,1),
  rim_size             text,                                              -- e.g. 22.5x8.25
  status               app.catalog_status not null default 'active',
  provider             text not null default 'manual',
  provider_external_id text,
  last_synced_at       timestamptz,
  attributes           jsonb not null default '{}'::jsonb,                -- provider-specific extras
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index tire_variants_model_size_pn_idx on tire_variants(model_id, size, coalesce(part_number, ''));
create index tire_variants_brand_idx on tire_variants(brand_id, status);
create index tire_variants_size_idx on tire_variants(size);
create index tire_variants_search_idx on tire_variants using gin (to_tsvector('simple', coalesce(size, '') || ' ' || coalesce(part_number, '')));
create unique index tire_variants_provider_idx on tire_variants(provider, provider_external_id) where provider_external_id is not null;

-- Readings and (future) physical tires reference a variant when one was chosen;
-- the free-text make/model/size columns remain for custom / unlisted tires.
alter table tire_entries add column tire_variant_id uuid references tire_variants(id) on delete set null;
create index tire_entries_variant_idx on tire_entries(tire_variant_id) where tire_variant_id is not null;
alter table tire_assets add column tire_variant_id uuid references tire_variants(id) on delete set null;
create index tire_assets_variant_idx on tire_assets(tire_variant_id) where tire_variant_id is not null;

-- updated_at triggers
create trigger tire_brands_set_updated_at before update on tire_brands for each row execute function app.set_updated_at();
create trigger tire_models_set_updated_at before update on tire_models for each row execute function app.set_updated_at();
create trigger tire_variants_set_updated_at before update on tire_variants for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: shared rows readable by every scoped actor; tenant rows by that tenant.
-- Writes: shared rows → super admins; tenant rows → that tenant's admins.
-- ----------------------------------------------------------------------------
create or replace function app.can_read_catalog(p_tenant uuid) returns boolean
language sql stable as $$
  select p_tenant is null or app.can_read_tenant(p_tenant)
$$;
create or replace function app.can_write_catalog(p_tenant uuid) returns boolean
language sql stable as $$
  select (p_tenant is null and app.is_super_admin()) or (p_tenant is not null and app.is_tenant_admin(p_tenant))
$$;

alter table tire_brands   enable row level security;
alter table tire_models   enable row level security;
alter table tire_variants enable row level security;

create policy tire_brands_read on tire_brands for select using (app.can_read_catalog(tenant_id));
create policy tire_brands_write on tire_brands for all using (app.can_write_catalog(tenant_id)) with check (app.can_write_catalog(tenant_id));
create policy tire_models_read on tire_models for select using (app.can_read_catalog(tenant_id));
create policy tire_models_write on tire_models for all using (app.can_write_catalog(tenant_id)) with check (app.can_write_catalog(tenant_id));
create policy tire_variants_read on tire_variants for select using (app.can_read_catalog(tenant_id));
create policy tire_variants_write on tire_variants for all using (app.can_write_catalog(tenant_id)) with check (app.can_write_catalog(tenant_id));

grant select, insert, update, delete on tire_brands, tire_models, tire_variants to app_user;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on tire_brands, tire_models, tire_variants to authenticated;
  end if;
end $$;
