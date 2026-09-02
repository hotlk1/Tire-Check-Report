import "server-only";
import { withScope, type Scope } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { authProvider } from "@/lib/auth/provider";

export interface TenantUser {
  user_id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  role: "super_admin" | "admin" | "editor" | "driver";
  membership_id: string;
  created_at: string;
}

/** Development login only: resolve any seeded user by email (system scope). */
export async function findUserByEmailUnscoped(email: string) {
  return withScope({ actor: "super_admin" }, async (tx) => {
    const rows = await tx<{ id: string; email: string; full_name: string | null }[]>`select id, email, full_name from users where email = ${email.toLowerCase()} limit 1`;
    return rows[0] ?? null;
  });
}

export async function listDevUsers() {
  return withScope({ actor: "super_admin" }, async (tx) =>
    tx<{ id: string; email: string; full_name: string | null; is_super_admin: boolean }[]>`select id, email, full_name, is_super_admin from users order by email limit 50`,
  );
}

export async function listTenantUsers(scope: Scope & { tenantId: string }): Promise<TenantUser[]> {
  return withScope(scope, async (tx) =>
    tx<TenantUser[]>`
      select u.id as user_id, u.email, u.full_name, u.is_super_admin, m.role, m.id as membership_id, m.created_at
      from memberships m join users u on u.id = m.user_id
      where m.tenant_id = ${scope.tenantId} order by u.email`,
  );
}

export async function inviteUser(scope: Scope & { tenantId: string; userId: string }, input: { email: string; role: "admin" | "editor"; actorLabel: string }) {
  const email = input.email.trim().toLowerCase();
  const identity = await authProvider().inviteUser(email);
  return withScope({ ...scope, actor: "system" }, async (tx) => {
    await tx`insert into users (id, email) values (${identity.id}, ${email}) on conflict (id) do update set email = excluded.email`;
    const [m] = await tx<{ id: string }[]>`insert into memberships (tenant_id, user_id, role) values (${scope.tenantId}, ${identity.id}, ${input.role})
      on conflict (tenant_id, user_id) do update set role = excluded.role returning id`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel: input.actorLabel, action: "create", entityType: "membership", entityId: m.id, newValue: { email, role: input.role } });
    return { userId: identity.id };
  });
}

export async function setUserRole(scope: Scope & { tenantId: string; userId: string }, input: { membershipId: string; role: "admin" | "editor"; actorLabel: string }) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<{ role: string; user_id: string }[]>`select role, user_id from memberships where id = ${input.membershipId} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new Error("not_found");
    await tx`update memberships set role = ${input.role} where id = ${input.membershipId} and tenant_id = ${scope.tenantId}`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel: input.actorLabel, action: "update", entityType: "membership", entityId: input.membershipId, oldValue: { role: before.role }, newValue: { role: input.role } });
  });
}

export async function removeMembership(scope: Scope & { tenantId: string; userId: string }, input: { membershipId: string; actorLabel: string }) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<{ role: string; user_id: string }[]>`select role, user_id from memberships where id = ${input.membershipId} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new Error("not_found");
    if (before.user_id === scope.userId) throw new Error("cannot_remove_self");
    await tx`delete from memberships where id = ${input.membershipId} and tenant_id = ${scope.tenantId}`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel: input.actorLabel, action: "delete", entityType: "membership", entityId: input.membershipId, oldValue: before });
  });
}
