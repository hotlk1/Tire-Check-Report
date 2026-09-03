import "server-only";
import type { Tx } from "@/lib/db/client";
import { DEFAULT_THRESHOLDS, validateThresholdConfig, type ThresholdConfig } from "@/lib/tires/thresholds";

export interface ThresholdVersionRow {
  id: string;
  tenant_id: string | null;
  version: number;
  config: ThresholdConfig;
  created_at: string;
}

/** The threshold version in effect for a tenant: newest tenant-specific, else newest system default. */
export async function activeThresholdVersion(tx: Tx, tenantId: string): Promise<ThresholdVersionRow> {
  const rows = await tx<ThresholdVersionRow[]>`
    select id, tenant_id, version, config, created_at
    from threshold_versions
    where tenant_id = ${tenantId} or tenant_id is null
    order by (tenant_id is not null) desc, version desc
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("No threshold version found – run scripts/seed.ts");
  const v = validateThresholdConfig(row.config, { statutory: false });
  return { ...row, config: v.ok ? v.config : DEFAULT_THRESHOLDS };
}
