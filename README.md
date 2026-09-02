# Tire Check

Mobile tire inspection app for drivers + fleet management dashboard. Multi-tenant
from day one (JGG, ZSP, Atom), built as a Next.js PWA on Vercel with
PostgreSQL/Supabase.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Tenancy + RLS, driver phone verification, equipment selection, tire diagram UI, status/axle logic, photos, offline autosave + outbox, submit, hosted report | **Implemented** |
| 2 | Admin auth, dashboard with drill-down KPIs/trends/heatmaps, reports edit/delete with history, trucks/trailers/tires, drivers + CSV import, users/roles, threshold versioning, audit log | **Implemented** |
| 3 | Samsara adapter, Airtable export, service tickets/webhooks, AI photo analysis provider, PDF export | Contracts in place, providers planned |

What is real vs. development-only:

- **Real**: schema, RLS, rate limiting, driver sessions, submission/photo APIs,
  offline drafts and outbox, report rendering, threshold versioning, the whole
  admin app (every edit/delete/config change writes an audit row).
- **Development-only mocks** (each logs a loud warning and is refused in
  production): Turnstile skip when `TURNSTILE_SECRET_KEY` is empty, local-disk
  photo storage when Supabase Storage is not configured, the password-less
  "dev login" for admins when Supabase Auth is not configured, and seeded demo
  drivers/assets/admin users from `scripts/seed.ts --dev`.
- **Not yet wired**: the AI vision provider (endpoint returns `available: false`),
  telematics/Airtable providers (tables and encryption helpers exist).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4
- PostgreSQL via `postgres` (postgres.js) with tenant scoping enforced by RLS
- Supabase: Auth (admins, Phase 2) + Storage (photos)
- IndexedDB (`idb`) for offline drafts/photos/outbox; service worker for the app shell
- `jose` driver session cookies, Cloudflare Turnstile, DB-backed rate limits
- vitest for domain logic, Playwright for smoke tests

## Local development

```bash
npm install
cp .env.example .env.local           # fill in DATABASE_URL etc. (defaults match the local DB below)

# Local Postgres (any 15/16). Example using a throwaway cluster:
#   initdb -D /tmp/pg -A trust -U postgres && pg_ctl -D /tmp/pg -o '-p 54329' start
npm run db:setup:local               # creates tire_check DB, app_service role, runs migrations + dev seed

npm run dev                          # http://localhost:3000/t/jgg  → phone 5550000001
                                     # http://localhost:3000/admin  → admin@dev.local (dev login)
```

End-to-end smoke tests (dev server running): `npx playwright test`.

Checks: `npm run verify` runs typecheck, lint, unit tests and a production build.

## Deploying (Vercel + Supabase)

1. Create a Supabase project. Run migrations with either
   `npx tsx scripts/migrate.ts "$SUPABASE_DB_URL"` (postgres superuser URL) or
   `supabase db push` (files live in `supabase/migrations`). Then
   `npx tsx scripts/seed.ts "$SUPABASE_DB_URL"` (no `--dev`).
2. Create the app login role (see `supabase/README.md`) and set `DATABASE_URL`
   to it. The app refuses to start in production if the role can bypass RLS.
3. Create a **private** Storage bucket `inspection-photos`.
4. Set the environment variables from `.env.example` in Vercel. Only
   application-level secrets go there; tenant integration credentials are
   stored encrypted in the database.
5. Deploy. Driver links are `https://<host>/t/<tenant-slug>`.

## Admin access model

- Admin/editor identities come from Supabase Auth in production. On first
  sign-in a `users` profile row is created; access is granted by an admin
  adding the email under Drivers / Users (invitation via the Auth admin API).
- Roles: `super_admin` (platform, all tenants), `admin` (tenant configuration,
  users, thresholds), `editor` (data edits). Drivers never log in; they use the
  tenant link.
- Bootstrapping the first super admin on a fresh Supabase project: sign in once
  so the profile row exists, then `update users set is_super_admin = true where email = '...'`.

## Layout

```
supabase/migrations/    SQL schema + RLS (also used by scripts/migrate.ts)
scripts/                migrate, seed, local DB bootstrap
src/lib/tires/          layout (1–20), thresholds, evaluation – pure, tested
src/lib/inspection/     submission schema + client draft model
src/lib/offline/        IndexedDB, image prep, outbox sync
src/lib/repos/          tenant-scoped data access
src/lib/db/             postgres client + RLS scope
src/lib/security/       crypto (AES-GCM), Turnstile, request helpers
src/lib/ai/             photo-analysis provider contract
src/i18n/               en / ro / ru / es messages + translator
src/components/tire/    TireDiagram, TireNode, AxleRow, TireSheet, PhotoCapture
src/components/inspection/  driver flow
src/components/report/  hosted HTML report
src/components/admin/   plain admin primitives, charts, heatmap, nav
src/lib/auth/           admin identity providers (Supabase Auth, dev) + session/tenant context
src/lib/repos/admin/    admin queries and audited mutations
src/app/admin/          admin app (route group (app) is auth-gated; /admin/login is public)
src/app/                routes (driver: /t/[tenant], report: /report/[id], APIs)
```

## Design source

The visual language is meant to follow the Claude Design project
`TireReport.dc.html` / `support.js`. That project could not be imported from
this environment (it requires an interactive `/design-login`); the current UI
is built from the specification and design tokens are isolated in
`src/app/globals.css` so the palette, radii and tire diagram styling can be
aligned to the design file in one place. Put the design files in `design/`
when available.
