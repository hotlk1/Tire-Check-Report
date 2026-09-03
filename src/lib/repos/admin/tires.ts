import "server-only";
import { withScope, type Scope } from "@/lib/db/client";

export interface TireEntryRow {
  id: string;
  inspection_id: string;
  submitted_at: string;
  unit_number: string | null;
  asset_id: string | null;
  tire_number: number;
  position_code: string;
  position_key: string | null;
  component_slot: string | null;
  tire_asset_id: string | null;
  tire_code: string | null;
  psi: number | null;
  tread_32nds: number | null;
  damage: "none" | "repairable" | "non_repairable";
  absent: boolean;
  overall_status: "none" | "green" | "yellow" | "red";
  driver_name: string | null;
  photos: number;
}

export interface TireFilters {
  status?: "red" | "yellow" | "green" | "issues" | "all";
  position?: number | null;
  /** Layout position key without the slot (e.g. `steer:L`, `drive-1:LO`). */
  positionKey?: string | null;
  assetId?: string | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
}

export async function listTireEntries(scope: Scope & { tenantId: string }, f: TireFilters = {}): Promise<{ rows: TireEntryRow[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const size = Math.min(200, f.pageSize ?? 50);
  const status = f.status ?? "all";
  return withScope(scope, async (tx) => {
    const where = tx`
      te.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos') and te.absent = false
      and (${f.position ?? null}::int is null or te.tire_number = ${f.position ?? null})
      and (${f.positionKey ?? null}::text is null or split_part(te.position_key, '/', 2) = ${f.positionKey ?? null})
      and (${f.assetId ?? null}::uuid is null or te.asset_id = ${f.assetId ?? null})
      and (${f.from ?? null}::timestamptz is null or i.submitted_at >= ${f.from ?? null})
      and (${f.to ?? null}::timestamptz is null or i.submitted_at < ${f.to ?? null})
      and (${status} = 'all' or (${status} = 'issues' and (te.overall_status in ('red','yellow') or te.damage <> 'none')) or te.overall_status::text = ${status})`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from tire_entries te join inspections i on i.id = te.inspection_id where ${where}`;
    const rows = await tx<TireEntryRow[]>`
      select te.id, te.inspection_id, i.submitted_at, a.unit_number, te.asset_id, te.tire_number, te.position_code, te.position_key, te.component_slot, te.tire_asset_id, ta.code as tire_code,
             te.psi::float8 as psi, te.tread_32nds, te.damage, te.absent, te.overall_status,
             d.full_name as driver_name, (select count(*)::int from photos p where p.tire_entry_id = te.id) as photos
      from tire_entries te join inspections i on i.id = te.inspection_id left join assets a on a.id = te.asset_id left join drivers d on d.id = i.driver_id left join tire_assets ta on ta.id = te.tire_asset_id
      where ${where} order by i.submitted_at desc, te.tire_number limit ${size} offset ${(page - 1) * size}`;
    return { rows, total: count };
  });
}
