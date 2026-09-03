import "server-only";
import { audit } from "@/lib/audit";
import { withScope, type Scope, type Tx } from "@/lib/db/client";
import type { InspectionLayout } from "@/lib/equipment/layout";

/**
 * Physical tires (TireAsset). A wheel position is a location; a TireAsset is
 * the tire occupying it. Every mount/unmount/move/status change appends a
 * tire_mount_events row — history is never overwritten.
 */
export type TireAssetState = "mounted" | "spare" | "unmounted" | "damaged" | "removed" | "disposed" | "lost";

export interface TireAssetRow {
  id: string;
  code: string;
  state: TireAssetState;
  serial: string | null;
  make: string | null;
  model: string | null;
  size: string | null;
  tire_variant_id: string | null;
  variant_label: string | null;
  current_asset_id: string | null;
  current_unit: string | null;
  current_asset_type: string | null;
  current_position_key: string | null;
  mounted_at: string | null;
  last_inspected_at: string | null;
  last_tread_32nds: number | null;
  last_psi: number | null;
  notes: string | null;
  created_at: string;
}

const SELECT = (tx: Tx) => tx`
  select ta.id, ta.code, ta.state, ta.serial, ta.make, ta.model, ta.size, ta.tire_variant_id,
         case when v.id is null then null else b.name || ' ' || m.name || ' ' || v.size end as variant_label,
         ta.current_asset_id, a.unit_number as current_unit, a.type::text as current_asset_type, ta.current_position_key, ta.mounted_at,
         ta.last_inspected_at, ta.last_tread_32nds, ta.last_psi::float8 as last_psi, ta.notes, ta.created_at
  from tire_assets ta
  left join assets a on a.id = ta.current_asset_id
  left join tire_variants v on v.id = ta.tire_variant_id left join tire_models m on m.id = v.model_id left join tire_brands b on b.id = v.brand_id`;

