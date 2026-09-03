-- Physical tire lifecycle: storage (with an optional named location) and
-- "unassigned" replace the earlier "unmounted". Enum changes only (a new
-- value cannot be used in the transaction that adds it).
alter type app.tire_asset_state rename value 'unmounted' to 'unassigned';
alter type app.tire_asset_state add value if not exists 'storage';
