import "server-only";
import { withScope, type Scope } from "@/lib/db/client";
import { audit, diffObjects } from "@/lib/audit";
import type { ComponentKind } from "@/lib/equipment/types";

export interface AssetListRow {
  id: string;
  type: ComponentKind;
  unit_number: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  status: "active" | "inactive";
  source: "manual" | "telematics" | "import";
  last_odometer: number | null;
  last_inspection_at: string | null;
  last_red: number | null;
  last_yellow: number | null;
  inspections_count: number;
}

export interface AssetInput {
  unit_number: string;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  license_plate?: string | null;
  status: "active" | "inactive";
}

export async function listAssets(scope: Scope & { tenantId: string }, type: ComponentKind, opts: { q?: string; status?: "active" | "inactive" | "all"; due?: boolean; dueDays?: number } = {}): Promise<AssetListRow[]> {
  const q = (opts.q ?? "").trim();
  const status = opts.status ?? "all";
  const dueDays = opts.dueDays ?? 7;
  return withScope(scope, async (tx) =>
    tx<AssetListRow[]>`
      with last as (
        select distinct on (ic.asset_id) ic.asset_id, i.submitted_at, (i.summary->>'red')::int as red, (i.summary->>'yellow')::int as yellow
        from inspection_components ic join inspections i on i.id = ic.inspection_id
        where i.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos') and ic.asset_id is not null
        order by ic.asset_id, i.submitted_at desc
      ), cnt as (
        select ic.asset_id, count(*)::int as n from inspection_components ic join inspections i on i.id = ic.inspection_id
        where i.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos') group by 1
      )
      select a.id, a.type, a.unit_number, a.vin, a.make, a.model, a.year, a.license_plate, a.status, a.source, a.last_odometer::float8 as last_odometer,
             l.submitted_at as last_inspection_at, l.red as last_red, l.yellow as last_yellow, coalesce(c.n, 0) as inspections_count
      from assets a left join last l on l.asset_id = a.id left join cnt c on c.asset_id = a.id
      where a.tenant_id = ${scope.tenantId} and a.type = ${type}
        and (${status} = 'all' or a.status::text = ${status})
        and (${q} = '' or a.unit_number ilike ${"%" + q + "%"} or a.vin ilike ${"%" + q + "%"} or a.license_plate ilike ${"%" + q + "%"})
        and (${!opts.due} or (a.status = 'active' and (l.submitted_at is null or l.submitted_at < now() - make_interval(days => ${dueDays}))))
      order by a.status, a.unit_number`,
  );
}

export async function getAsset(scope: Scope & { tenantId: string }, id: string) {
  return withScope(scope, async (tx) => {
    const rows = await tx<AssetListRow[]>`select id, type, unit_number, vin, make, model, year, license_plate, status, source, last_odometer::float8 as last_odometer,
      null::timestamptz as last_inspection_at, null::int as last_red, null::int as last_yellow, 0 as inspections_count from assets where id = ${id} and tenant_id = ${scope.tenantId}`;
    return rows[0] ?? null;
  });
}

export async function createAsset(scope: Scope & { tenantId: string; userId: string }, type: ComponentKind, input: AssetInput, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [row] = await tx<{ id: string }[]>`insert into assets (tenant_id, type, unit_number, vin, make, model, year, license_plate, status, source)
      values (${scope.tenantId}, ${type}, ${input.unit_number.trim()}, ${input.vin || null}, ${input.make || null}, ${input.model || null}, ${input.year ?? null}, ${input.license_plate || null}, ${input.status}, 'manual') returning id`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: type, entityId: row.id, newValue: input });
    return row.id;
  });
}

