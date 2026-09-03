import "server-only";
import type postgres from "postgres";
import { withScope, type Scope } from "@/lib/db/client";
import { audit, diffObjects } from "@/lib/audit";
import { evaluateInspection, type DamageStatus, type TireReading } from "@/lib/tires";
import { validateThresholdConfig, DEFAULT_THRESHOLDS } from "@/lib/tires/thresholds";
import { layoutOfRow, recomputeRequiredPhotos } from "@/lib/repos/inspections";

export interface ReportListRow {
  id: string;
  submitted_at: string;
  mode: "truck" | "trailer" | "truck_trailer" | "combination";
  status: "submitted" | "deleted" | "pending_photos";
  driver_name: string | null;
  driver_id: string | null;
  truck_unit: string | null;
  truck_id: string | null;
  trailer_unit: string | null;
  trailer_id: string | null;
  odometer: number | null;
  red: number;
  yellow: number;
  green: number;
  damaged: number;
  photos_uploaded: number;
  required_photos_missing: number;
  edited_at: string | null;
}

export interface ReportFilters {
  from?: Date | null;
  to?: Date | null;
  driverId?: string | null;
  assetId?: string | null;
  status?: "red" | "yellow" | "issues" | "all";
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listReports(scope: Scope & { tenantId: string }, f: ReportFilters = {}): Promise<{ rows: ReportListRow[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const size = Math.min(200, f.pageSize ?? 50);
  const status = f.status ?? "all";
  return withScope(scope, async (tx) => {
    const where = tx`
      i.tenant_id = ${scope.tenantId}
      and (${!!f.includeDeleted} or i.status in ('submitted', 'pending_photos'))
      and (${f.from ?? null}::timestamptz is null or i.submitted_at >= ${f.from ?? null})
      and (${f.to ?? null}::timestamptz is null or i.submitted_at < ${f.to ?? null})
      and (${f.driverId ?? null}::uuid is null or i.driver_id = ${f.driverId ?? null})
      and (${f.assetId ?? null}::uuid is null or i.truck_asset_id = ${f.assetId ?? null} or i.trailer_asset_id = ${f.assetId ?? null})
      and (${status} = 'all'
           or (${status} = 'red' and coalesce((i.summary->>'red')::int, 0) > 0)
           or (${status} = 'yellow' and coalesce((i.summary->>'yellow')::int, 0) > 0)
           or (${status} = 'issues' and (coalesce((i.summary->>'red')::int, 0) > 0 or coalesce((i.summary->>'yellow')::int, 0) > 0 or coalesce((i.summary->>'damaged')::int, 0) > 0)))`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from inspections i where ${where}`;
    const rows = await tx<ReportListRow[]>`
      select i.id, i.submitted_at, i.mode, d.full_name as driver_name, i.driver_id, tr.unit_number as truck_unit, i.truck_asset_id as truck_id,
             tl.unit_number as trailer_unit, i.trailer_asset_id as trailer_id, i.odometer::float8 as odometer,
             coalesce((i.summary->>'red')::int, 0) as red, coalesce((i.summary->>'yellow')::int, 0) as yellow, coalesce((i.summary->>'green')::int, 0) as green,
             coalesce((i.summary->>'damaged')::int, 0) as damaged, i.photos_uploaded, i.required_photos_missing, i.status, i.edited_at
      from inspections i left join drivers d on d.id = i.driver_id
      left join assets tr on tr.id = i.truck_asset_id left join assets tl on tl.id = i.trailer_asset_id
      where ${where}
      order by i.submitted_at desc limit ${size} offset ${(page - 1) * size}`;
    return { rows, total: count };
  });
}

export interface TireEdit {
  absent?: boolean;
  damageType?: string | null;
  psi?: number | null;
  tread32?: number | null;
  damage?: DamageStatus;
  notes?: string | null;
  tireMake?: string | null;
  tireModel?: string | null;
  tireSize?: string | null;
}

/**
 * Admin edit of one tire entry. Statuses are re-evaluated with the layout and
 * the rules version stored on the inspection (never the current ones), the
 * summary and photo completion are recomputed, and the change is audited
 * with old/new values.
 */
export async function updateTireEntry(scope: Scope & { tenantId: string; userId: string }, inspectionId: string, tireNumber: number, edit: TireEdit, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [insp] = await tx<{ id: string; mode: string; equipment: unknown; truck_asset_id: string | null; trailer_asset_id: string | null; status: string; config: unknown }[]>`
      select i.id, i.mode, i.equipment, i.truck_asset_id, i.trailer_asset_id, i.status, tv.config from inspections i join threshold_versions tv on tv.id = i.threshold_version_id
      where i.id = ${inspectionId} and i.tenant_id = ${scope.tenantId}`;
    if (!insp) throw new Error("not_found");
    const v = validateThresholdConfig(insp.config, { statutory: false });
    const config = v.ok ? v.config : DEFAULT_THRESHOLDS;
    const layout = layoutOfRow({ mode: insp.mode, equipment: insp.equipment, truck_id: insp.truck_asset_id, trailer_id: insp.trailer_asset_id });
    const pos = layout.positions.find((p) => p.number === tireNumber);
    if (!pos) throw new Error("position_not_in_layout");

    const entries = await tx<{ id: string; tire_number: number; psi: number | null; tread_32nds: number | null; damage: DamageStatus; damage_type: string | null; absent: boolean; notes: string | null; tire_make: string | null; tire_model: string | null; tire_size: string | null; photos: number }[]>`
      select te.id, te.tire_number, te.psi::float8 as psi, te.tread_32nds, te.damage, te.damage_type, te.absent, te.notes, te.tire_make, te.tire_model, te.tire_size,
             (select count(*)::int from photos p where p.tire_entry_id = te.id) as photos
      from tire_entries te where te.inspection_id = ${inspectionId}`;
    let target = entries.find((e) => e.tire_number === tireNumber);
    if (!target) {
      // Editing a tire that had no entry (e.g. an uninspected spare): create it.
      const assetId = layout.components.find((c) => c.slot === pos.slot)?.assetId ?? null;
      const [row] = await tx<{ id: string }[]>`insert into tire_entries (tenant_id, inspection_id, asset_id, tire_number, position_code, axle_key, component_slot, position_key)
        values (${scope.tenantId}, ${inspectionId}, ${assetId}, ${tireNumber}, ${pos.abbreviation}, ${pos.axleKey}, ${pos.slot}, ${pos.key}) returning id`;
      target = { id: row.id, tire_number: tireNumber, psi: null, tread_32nds: null, damage: "none", damage_type: null, absent: false, notes: null, tire_make: null, tire_model: null, tire_size: null, photos: 0 };
      entries.push(target);
    }
    const before = { psi: target.psi, tread32: target.tread_32nds, damage: target.damage, damageType: target.damage_type, absent: target.absent, notes: target.notes, tireMake: target.tire_make, tireModel: target.tire_model, tireSize: target.tire_size };
    const after = { ...before, ...Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined)) } as typeof before;

    const readings: Record<number, TireReading> = {};
    for (const e of entries) {
      const p = layout.positions.find((x) => x.number === e.tire_number);
      if (!p) continue;
      const isTarget = e.tire_number === tireNumber;
      readings[e.tire_number] = {
        key: p.key,
        number: e.tire_number,
        psi: isTarget ? after.psi : e.psi,
        tread32: isTarget ? after.tread32 : e.tread_32nds,
        damage: isTarget ? after.damage : e.damage,
        absent: isTarget ? after.absent : e.absent,
        photoCount: e.photos,
      };
    }
    const ev = evaluateInspection(layout, readings, config);
    const t = ev.tires[tireNumber];
    await tx`update tire_entries set psi = ${after.psi}, tread_32nds = ${after.tread32}, damage = ${after.damage}, damage_type = ${after.damage === "none" ? null : after.damageType}, absent = ${after.absent}, notes = ${after.notes},
      tire_make = ${after.tireMake}, tire_model = ${after.tireModel}, tire_size = ${after.tireSize},
      psi_status = ${t.psiStatus}, tread_status = ${t.treadStatus}, overall_status = ${t.overall}, photo_required = ${t.photoRequired} where id = ${target.id}`;
    for (const e of entries) {
      if (e.tire_number === tireNumber) continue;
      const s = ev.tires[e.tire_number];
      if (s) await tx`update tire_entries set psi_status = ${s.psiStatus}, tread_status = ${s.treadStatus}, overall_status = ${s.overall}, photo_required = ${s.photoRequired} where id = ${e.id}`;
    }
    const missing = await recomputeRequiredPhotos(tx, inspectionId);
    await tx`update inspections set summary = ${tx.json(ev.summary as unknown as postgres.JSONValue)}, edited_at = now(), edited_by = ${scope.userId},
      required_photos_missing = ${missing},
      status = case when status = 'pending_photos' and ${missing} = 0 then 'submitted'::app.inspection_status when status = 'submitted' and ${missing} > 0 then 'pending_photos'::app.inspection_status else status end,
      completed_at = case when ${missing} = 0 and completed_at is null then now() else completed_at end
      where id = ${inspectionId}`;
    const d = diffObjects(before as Record<string, unknown>, after as Record<string, unknown>);
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_entry", entityId: target.id, oldValue: { inspection_id: inspectionId, tire: tireNumber, ...d.old }, newValue: { inspection_id: inspectionId, tire: tireNumber, ...d.new } });
  });
}

export async function updateInspectionMeta(scope: Scope & { tenantId: string; userId: string }, inspectionId: string, edit: { odometer?: number | null; hubometer?: number | null; notes?: string | null }, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<{ odometer: number | null; hubometer: number | null; notes: string | null }[]>`select odometer::float8 as odometer, hubometer::float8 as hubometer, notes from inspections where id = ${inspectionId} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new Error("not_found");
    const after = { ...before, ...Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined)) } as typeof before;
    await tx`update inspections set odometer = ${after.odometer}, hubometer = ${after.hubometer}, notes = ${after.notes}, edited_at = now(), edited_by = ${scope.userId} where id = ${inspectionId}`;
    const d = diffObjects(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    if (Object.keys(d.new).length) {
      await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "inspection", entityId: inspectionId, oldValue: d.old, newValue: d.new });
    }
  });
}

