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

## Branches and environments

| Branch | Purpose | Deploys to |
| --- | --- | --- |
| `main` | Reserved for the future production application | (nothing yet) |
| `staging` | Stable testing branch; feature branches merge here when ready to test | Vercel project `tire-check-staging`, whose **Production** environment is our staging (Production Branch = `staging`), connected only to the Supabase project `tire-check-staging` via the Supabase integration |
| `claude/…`, feature branches | Work in progress | Vercel previews of `tire-check-staging` (no database variables; only useful for build checks) |

`staging` is a **stable user-test environment**, not a development branch: work happens on
feature branches (local dev, migrations and automated tests first), and only fully tested
checkpoints are merged into `staging`, with any required migration applied to the staging
database in the same coordinated step. Schema changes must be backward-compatible with the
version currently deployed. The automated staging smoke test uses its own driver
(`5550009999`, truck `E2E-100`, trailer `E2E-500`) so manual testers' data is never touched.

The app never treats a `staging`-branch deployment as the production tier (see `APP_ENV`
derivation in `src/lib/env.ts`), so CAPTCHA may be absent there with a logged warning.
`/api/health` reports which integration variables a deployment received (names only) and
the canonical origin.

### Canonical origin and Supabase Auth URLs

Production deployments answer on several Vercel aliases; `src/proxy.ts` redirects every
alias to the project's production URL (`VERCEL_PROJECT_PRODUCTION_URL`, or
`NEXT_PUBLIC_APP_URL` when set) so cookies and the magic-link PKCE verifier always live on
one host. In the Supabase dashboard (Authentication → URL Configuration) set the Site URL to
that origin and add the redirect URLs `https://<origin>/auth/callback`,
`https://*-<team-slug>.vercel.app/**` (previews) and `http://localhost:3000/**`. If a
redirect is ever not allowed, Supabase falls back to the Site URL and the proxy routes the
`?code=` it delivers into `/auth/callback` on the same host.

## Equipment configuration, physical tires and rules

**Equipment configuration.** Tire positions are no longer a fixed 1–20 list. Every asset
(truck, trailer, jeep, dolly, booster) carries a versioned configuration
(`asset_configurations`: ordered axles with role and single/dual/super-single wheels,
plus any number of spare slots). Assets without one use the built-in default template
for their kind (standard tractor, 2-axle trailer, …); admins publish a configuration on
the asset page (Trucks / Trailers / Equipment) from a template plus edits. Built-in
templates live in `src/lib/equipment/templates.ts`. An inspection covers one or more
components (Truck / Trailer / Truck + Trailer, plus "Add equipment" for jeep, dolly,
booster or a second trailer); its numbered layout is built in road order by
`src/lib/equipment/layout.ts` and stored on the inspection (`inspections.equipment`), so
reports never renumber when equipment is reconfigured. Readings are keyed by layout
position (`truck/drive-1:LO`); the tire number is a display label. Inspections submitted
before this model existed have no snapshot and render with the legacy 20-position layout.

**Physical tires.** A wheel position is a location; a `tire_assets` row is the tire
occupying it (internal id `T000123` until serial/QR workflows exist), with a lifecycle
state (mounted, spare, unmounted, damaged, removed, disposed, lost) and an append-only
history in `tire_mount_events`. At submission the server reconciles identity per
position: a mounted tire with matching (or no) brand/model/size input carries forward,
a different tire recorded at the position replaces it, a first-time identity creates
the tire. Admins replace, move, remove and mark tires from the asset page or
Tires → Physical tires.

**Rules (thresholds + photo policy).** System defaults are the `threshold_versions` row
with tenant_id NULL; a tenant override is a new tenant row published from Settings. The
document (schema 2) holds PSI and tread green/yellow/red rules per class (steer, drive,
trailer/non-steer, spare), the axle comparison limits and the photo policy (damaged
repairable, damaged/OOS, yellow/red tread, yellow/red PSI). Red tread limits cannot go
below the statutory minimum (steer 4/32, others 2/32). Every inspection stores the
version that classified it. Absolute input sanity limits (`INPUT_LIMITS`) are separate
from thresholds; readings above a tire's known original tread or max cold PSI ask the
driver to confirm.

**Photo enforcement.** The phone names every missing input on Save and keeps the tire a
draft; the server re-evaluates with the tenant's active rules and rejects a submission
that lacks a required photo. A submission that claims a photo id is stored as
`pending_photos` until the upload arrives, then becomes `submitted`. System defaults
(rules v3): photo mandatory for damage / OOS and when tread is under 3/32 on steer or
5/32 elsewhere, independent of the colour thresholds; PSI has a high yellow band so a hot
tire is a warning, not out of service (steer green 105–110, yellow to 125; others green
100–105, yellow to 120).

**Driver conveniences.** The equipment step shows who is inspecting ("Continuing as …",
Change driver) and pre-selects the equipment used last time on that device (always shown,
always changeable). A tire whose brand/model/size differs from the recorded one asks
"Is this a different physical tire?" (replace vs correct the record). Spares are optional;
the driver can add spare slots for one inspection. Feedback (1–5 + text) is stored in
`driver_feedback` for later admin review.

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

