import "server-only";
import type postgres from "postgres";
import type { Tx } from "@/lib/db/client";

export interface AuditInput {
  tenantId: string | null;
  actorUserId?: string | null;
  actorDriverId?: string | null;
  actorLabel?: string | null;
  action: "create" | "update" | "delete" | "restore" | "config" | "import" | "sync" | "login";
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

/** Append an audit record inside the caller's transaction (spec §13). */
export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  await tx`insert into audit_log (tenant_id, actor_user_id, actor_driver_id, actor_label, action, entity_type, entity_id, old_value, new_value, ip)
           values (${input.tenantId}, ${input.actorUserId ?? null}, ${input.actorDriverId ?? null}, ${input.actorLabel ?? null}, ${input.action},
                   ${input.entityType}, ${input.entityId ?? null},
                   ${input.oldValue === undefined ? null : tx.json(input.oldValue as postgres.JSONValue)},
                   ${input.newValue === undefined ? null : tx.json(input.newValue as postgres.JSONValue)}, ${input.ip ?? null})`;
}

/** Shallow diff helper so audit rows store only what changed. */
export function diffObjects<T extends Record<string, unknown>>(before: T, after: T): { old: Partial<T>; new: Partial<T> } {
  const old: Partial<T> = {};
  const next: Partial<T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      old[key] = before[key];
      next[key] = after[key];
    }
  }
  return { old, new: next };
}