export async function setInspectionDeleted(scope: Scope & { tenantId: string; userId: string }, inspectionId: string, deleted: boolean, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [before] = await tx<{ status: string }[]>`select status from inspections where id = ${inspectionId} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new Error("not_found");
    if (deleted) {
      await tx`update inspections set status = 'deleted', deleted_at = now(), deleted_by = ${scope.userId} where id = ${inspectionId}`;
    } else {
      await tx`update inspections set status = 'submitted', deleted_at = null, deleted_by = null where id = ${inspectionId}`;
    }
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: deleted ? "delete" : "restore", entityType: "inspection", entityId: inspectionId, oldValue: { status: before.status }, newValue: { status: deleted ? "deleted" : "submitted" } });
  });
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_label: string | null;
  actor_user_id: string | null;
  actor_driver_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
}

export async function inspectionAudit(scope: Scope & { tenantId: string }, inspectionId: string): Promise<AuditRow[]> {
  return withScope(scope, async (tx) =>
    tx<AuditRow[]>`select id, created_at, actor_label, actor_user_id, actor_driver_id, action, entity_type, entity_id, old_value, new_value
      from audit_log where tenant_id = ${scope.tenantId} and (
        (entity_type = 'inspection' and entity_id = ${inspectionId})
        or (entity_type = 'tire_entry' and (old_value->>'inspection_id' = ${inspectionId} or new_value->>'inspection_id' = ${inspectionId})))
      order by created_at desc limit 200`,
  );
}

export async function listAudit(scope: Scope & { tenantId: string }, opts: { page?: number; pageSize?: number; entityType?: string | null } = {}): Promise<{ rows: AuditRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(200, opts.pageSize ?? 50);
  return withScope(scope, async (tx) => {
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from audit_log where tenant_id = ${scope.tenantId} and (${opts.entityType ?? null}::text is null or entity_type = ${opts.entityType ?? null})`;
    const rows = await tx<AuditRow[]>`select id, created_at, actor_label, actor_user_id, actor_driver_id, action, entity_type, entity_id, old_value, new_value
      from audit_log where tenant_id = ${scope.tenantId} and (${opts.entityType ?? null}::text is null or entity_type = ${opts.entityType ?? null})
      order by created_at desc limit ${size} offset ${(page - 1) * size}`;
    return { rows, total: count };
  });
}