export async function listTireAssets(scope: Scope & { tenantId: string }, opts: { state?: TireAssetState | "all"; assetId?: string | null; q?: string; page?: number; pageSize?: number } = {}): Promise<{ rows: TireAssetRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(200, opts.pageSize ?? 50);
  const state = opts.state ?? "all";
  const q = (opts.q ?? "").trim();
  return withScope(scope, async (tx) => {
    const where = tx`ta.tenant_id = ${scope.tenantId}
      and (${state} = 'all' or ta.state::text = ${state})
      and (${opts.assetId ?? null}::uuid is null or ta.current_asset_id = ${opts.assetId ?? null})
      and (${q} = '' or ta.code ilike ${"%" + q + "%"} or ta.serial ilike ${"%" + q + "%"} or ta.make ilike ${"%" + q + "%"} or ta.model ilike ${"%" + q + "%"} or ta.size ilike ${"%" + q + "%"})`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from tire_assets ta where ${where}`;
    const rows = await tx<TireAssetRow[]>`${SELECT(tx)} where ${where} order by (ta.state in ('mounted','spare')) desc, a.unit_number, ta.current_position_key, ta.code limit ${size} offset ${(page - 1) * size}`;
    return { rows, total: count };
  });
}

export async function getTireAsset(scope: Scope & { tenantId: string }, id: string): Promise<TireAssetRow | null> {
  return withScope(scope, async (tx) => {
    const rows = await tx<TireAssetRow[]>`${SELECT(tx)} where ta.id = ${id} and ta.tenant_id = ${scope.tenantId}`;
    return rows[0] ?? null;
  });
}

export interface TireEventRow {
  id: number;
  event_type: string;
  unit_number: string | null;
  position_key: string | null;
  from_unit: string | null;
  from_position_key: string | null;
  from_state: string | null;
  to_state: string | null;
  inspection_id: string | null;
  actor_label: string | null;
  note: string | null;
  occurred_at: string;
}

export async function tireAssetEvents(scope: Scope & { tenantId: string }, id: string): Promise<TireEventRow[]> {
  return withScope(scope, (tx) =>
    tx<TireEventRow[]>`
      select e.id, e.event_type::text as event_type, a.unit_number, e.position_key, fa.unit_number as from_unit, e.from_position_key, e.from_state::text as from_state, e.to_state::text as to_state,
             e.inspection_id, e.actor_label, e.note, e.occurred_at
      from tire_mount_events e left join assets a on a.id = e.asset_id left join assets fa on fa.id = e.from_asset_id
      where e.tire_asset_id = ${id} and e.tenant_id = ${scope.tenantId} order by e.occurred_at desc, e.id desc limit 200`,
  );
}

export interface TireAssetInspectionRow {
  inspection_id: string;
  submitted_at: string;
  unit_number: string | null;
  tire_number: number;
  position_key: string | null;
  psi: number | null;
  tread_32nds: number | null;
  overall_status: string;
}

export async function tireAssetInspections(scope: Scope & { tenantId: string }, id: string): Promise<TireAssetInspectionRow[]> {
  return withScope(scope, (tx) =>
    tx<TireAssetInspectionRow[]>`
      select te.inspection_id, i.submitted_at, a.unit_number, te.tire_number, te.position_key, te.psi::float8 as psi, te.tread_32nds, te.overall_status::text as overall_status
      from tire_entries te join inspections i on i.id = te.inspection_id left join assets a on a.id = te.asset_id
      where te.tire_asset_id = ${id} and te.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos')
      order by i.submitted_at desc limit 100`,
  );
}

/** Tires mounted on an asset, by position key (without inspection slot). */
export async function mountedOn(tx: Tx, assetId: string): Promise<Map<string, { id: string; tire_variant_id: string | null; make: string | null; model: string | null; size: string | null }>> {
  const rows = await tx<{ id: string; current_position_key: string; tire_variant_id: string | null; make: string | null; model: string | null; size: string | null }[]>`
    select id, current_position_key, tire_variant_id, make, model, size from tire_assets
    where current_asset_id = ${assetId} and state in ('mounted', 'spare') and current_position_key is not null`;
  return new Map(rows.map((r) => [r.current_position_key, r]));
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Whether a reading's identity (variant, or make/model/size) matches the mounted tire's. Empty input never counts as different. */
export function sameTireIdentity(mounted: { tire_variant_id: string | null; make: string | null; model: string | null; size: string | null }, reading: { tireVariantId?: string | null; tireMake?: string | null; tireModel?: string | null; tireSize?: string | null }): boolean {
  const hasInput = !!reading.tireVariantId || !!norm(reading.tireMake) || !!norm(reading.tireModel) || !!norm(reading.tireSize);
  if (!hasInput) return true;
  if (reading.tireVariantId && mounted.tire_variant_id) return reading.tireVariantId === mounted.tire_variant_id;
  if (reading.tireVariantId || mounted.tire_variant_id) return false;
  return norm(mounted.make) === norm(reading.tireMake) && norm(mounted.model) === norm(reading.tireModel) && norm(mounted.size) === norm(reading.tireSize);
}

export interface ReconcileInput {
  inspectionId: string;
  layout: InspectionLayout;
  tires: { key: string; number: number; tireVariantId: string | null; tireMake: string | null; tireModel: string | null; tireSize: string | null; tireAssetId: string | null; tread32: number | null; psi: number | null; damage: "none" | "repairable" | "non_repairable" }[];
  actor: { driverId?: string | null; userId?: string | null; label: string };
  variantIds: Set<string>;
}

/**
 * Reconciles physical tire identity for every inspected position:
 *  - nothing mounted, identity entered → create a TireAsset and mount it
 *  - mounted tire, matching (or no) identity → keep it (make/model carry forward)
 *  - mounted tire, different identity → replace: old → unmounted, new → mounted
 * Returns the TireAsset id per position key so tire entries can link to it.
 */
export async function reconcileTireIdentity(tx: Tx, tenantId: string, input: ReconcileInput): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const byAsset = new Map<string, Awaited<ReturnType<typeof mountedOn>>>();
  const actorCols = { driver: input.actor.driverId ?? null, user: input.actor.userId ?? null, label: input.actor.label };
  for (const t of input.tires) {
    const pos = input.layout.positions.find((p) => p.key === t.key);
    if (!pos) continue;
    const component = input.layout.components.find((c) => c.slot === pos.slot);
    const assetId = component?.assetId;
    if (!assetId) continue;
    const localKey = t.key.slice(pos.slot.length + 1); // strip `${slot}/`
    if (!byAsset.has(assetId)) byAsset.set(assetId, await mountedOn(tx, assetId));
    const mounted = byAsset.get(assetId)!.get(localKey) ?? null;
    const state: TireAssetState = pos.isSpare ? "spare" : "mounted";
    const variantId = t.tireVariantId && input.variantIds.has(t.tireVariantId) ? t.tireVariantId : null;
    const identityGiven = !!variantId || !!norm(t.tireMake) || !!norm(t.tireModel) || !!norm(t.tireSize);

    let tireId: string | null = null;
    if (mounted && sameTireIdentity(mounted, { ...t, tireVariantId: variantId })) {
      tireId = mounted.id;
      await tx`update tire_assets set last_inspected_at = now(), last_tread_32nds = ${t.tread32}, last_psi = ${t.psi} where id = ${tireId}`;
    } else if (mounted || identityGiven) {
      if (mounted) {
        await tx`update tire_assets set state = 'unmounted', current_asset_id = null, current_position_key = null where id = ${mounted.id}`;
        await tx`insert into tire_mount_events (tenant_id, tire_asset_id, event_type, from_asset_id, from_position_key, from_state, to_state, inspection_id, actor_driver_id, actor_user_id, actor_label, note)
                 values (${tenantId}, ${mounted.id}, 'replace', ${assetId}, ${localKey}, ${mounted ? state : null}, 'unmounted', ${input.inspectionId}, ${actorCols.driver}, ${actorCols.user}, ${actorCols.label}, 'Different tire reported at this position during inspection')`;
      }
      const [created] = await tx<{ id: string }[]>`insert into tire_assets (tenant_id, make, model, size, tire_variant_id, state, current_asset_id, current_position_key, mounted_at, last_inspected_at, last_tread_32nds, last_psi)
        values (${tenantId}, ${t.tireMake}, ${t.tireModel}, ${t.tireSize}, ${variantId}, ${state}, ${assetId}, ${localKey}, now(), now(), ${t.tread32}, ${t.psi}) returning id`;
      tireId = created.id;
      await tx`insert into tire_mount_events (tenant_id, tire_asset_id, event_type, asset_id, position_key, to_state, inspection_id, actor_driver_id, actor_user_id, actor_label, note)
               values (${tenantId}, ${tireId}, 'mount', ${assetId}, ${localKey}, ${state}, ${input.inspectionId}, ${actorCols.driver}, ${actorCols.user}, ${actorCols.label}, ${mounted ? "Replacement recorded from inspection" : "First identified during inspection"})`;
      byAsset.get(assetId)!.set(localKey, { id: tireId, tire_variant_id: variantId, make: t.tireMake, model: t.tireModel, size: t.tireSize });
    }
    if (tireId) {
      out[t.key] = tireId;
      await tx`insert into tire_mount_events (tenant_id, tire_asset_id, event_type, asset_id, position_key, to_state, inspection_id, actor_driver_id, actor_user_id, actor_label)
               values (${tenantId}, ${tireId}, 'inspected', ${assetId}, ${localKey}, ${state}, ${input.inspectionId}, ${actorCols.driver}, ${actorCols.user}, ${actorCols.label})`;
      if (t.damage === "non_repairable") {
        await tx`update tire_assets set state = 'damaged' where id = ${tireId}`;
        await tx`insert into tire_mount_events (tenant_id, tire_asset_id, event_type, asset_id, position_key, from_state, to_state, inspection_id, actor_driver_id, actor_user_id, actor_label, note)
                 values (${tenantId}, ${tireId}, 'status', ${assetId}, ${localKey}, ${state}, 'damaged', ${input.inspectionId}, ${actorCols.driver}, ${actorCols.user}, ${actorCols.label}, 'Reported out of service during inspection')`;
      }
    }
  }
  return out;
}

type AdminScope = Scope & { tenantId: string; userId: string };

async function loadForUpdate(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx<{ id: string; code: string; state: TireAssetState; current_asset_id: string | null; current_position_key: string | null }[]>`
    select id, code, state, current_asset_id, current_position_key from tire_assets where id = ${id} and tenant_id = ${tenantId} for update`;
  if (!row) throw new Error("not_found");
  return row;
}

async function event(tx: Tx, tenantId: string, scope: AdminScope, actorLabel: string, e: { tireId: string; type: "mount" | "unmount" | "move" | "replace" | "status"; assetId?: string | null; positionKey?: string | null; fromAssetId?: string | null; fromPositionKey?: string | null; fromState?: TireAssetState | null; toState?: TireAssetState | null; note?: string | null }) {
  await tx`insert into tire_mount_events (tenant_id, tire_asset_id, event_type, asset_id, position_key, from_asset_id, from_position_key, from_state, to_state, actor_user_id, actor_label, note)
           values (${tenantId}, ${e.tireId}, ${e.type}, ${e.assetId ?? null}, ${e.positionKey ?? null}, ${e.fromAssetId ?? null}, ${e.fromPositionKey ?? null}, ${e.fromState ?? null}, ${e.toState ?? null}, ${scope.userId}, ${actorLabel}, ${e.note ?? null})`;
}

async function vacate(tx: Tx, tenantId: string, scope: AdminScope, actorLabel: string, assetId: string, positionKey: string, note: string) {
  const [occupant] = await tx<{ id: string; state: TireAssetState }[]>`select id, state from tire_assets where current_asset_id = ${assetId} and current_position_key = ${positionKey} and state in ('mounted', 'spare') for update`;
  if (!occupant) return null;
  await tx`update tire_assets set state = 'unmounted', current_asset_id = null, current_position_key = null where id = ${occupant.id}`;
  await event(tx, tenantId, scope, actorLabel, { tireId: occupant.id, type: "unmount", fromAssetId: assetId, fromPositionKey: positionKey, fromState: occupant.state, toState: "unmounted", note });
  return occupant.id;
}

/** Mounts a tire at a position (moving it if it was mounted elsewhere); the previous occupant becomes unmounted. */
export async function mountTire(scope: AdminScope, input: { tireId: string; assetId: string; positionKey: string; isSpare: boolean; note?: string | null }, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const tire = await loadForUpdate(tx, scope.tenantId, input.tireId);
    const [asset] = await tx<{ id: string }[]>`select id from assets where id = ${input.assetId} and tenant_id = ${scope.tenantId}`;
    if (!asset) throw new Error("asset_not_found");
    const displaced = await vacate(tx, scope.tenantId, scope, actorLabel, input.assetId, input.positionKey, `Displaced by ${tire.code}`);
    const toState: TireAssetState = input.isSpare ? "spare" : "mounted";
    await tx`update tire_assets set state = ${toState}, current_asset_id = ${input.assetId}, current_position_key = ${input.positionKey}, mounted_at = now(), retired_at = null where id = ${tire.id}`;
    await event(tx, scope.tenantId, scope, actorLabel, { tireId: tire.id, type: tire.current_asset_id ? "move" : "mount", assetId: input.assetId, positionKey: input.positionKey, fromAssetId: tire.current_asset_id, fromPositionKey: tire.current_position_key, fromState: tire.state, toState, note: input.note ?? null });
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_asset", entityId: tire.id, oldValue: { state: tire.state, asset_id: tire.current_asset_id, position: tire.current_position_key }, newValue: { state: toState, asset_id: input.assetId, position: input.positionKey, displaced } });
  });
}

/** Removes a tire from its position with a target state (unmounted / removed / damaged / disposed / lost). */
export async function setTireState(scope: AdminScope, input: { tireId: string; state: TireAssetState; note?: string | null }, actorLabel: string) {
  if (input.state === "mounted" || input.state === "spare") throw new Error("use mountTire");
  return withScope(scope, async (tx) => {
    const tire = await loadForUpdate(tx, scope.tenantId, input.tireId);
    const retired = input.state === "disposed" || input.state === "lost" || input.state === "removed";
    await tx`update tire_assets set state = ${input.state}, current_asset_id = null, current_position_key = null, retired_at = ${retired ? tx`now()` : null}, notes = coalesce(${input.note ?? null}, notes) where id = ${tire.id}`;
    await event(tx, scope.tenantId, scope, actorLabel, { tireId: tire.id, type: tire.current_asset_id ? "unmount" : "status", fromAssetId: tire.current_asset_id, fromPositionKey: tire.current_position_key, fromState: tire.state, toState: input.state, note: input.note ?? null });
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_asset", entityId: tire.id, oldValue: { state: tire.state, asset_id: tire.current_asset_id, position: tire.current_position_key }, newValue: { state: input.state, note: input.note ?? null } });
  });
}

/** Replaces the tire at a position with a brand-new physical tire (created here); the old one gets the given state. */
export async function replaceTire(scope: AdminScope, input: { assetId: string; positionKey: string; isSpare: boolean; oldState: TireAssetState; tire: { make: string | null; model: string | null; size: string | null; tireVariantId: string | null; serial: string | null }; note?: string | null }, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [asset] = await tx<{ id: string }[]>`select id from assets where id = ${input.assetId} and tenant_id = ${scope.tenantId}`;
    if (!asset) throw new Error("asset_not_found");
    const [old] = await tx<{ id: string; state: TireAssetState }[]>`select id, state from tire_assets where current_asset_id = ${input.assetId} and current_position_key = ${input.positionKey} and state in ('mounted', 'spare') for update`;
    if (old) {
      const retired = input.oldState === "disposed" || input.oldState === "lost" || input.oldState === "removed";
      await tx`update tire_assets set state = ${input.oldState}, current_asset_id = null, current_position_key = null, retired_at = ${retired ? tx`now()` : null} where id = ${old.id}`;
      await event(tx, scope.tenantId, scope, actorLabel, { tireId: old.id, type: "replace", fromAssetId: input.assetId, fromPositionKey: input.positionKey, fromState: old.state, toState: input.oldState, note: input.note ?? null });
    }
    const toState: TireAssetState = input.isSpare ? "spare" : "mounted";
    const [created] = await tx<{ id: string; code: string }[]>`insert into tire_assets (tenant_id, make, model, size, tire_variant_id, serial, state, current_asset_id, current_position_key, mounted_at)
      values (${scope.tenantId}, ${input.tire.make}, ${input.tire.model}, ${input.tire.size}, ${input.tire.tireVariantId}, ${input.tire.serial}, ${toState}, ${input.assetId}, ${input.positionKey}, now()) returning id, code`;
    await event(tx, scope.tenantId, scope, actorLabel, { tireId: created.id, type: "mount", assetId: input.assetId, positionKey: input.positionKey, toState, note: input.note ?? null });
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "tire_asset", entityId: created.id, oldValue: old ? { replaced: old.id, state: input.oldState } : null, newValue: { code: created.code, asset_id: input.assetId, position: input.positionKey, ...input.tire } });
    return created;
  });
}

/** Registers a physical tire that is not mounted anywhere (stock / spare inventory). */
export async function createUnmountedTire(scope: AdminScope, tire: { make: string | null; model: string | null; size: string | null; tireVariantId: string | null; serial: string | null; notes: string | null }, actorLabel: string) {
  return withScope(scope, async (tx) => {
    const [created] = await tx<{ id: string; code: string }[]>`insert into tire_assets (tenant_id, make, model, size, tire_variant_id, serial, notes, state)
      values (${scope.tenantId}, ${tire.make}, ${tire.model}, ${tire.size}, ${tire.tireVariantId}, ${tire.serial}, ${tire.notes}, 'unmounted') returning id, code`;
    await event(tx, scope.tenantId, scope, actorLabel, { tireId: created.id, type: "status", toState: "unmounted", note: "Registered" });
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "tire_asset", entityId: created.id, newValue: { code: created.code, ...tire } });
    return created;
  });
}
