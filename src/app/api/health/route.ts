import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { env, tier } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment health. Reports only presence booleans and non-secret facts so it
 * can be read by anyone verifying an environment; never echoes values.
 */
export async function GET() {
  const checks: Record<string, unknown> = { node: process.version, vercelEnv: process.env.VERCEL_ENV ?? null, gitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null };
  try {
    const e = env();
    checks.tier = tier();
    checks.config = {
      database: !!e.DATABASE_URL,
      databaseSource: process.env.DATABASE_URL ? "DATABASE_URL" : process.env.POSTGRES_URL ? "POSTGRES_URL" : process.env.POSTGRES_PRISMA_URL ? "POSTGRES_PRISMA_URL" : null,
      supabaseUrl: !!e.NEXT_PUBLIC_SUPABASE_URL,
      supabasePublishableKey: !!e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseSecretKey: !!e.SUPABASE_SECRET_KEY,
      secretKeySource: process.env.SUPABASE_SECRET_KEY ? "SUPABASE_SECRET_KEY" : process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      turnstile: !!e.TURNSTILE_SECRET_KEY,
      encryptionKey: !!e.APP_ENCRYPTION_KEY,
      driverSessionSecret: !!e.DRIVER_SESSION_SECRET,
    };
  } catch (err) {
    checks.config = { error: err instanceof Error ? err.message : "invalid" };
  }
  try {
    const sql = getSql();
    const [row] = await sql<{ role: string; bypass: boolean; migrations: number; tenants: number }[]>`
      select current_user as role, (select rolbypassrls or rolsuper from pg_roles where rolname = current_user) as bypass,
             (select count(*)::int from app.schema_migrations) as migrations, (select count(*)::int from tenants) as tenants`;
    checks.database = { ok: true, loginRole: row.role, loginRoleCanBypassRls: row.bypass, migrations: row.migrations, tenantsVisibleUnscoped: row.tenants };
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "failed" };
  }
  const ok = (checks.database as { ok: boolean }).ok && !("error" in (checks.config as object));
  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 503 });
}
