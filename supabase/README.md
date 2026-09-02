# Database notes

## Migrations

`supabase/migrations/*.sql` are plain SQL, applied in name order by
`scripts/migrate.ts` (bookkeeping in `app.schema_migrations`). The same files
work with `supabase db push`.

## Roles and RLS

All business tables have RLS enabled. Policies read transaction-local settings
that the app sets at the start of every request
(`app.actor`, `app.tenant_id`, `app.driver_id`, `app.user_id`), and also
honour Supabase Auth (`auth.uid()`) membership for the PostgREST path.

The application must connect as a role that **cannot bypass RLS**:

```sql
-- run once as postgres on the Supabase project
create role app_service login password '<strong password>' nobypassrls in role app_user;
```

Then set `DATABASE_URL` to the transaction pooler URL with that user, e.g.
`postgres://app_service.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.
`src/lib/db/client.ts` refuses to run in production if the connected role has
`bypassrls` or `superuser`.

## Storage

Bucket `inspection-photos` (private). Objects are written by the server with
the service-role key at `<tenant_id>/<inspection_id>/<photo_id>.jpg` and read
through short-lived signed URLs. Phase 2 adds storage policies for admin
sessions.

## Thresholds

`threshold_versions` rows are immutable. `tenant_id IS NULL` rows are the
platform defaults (version 1 is seeded from `src/lib/tires/thresholds.ts`).
Every inspection stores `threshold_version_id`, so historical classifications
are preserved when thresholds change.

## Retention

`inspections.submitted_at` is indexed per tenant; archival to cold storage of
records older than 3 years can be added as a scheduled job that moves rows
(and storage objects) without schema changes.