export async function updateAsset(scope: Scope & { tenantId: string; userId: string }, id: string, input: Partial<AssetInput>, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<Record<string, unknown>[]>`select type, unit_number, vin, make, model, year, license_plate, status from assets where id = ${id} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new Error("not_found");
    const after = {
      unit_number: input.unit_number?.trim() ?? before.unit_number,
      vin: input.vin === undefined ? before.vin : input.vin || null,
      make: input.make === undefined ? before.make : input.make || null,
      model: input.model === undefined ? before.model : input.model || null,
      year: input.year === undefined ? before.year : input.year,
      license_plate: input.license_plate === undefined ? before.license_plate : input.license_plate || null,
      status: input.status ?? before.status,
    } as Record<string, unknown>;
    await tx`update assets set unit_number = ${after.unit_number as string}, vin = ${after.vin as string | null}, make = ${after.make as string | null}, model = ${after.model as string | null},
      year = ${after.year as number | null}, license_plate = ${after.license_plate as string | null}, status = ${after.status as "active" | "inactive"} where id = ${id} and tenant_id = ${scope.tenantId}`;
    const { type, ...b } = before;
    const d = diffObjects(b, after);
    if (Object.keys(d.new).length) {
      await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: type as string, entityId: id, oldValue: d.old, newValue: d.new });
    }
  });
}

export interface AssetInspectionRow {
  id: string;
  submitted_at: string;
  driver_name: string | null;
  odometer: number | null;
  hubometer: number | null;
  red: number;
  yellow: number;
  green: number;
  damaged: number;
  edited_at: string | null;
  other_unit: string | null;
}

export async function assetInspections(scope: Scope & { tenantId: string }, assetId: string, limit = 50): Promise<AssetInspectionRow[]> {
  return withScope(scope, async (tx) =>
    tx<AssetInspectionRow[]>`
      select i.id, i.submitted_at, d.full_name as driver_name, i.odometer::float8 as odometer, i.hubometer::float8 as hubometer,
             coalesce((i.summary->>'red')::int, 0) as red, coalesce((i.summary->>'yellow')::int, 0) as yellow, coalesce((i.summary->>'green')::int, 0) as green,
             coalesce((i.summary->>'damaged')::int, 0) as damaged, i.edited_at,
             case when i.truck_asset_id = ${assetId} then tl.unit_number else tr.unit_number end as other_unit
      from inspections i left join drivers d on d.id = i.driver_id
      left join assets tr on tr.id = i.truck_asset_id left join assets tl on tl.id = i.trailer_asset_id
      where i.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos') and exists (select 1 from inspection_components ic where ic.inspection_id = i.id and ic.asset_id = ${assetId})
      order by i.submitted_at desc limit ${limit}`,
  );
}

export interface PositionSeries {
  tire_number: number;
  position_key: string | null;
  points: { submitted_at: string; tread_32nds: number | null; psi: number | null; overall_status: string }[];
}

/** Per-position tread/PSI over time for an asset (newest last). */
export async function assetPositionSeries(scope: Scope & { tenantId: string }, assetId: string, limit = 12): Promise<PositionSeries[]> {
  return withScope(scope, async (tx) => {
    const rows = await tx<{ tire_number: number; position_key: string | null; submitted_at: string; tread_32nds: number | null; psi: number | null; overall_status: string }[]>`
      select * from (
        select te.tire_number, split_part(te.position_key, '/', 2) as position_key, i.submitted_at, te.tread_32nds, te.psi::float8 as psi, te.overall_status,
               row_number() over (partition by split_part(te.position_key, '/', 2) order by i.submitted_at desc) as rn
        from tire_entries te join inspections i on i.id = te.inspection_id
        where te.asset_id = ${assetId} and i.status in ('submitted', 'pending_photos')
      ) x where rn <= ${limit} order by tire_number, submitted_at`;
    const map = new Map<string, PositionSeries>();
    for (const r of rows) {
      const k = r.position_key ?? String(r.tire_number);
      const s = map.get(k) ?? { tire_number: r.tire_number, position_key: r.position_key, points: [] };
      s.points.push({ submitted_at: r.submitted_at, tread_32nds: r.tread_32nds, psi: r.psi, overall_status: r.overall_status });
      map.set(k, s);
    }
    return [...map.values()];
  });
}
