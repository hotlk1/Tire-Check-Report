-- Free-text damage classification chosen from the design's chip list
-- (Air loss / flat, Sidewall cut, Irregular wear, Exposed cord, Chunking, Bulge).
-- The repairable / non-repairable decision stays in `damage`.
alter table tire_entries add column damage_type text;
