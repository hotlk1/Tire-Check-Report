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
  /** When the login role could bypass RLS (e.g. Supabase `postgres`), every transaction drops to app_user. */
  var __tc_set_role: string | null | undefined;
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

/**
 * RLS must be enforced for the role that runs application queries. If the
 * login role is a superuser or has bypassrls (Supabase's `postgres` role from
 * the Vercel integration), every scoped transaction switches to `app_user`
 * with SET LOCAL ROLE. If that is impossible, production refuses to run.
 */
async function ensureRlsEnforced(sql: Sql) {
  if (globalThis.__tc_rls_checked) return;
  const [row] = await sql<{ rolbypassrls: boolean; rolsuper: boolean; rolname: string }[]>`
    select rolname, rolbypassrls, rolsuper from pg_roles where rolname = current_user`;
  globalThis.__tc_set_role = null;
  if (row && (row.rolbypassrls || row.rolsuper)) {
    const [member] = await sql<{ ok: boolean }[]>`select pg_has_role(current_user, 'app_user', 'MEMBER') as ok`.catch(() => [{ ok: false }]);
    if (member?.ok) {
      globalThis.__tc_set_role = "app_user";
      console.info(`[db] login role "${row.rolname}" can bypass RLS; using SET LOCAL ROLE app_user per transaction`);
    } else {
      const msg = `DATABASE_URL role "${row.rolname}" can bypass RLS and is not a member of app_user. Tenant isolation is NOT enforced by the database (see supabase/README.md).`;
      if (env().NODE_ENV === "production") throw new Error(msg);
      console.warn(`[db] WARNING: ${msg}`);
    }
  }
  globalThis.__tc_rls_checked = true;
}

export async function withScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  await ensureRlsEnforced(sql);
  return sql.begin(async (tx) => {
    if (globalThis.__tc_set_role) await tx.unsafe(`set local role ${globalThis.__tc_set_role}`);
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
