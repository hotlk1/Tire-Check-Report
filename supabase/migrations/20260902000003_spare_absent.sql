-- Spares (19, 20) must be either inspected or explicitly declared absent.
alter table tire_entries add column absent boolean not null default false;
comment on column tire_entries.absent is 'Spare position declared "No spare" by the driver (tires 19/20 only).';
