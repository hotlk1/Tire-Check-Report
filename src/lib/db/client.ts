import "server-only";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { env } from "@/lib/env";

/**
 * Database access. All application queries run through `withScope`, which
 * opens a transaction and sets the session variables that RLS policies read
 * (see supabase/migrations/20260902000002_rls.sql). Nothing in the app is
 * allowed to query outside a scope, so tenant isolation is enforced by
 * Postgres rather than by UI filtering.
 */

export type Actor = "anon_lookup" | "driver" | "admin" | "editor" | "super_admin" | "system";

export interface Scope {
  actor: Actor;
  tenantId?: string | null;
  driverId?: string | null;
  userId?: string | null;
}

export type Tx = TransactionSql<Record<string, unknown>>;

declare global {
  var __tc_sql: Sql | undefined;
  var __tc_rls_checked: boolean | undefined;
}

export function getSql(): Sql {
  if (!globalThis.__tc_sql) {
    globalThis.__tc_sql = postgres(env().DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required for Supabase transaction pooler
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return globalThis.__tc_sql;
}

/** Warn loudly (once) if the connected role can bypass RLS – that defeats tenant isolation. */
async function assertRlsEnforced(sql: Sql) {
  if (globalThis.__tc_rls_checked) return;
  globalThis.__tc_rls_checked = true;
  try {
    const [row] = await sql<{ rolbypassrls: boolean; rolsuper: boolean; rolname: string }[]>`
      select rolname, rolbypassrls, rolsuper from pg_roles where rolname = current_user`;
    if (row && (row.rolbypassrls || row.rolsuper)) {
      const msg = `DATABASE_URL role "${row.rolname}" can bypass RLS. Tenant isolation is NOT enforced by the database. Use a role that is a member of app_user (see supabase/README.md).`;
      if (env().NODE_ENV === "production") throw new Error(msg);
      console.warn(`[db] WARNING: ${msg}`);
    }
  } catch (e) {
    if (env().NODE_ENV === "production") throw e;
  }
}

export async function withScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  await assertRlsEnforced(sql);
  return sql.begin(async (tx) => {
    await tx`select
      set_config('app.actor', ${scope.actor}, true),
      set_config('app.tenant_id', ${scope.tenantId ?? ""}, true),
      set_config('app.driver_id', ${scope.driverId ?? ""}, true),
      set_config('app.user_id', ${scope.userId ?? ""}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/** Rate limit via the security-definer function. Returns true when allowed. */
export async function rateLimitHit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const sql = getSql();
  const [row] = await sql<{ ok: boolean }[]>`select app.rate_limit_hit(${key}, ${limit}, ${windowSeconds}) as ok`;
  return row?.ok ?? false;
}
