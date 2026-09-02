-- ============================================================================
-- Sample commercial truck tire catalog (shared rows, tenant_id NULL).
-- Illustrative specs for common line-haul / regional sizes. Values are
-- typical published figures and should be verified against manufacturer
-- data sheets before being relied on operationally. Idempotent.
-- ============================================================================
with b(name, slug, country, website) as (values
  ('Michelin', 'michelin', 'FR', 'https://business.michelinman.com'),
  ('Bridgestone', 'bridgestone', 'JP', 'https://www.bridgestonetrucktires.com'),
  ('Goodyear', 'goodyear', 'US', 'https://www.goodyeartrucktires.com'),
  ('Continental', 'continental', 'DE', 'https://www.continental-truck-tires.com'),
  ('Yokohama', 'yokohama', 'JP', 'https://www.yokohamatire.com/commercial'),
  ('Hankook', 'hankook', 'KR', 'https://www.hankooktire.com/us/en/truck-bus.html'),
  ('Firestone', 'firestone', 'US', 'https://www.firestonetrucktires.com')
)
insert into tire_brands (tenant_id, name, slug, country, website, provider)
select null, name, slug, country, website, 'manual' from b
on conflict do nothing;

with m(brand, name, application, category) as (values
  ('michelin', 'X Line Energy Z', 'steer', 'long haul'),
  ('michelin', 'X Line Energy D', 'drive', 'long haul'),
  ('michelin', 'X Line Energy T', 'trailer', 'long haul'),
  ('michelin', 'XZA3+ Evertread', 'steer', 'regional'),
  ('michelin', 'X Multi D', 'drive', 'regional'),
  ('bridgestone', 'R284 Ecopia', 'steer', 'long haul'),
  ('bridgestone', 'M726 ELA', 'drive', 'long haul'),
  ('bridgestone', 'R197', 'trailer', 'long haul'),
  ('bridgestone', 'R268 Ecopia', 'all_position', 'regional'),
  ('goodyear', 'Fuel Max LHS', 'steer', 'long haul'),
  ('goodyear', 'Fuel Max LHD', 'drive', 'long haul'),
  ('goodyear', 'Endurance RSA', 'all_position', 'regional'),
  ('goodyear', 'Endurance LHT', 'trailer', 'long haul'),
  ('continental', 'Conti EcoPlus HS3', 'steer', 'long haul'),
  ('continental', 'Conti EcoPlus HD3', 'drive', 'long haul'),
  ('continental', 'Conti EcoPlus HT3', 'trailer', 'long haul'),
  ('yokohama', '108R', 'steer', 'long haul'),
  ('yokohama', '714R', 'drive', 'regional'),
  ('yokohama', 'RY023', 'trailer', 'long haul'),
  ('hankook', 'e3 Max AL22', 'steer', 'long haul'),
  ('hankook', 'e3 Max DL22', 'drive', 'long haul'),
  ('hankook', 'TL10', 'trailer', 'long haul'),
  ('firestone', 'FS591', 'steer', 'regional'),
  ('firestone', 'FD691', 'drive', 'regional')
)
insert into tire_models (tenant_id, brand_id, name, application, category, provider)
select null, tb.id, m.name, m.application::app.tire_application, m.category, 'manual'
from m join tire_brands tb on tb.slug = m.brand and tb.tenant_id is null
on conflict (brand_id, name) do nothing;

-- Variants: one row per (model, size). Load range / indexes / PSI / tread are
-- representative for the size class; original tread differs by application.
with sizes(size, rim_size, load_range, ply, li_single, li_dual, speed, max_psi) as (values
  ('295/75R22.5', '22.5x8.25', 'G', 14, 144, 141, 'L', 110),
  ('11R22.5',     '22.5x8.25', 'G', 14, 144, 142, 'L', 105),
  ('11R22.5',     '22.5x8.25', 'H', 16, 146, 143, 'L', 120),
  ('285/75R24.5', '24.5x8.25', 'G', 14, 144, 141, 'L', 110),
  ('11R24.5',     '24.5x8.25', 'G', 14, 146, 143, 'L', 105)
), tread(application, depth) as (values
  ('steer', 18.0), ('drive', 26.0), ('trailer', 13.0), ('all_position', 17.0)
)
insert into tire_variants (tenant_id, brand_id, model_id, size, part_number, application, load_range, ply_rating,
                           load_index_single, load_index_dual, speed_rating, max_cold_psi, original_tread_32nds, rim_size, provider)
select null, tm.brand_id, tm.id, s.size, null, tm.application, s.load_range, s.ply, s.li_single, s.li_dual, s.speed, s.max_psi, t.depth, s.rim_size, 'manual'
from tire_models tm
join tread t on t.application = tm.application::text
cross join sizes s
where tm.tenant_id is null
  -- keep the sample set focused: H-rated 11R22.5 only for drive/steer models
  and not (s.load_range = 'H' and tm.application in ('trailer', 'all_position'))
on conflict do nothing;
