/**
 * Minimal SQL migration runner: applies supabase/migrations/*.sql in name order
 * and records them in app.schema_migrations. Idempotent.
 *
 *   npx tsx scripts/migrate.ts [DATABASE_URL]
 *
 * Must run as a role that can create extensions/types/policies (postgres).
 * Compatible with `supabase db push` (same folder/naming), which keeps its own
 * bookkeeping in supabase_migrations.schema_migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.argv[2] ?? process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Usage: tsx scripts/migrate.ts <DATABASE_URL>");
  process.exit(1);
}

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  await sql`create schema if not exists app`;
  await sql`create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from app.schema_migrations`).map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`applying ${file} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into app.schema_migrations(name) values (${file})`;
    });
    console.log("ok");
  }
  console.log(`migrations up to date (${files.length} total)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
