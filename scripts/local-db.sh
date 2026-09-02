#!/usr/bin/env bash
# Creates the local development database + login role, then runs migrations
# and the dev seed. Requires a reachable Postgres superuser connection in
# PG_SUPER_URL (default: local Postgres on 54329 started for development).
set -euo pipefail
PG_SUPER_URL="${PG_SUPER_URL:-postgres://postgres@localhost:54329/postgres}"
DB_NAME="${DB_NAME:-tire_check}"

psql "$PG_SUPER_URL" -v ON_ERROR_STOP=1 <<SQL
select 'create database ${DB_NAME}' where not exists (select from pg_database where datname = '${DB_NAME}')\gexec
SQL

DB_URL="${PG_SUPER_URL%/*}/${DB_NAME}"
npx tsx scripts/migrate.ts "$DB_URL"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service login password 'app_service' nobypassrls in role app_user;
  end if;
end $$;
SQL

npx tsx scripts/seed.ts "$DB_URL" --dev
echo "Local database ready: postgres://app_service:app_service@localhost:54329/${DB_NAME}"
