import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, Scope } from "@/lib/db/client";
import { withScope } from "@/lib/db/client";
import { authProvider } from "./provider";

export const TENANT_COOKIE = "tc_tenant";

export type AdminRole = "super_admin" | "admin" | "editor";

export interface Membership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: AdminRole;
}

export interface AdminSession {
  user: { id: string; email: string; name: string | null; isSuperAdmin: boolean };
  memberships: Membership[];
  /** Tenant currently being administered (null only for super admins with no tenants at all). */
  tenant: { id: string; slug: string; name: string; settings: Record<string, unknown> } | null;
  /** Effective role within the current tenant. */
  role: AdminRole;
  /** RLS scope for data access within the current tenant. */
  scope: Scope & { tenantId: string; userId: string };
  authProvider: "supabase" | "dev";
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
}

/**
 * Resolves the signed-in admin/editor and their tenant context. Returns null
 * when nobody is signed in or the identity has no memberships (and is not a
 * super admin).
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const provider = authProvider();
  const identity = await provider.getIdentity();
  if (!identity) return null;

  const data = await withScope({ actor: "system", userId: identity.id }, async (tx) => {
    let [user] = await tx<UserRow[]>`select id, email, full_name, is_super_admin from users where id = ${identity.id}`;
    if (!user && provider.name === "supabase") {
      // First sign-in through Supabase Auth: create the profile row (memberships are granted by an admin).
      [user] = await tx<UserRow[]>`insert into users (id, email, full_name) values (${identity.id}, ${identity.email}, ${identity.name ?? null})
        on conflict (id) do update set email = excluded.email returning id, email, full_name, is_super_admin`;
    }
    if (!user) return null;
    const memberships = await tx<{ tenant_id: string; slug: string; name: string; role: AdminRole | "driver"; settings: Record<string, unknown> }[]>`
      select m.tenant_id, t.slug, t.name, m.role, t.settings from memberships m join tenants t on t.id = m.tenant_id
      where m.user_id = ${user.id} and t.status = 'active' order by t.name`;
    const allTenants = user.is_super_admin
      ? await tx<{ id: string; slug: string; name: string; settings: Record<string, unknown> }[]>`select id, slug, name, settings from tenants where status = 'active' order by name`
      : [];
    return { user, memberships, allTenants };
  });
  if (!data) return null;

  const memberships: Membership[] = data.memberships.map((m) => ({ tenantId: m.tenant_id, tenantSlug: m.slug, tenantName: m.name, role: m.role === "driver" ? "editor" : (m.role as AdminRole) }));
  const isSuper = data.user.is_super_admin;
  if (!isSuper && memberships.length === 0) return null;

  const store = await cookies();
  const wanted = store.get(TENANT_COOKIE)?.value;
  const candidates = isSuper ? data.allTenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name, settings: t.settings })) : data.memberships.map((m) => ({ id: m.tenant_id, slug: m.slug, name: m.name, settings: m.settings }));
  // Default: the cookie's tenant, else the first tenant the user is a member of, else the first available (super admins).
  const tenant = candidates.find((c) => c.slug === wanted) ?? candidates.find((c) => memberships.some((m) => m.tenantId === c.id)) ?? candidates[0] ?? null;
  const membershipRole = tenant ? memberships.find((m) => m.tenantId === tenant.id)?.role : undefined;
  const role: AdminRole = isSuper ? "super_admin" : (membershipRole ?? "editor");
  const actor: Actor = role;

  return {
    user: { id: data.user.id, email: data.user.email, name: data.user.full_name, isSuperAdmin: isSuper },
    memberships,
    tenant,
    role,
    scope: { actor, tenantId: tenant?.id ?? "", userId: data.user.id },
    authProvider: provider.name,
  };
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** Admin-only (not editor) gate for configuration screens. */
export function canConfigure(session: AdminSession): boolean {
  return session.role === "admin" || session.role === "super_admin";
}
