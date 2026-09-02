import "server-only";
import type postgres from "postgres";
import { withScope, type Scope } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { validateThresholdConfig, type ThresholdConfig } from "@/lib/tires/thresholds";

export interface ThresholdVersionListRow {
  id: string;
  tenant_id: string | null;
  version: number;
  config: ThresholdConfig;
  note: string | null;
  created_at: string;
  created_by_email: string | null;
  created_by_name: string | null;
}

export async function listThresholdVersions(scope: Scope & { tenantId: string }): Promise<ThresholdVersionListRow[]> {
  return withScope(scope, async (tx) =>
    tx<ThresholdVersionListRow[]>`
      select tv.id, tv.tenant_id, tv.version, tv.config, tv.note, tv.created_at, u.email as created_by_email, u.full_name as created_by_name
      from threshold_versions tv left join users u on u.id = tv.created_by
      where tv.tenant_id = ${scope.tenantId} or tv.tenant_id is null
      order by (tv.tenant_id is not null) desc, tv.version desc`,
  );
}

/** Publishes a new tenant-specific version. Immutable: previous versions stay untouched. */
export async function publishThresholdVersion(scope: Scope & { tenantId: string; userId: string }, config: unknown, note: string | null, actorLabel: string) {
  const v = validateThresholdConfig(config);
  if (!v.ok) throw new Error(v.error);
  return withScope(scope, async (tx) => {
    const [cur] = await tx<{ config: ThresholdConfig | null; version: number | null }[]>`
      select config, version from threshold_versions where tenant_id = ${scope.tenantId} order by version desc limit 1`;
    const [sys] = await tx<{ config: ThresholdConfig }[]>`select config from threshold_versions where tenant_id is null order by version desc limit 1`;
    const previous = cur?.config ?? sys?.config ?? null;
    const nextVersion = (cur?.version ?? 0) + 1;
    const [row] = await tx<{ id: string }[]>`insert into threshold_versions (tenant_id, version, config, note, created_by)
      values (${scope.tenantId}, ${nextVersion}, ${tx.json(v.config as unknown as postgres.JSONValue)}, ${note}, ${scope.userId}) returning id`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "config", entityType: "threshold_version", entityId: row.id, oldValue: previous, newValue: { version: nextVersion, note, ...v.config } });
    return { id: row.id, version: nextVersion };
  });
}

export async function updateTenantSettings(scope: Scope & { tenantId: string; userId: string }, patch: Record<string, unknown>, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<{ settings: Record<string, unknown> }[]>`select settings from tenants where id = ${scope.tenantId}`;
    const next = { ...(before?.settings ?? {}), ...patch };
    // Tenants are managed by super admins in RLS; tenant admins may only touch settings through this function.
    await tx`update tenants set settings = ${tx.json(next as postgres.JSONValue)} where id = ${scope.tenantId}`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "config", entityType: "tenant_settings", entityId: scope.tenantId, oldValue: before?.settings ?? {}, newValue: next });
  });
}
