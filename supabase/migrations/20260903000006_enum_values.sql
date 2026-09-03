-- Enum extensions for the generalized equipment model. Kept in their own
-- migration because a new enum value cannot be used in the transaction that
-- adds it.
alter type app.asset_type add value if not exists 'jeep';
alter type app.asset_type add value if not exists 'dolly';
alter type app.asset_type add value if not exists 'booster';
alter type app.inspection_mode add value if not exists 'combination';
-- Submitted, but a policy-required photo has not been uploaded yet.
alter type app.inspection_status add value if not exists 'pending_photos';
