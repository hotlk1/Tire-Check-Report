import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { withScope, type Scope, type Tx } from "@/lib/db/client";
import { buildLayout, isInspectionLayout, legacyLayout, modeOf, type InspectionLayout } from "@/lib/equipment/layout";
import type { InspectionSubmission } from "@/lib/inspection/schema";
import { storage } from "@/lib/storage";
import { blockingIssues, evaluateInspection, type BlockingIssue, type TireReading } from "@/lib/tires";
import type { ThresholdConfig } from "@/lib/tires/thresholds";
import { resolveComponents } from "./equipment";
import { activeThresholdVersion } from "./thresholds";
import { reconcileTireIdentity } from "./tire-assets";

export interface CreateInspectionResult {
  inspectionId: string;
  created: boolean;
  tireEntryIds: Record<number, string>;
  photosExpected: number;
  /** Photos the policy requires that are not uploaded yet: the inspection stays `pending_photos` until they arrive. */
  requiredPhotosMissing: number;
}

export class SubmissionRejected extends Error {
  constructor(
    public readonly code: "validation" | "asset_not_found" | "not_ready",
    public readonly issues: BlockingIssue[] = [],
    message?: string,
  ) {
    super(message ?? code);
  }
}

function readingsFrom(sub: InspectionSubmission, layout: InspectionLayout): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const t of sub.tires) {
    const pos = layout.positions.find((p) => p.key === t.key);
    if (!pos) throw new SubmissionRejected("validation", [], `position ${t.key} is not part of this equipment`);
    out[pos.number] = {
      key: pos.key,
      number: pos.number,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      photoCount: t.photoClientIds.length,
      absent: !!t.absent && pos.isSpare,
      tireMake: t.tireMake ?? null,
      tireModel: t.tireModel ?? null,
      tireSize: t.tireSize ?? null,
      tireVariantId: t.tireVariantId ?? null,
      tireAssetId: t.tireAssetId ?? null,
      notes: t.notes ?? null,
    };
  }
  return out;
}

/**
 * Creates the inspection, its components and tire entries in one transaction.
 * Idempotent on (tenant_id, client_draft_id): a retry from the offline outbox
 * returns the existing record instead of duplicating it.
 *
 * The layout is rebuilt server side from the assets' current configurations
 * and the rules (thresholds + photo policy) are the tenant's active version:
 * a direct API call cannot bypass either. Tires whose policy requires a photo
 * keep the inspection in `pending_photos` until the upload arrives.
 */
export async function createInspection(scope: Scope & { actor: "driver"; tenantId: string; driverId: string }, sub: InspectionSubmission, meta: { ip?: string | null; driverName: string }): Promise<CreateInspectionResult> {
  return withScope(scope, async (tx) => {
    const existing = await tx<{ id: string; photos_expected: number; required_photos_missing: number }[]>`
      select id, photos_expected, required_photos_missing from inspections where tenant_id = ${scope.tenantId} and client_draft_id = ${sub.clientDraftId}`;
    if (existing[0]) {
      const entries = await tx<{ id: string; tire_number: number }[]>`select id, tire_number from tire_entries where inspection_id = ${existing[0].id}`;
      return { inspectionId: existing[0].id, created: false, tireEntryIds: Object.fromEntries(entries.map((e) => [e.tire_number, e.id])), photosExpected: existing[0].photos_expected, requiredPhotosMissing: existing[0].required_photos_missing };
    }

    const resolved = await resolveComponents(tx, scope.tenantId, sub.components);
    if (!resolved.ok) throw new SubmissionRejected("asset_not_found", [{ kind: "asset_required", slot: resolved.slot }], `${resolved.reason} for ${resolved.slot}`);
    const layout = buildLayout(resolved.components);
    const readings = readingsFrom(sub, layout);
    const threshold = await activeThresholdVersion(tx, scope.tenantId);
    const issues = blockingIssues({ layout, odometer: sub.odometer ?? null, readings, config: threshold.config });
    if (issues.length) throw new SubmissionRejected("not_ready", issues);

    const evaluation = evaluateInspection(layout, readings, threshold.config);
    const photosExpected = sub.tires.reduce((n, t) => n + t.photoClientIds.length, 0);
    const requiredPhotosMissing = layout.positions.filter((p) => evaluation.tires[p.number]?.photoRequired).length;
    const truck = layout.components.find((c) => c.slot === "truck");
    const trailer = layout.components.find((c) => c.slot === "trailer");
    const mode = modeOf(layout);

    const [ins] = await tx<{ id: string }[]>`
      insert into inspections (tenant_id, driver_id, mode, truck_asset_id, trailer_asset_id, odometer, hubometer,
                               threshold_version_id, client_draft_id, started_at, location, notes, summary, photos_expected, context,
                               equipment, status, required_photos_missing, completed_at)
      values (${scope.tenantId}, ${scope.driverId}, ${mode}, ${truck?.assetId ?? null}, ${trailer?.assetId ?? null},
              ${sub.odometer ?? null}, ${sub.hubometer ?? null}, ${threshold.id}, ${sub.clientDraftId},
              ${sub.startedAt ?? null}, ${sub.location ? tx.json(sub.location) : null}, ${sub.notes ?? null},
              ${tx.json(evaluation.summary as unknown as postgres.JSONValue)}, ${photosExpected},
              ${tx.json({ client: sub.client ?? {}, ip: meta.ip ?? null })},
              ${tx.json(layout as unknown as postgres.JSONValue)}, ${requiredPhotosMissing > 0 ? "pending_photos" : "submitted"}, ${requiredPhotosMissing},
              ${requiredPhotosMissing > 0 ? null : tx`now()`})
      returning id`;

    for (const [i, c] of layout.components.entries()) {
      await tx`insert into inspection_components (tenant_id, inspection_id, slot, asset_id, configuration_id, position) values (${scope.tenantId}, ${ins.id}, ${c.slot}, ${c.assetId}, ${c.configurationId}, ${i})`;
    }

    // Catalog variants are optional; unknown / invisible ids fall back to the free-text make/model/size.
    const wanted = sub.tires.map((t) => t.tireVariantId).filter((v): v is string => !!v);
    const variantIds = new Set(wanted.length ? (await tx<{ id: string }[]>`select id from tire_variants where id in ${tx(wanted)}`).map((r) => r.id) : []);

    // Physical tire identity: carry forward, create or replace per position.
    const tireIds = await reconcileTireIdentity(tx, scope.tenantId, {
      inspectionId: ins.id,
      layout,
      tires: sub.tires.map((t) => ({ key: t.key, number: t.number, tireVariantId: t.tireVariantId ?? null, tireMake: t.tireMake ?? null, tireModel: t.tireModel ?? null, tireSize: t.tireSize ?? null, tireAssetId: t.tireAssetId ?? null, tread32: t.tread32, psi: t.psi, damage: t.damage })),
      actor: { driverId: scope.driverId, label: meta.driverName },
      variantIds,
    });

    const tireEntryIds: Record<number, string> = {};
    for (const t of sub.tires) {
      const pos = layout.positions.find((p) => p.key === t.key)!;
      const ev = evaluation.tires[pos.number];
      const assetId = layout.components.find((c) => c.slot === pos.slot)?.assetId ?? null;
      const [row] = await tx<{ id: string }[]>`
        insert into tire_entries (tenant_id, inspection_id, asset_id, tire_number, position_code, axle_key, component_slot, position_key, psi, tread_32nds, damage, damage_type, absent,
                                  tire_make, tire_model, tire_size, tire_variant_id, tire_asset_id, psi_status, tread_status, overall_status, photo_required, notes, ai_suggestion)
        values (${scope.tenantId}, ${ins.id}, ${assetId}, ${pos.number}, ${pos.abbreviation}, ${pos.axleKey}, ${pos.slot}, ${pos.key}, ${t.psi}, ${t.tread32}, ${t.damage}, ${t.damageType ?? null}, ${!!t.absent && pos.isSpare},
                ${t.tireMake ?? null}, ${t.tireModel ?? null}, ${t.tireSize ?? null}, ${variantIds.has(t.tireVariantId ?? "") ? t.tireVariantId : null}, ${tireIds[t.key] ?? null},
                ${ev.psiStatus}, ${ev.treadStatus}, ${ev.overall}, ${ev.photoRequired}, ${t.notes ?? null}, ${t.aiSuggestion ? tx.json(t.aiSuggestion as postgres.JSONValue) : null})
        returning id`;
      tireEntryIds[pos.number] = row.id;
    }

    // Keep the tractor's last known odometer current for dashboards.
    if (truck?.assetId && sub.odometer != null) {
      await tx`update assets set last_odometer = ${sub.odometer}, last_odometer_at = now() where id = ${truck.assetId} and (last_odometer_at is null or last_odometer_at < now())`;
    }

    await tx`insert into audit_log (tenant_id, actor_driver_id, actor_label, action, entity_type, entity_id, new_value, ip)
             values (${scope.tenantId}, ${scope.driverId}, ${meta.driverName}, 'create', 'inspection', ${ins.id},
                     ${tx.json({ mode, equipment: layout.components.map((c) => ({ slot: c.slot, unit: c.unitNumber, configVersion: c.configVersion })), summary: evaluation.summary, required_photos_missing: requiredPhotosMissing } as postgres.JSONValue)},
                     ${meta.ip ?? null})`;

    return { inspectionId: ins.id, created: true, tireEntryIds, photosExpected, requiredPhotosMissing };
  });
}

export interface AddPhotoInput {
  inspectionId: string;
  tireNumber: number | null;
  clientPhotoId: string;
  bytes: Uint8Array;
  contentType: string;
  takenAt?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Stores a photo and links it to the tire entry. Idempotent on
 * (inspection_id, client_photo_id). When every policy-required photo has
 * arrived the inspection flips from `pending_photos` to `submitted`.
 */
export async function addPhoto(scope: Scope & { tenantId: string }, input: AddPhotoInput): Promise<{ photoId: string; created: boolean; requiredPhotosMissing: number }> {
  return withScope(scope, async (tx) => {
    const insp = await tx<{ id: string; status: string }[]>`select id, status from inspections where id = ${input.inspectionId} and tenant_id = ${scope.tenantId} and status in ('submitted', 'pending_photos')`;
    if (!insp[0]) throw new Error("inspection_not_found");

    const existing = await tx<{ id: string }[]>`select id from photos where inspection_id = ${input.inspectionId} and client_photo_id = ${input.clientPhotoId}`;
    if (existing[0]) {
      const [row] = await tx<{ required_photos_missing: number }[]>`select required_photos_missing from inspections where id = ${input.inspectionId}`;
      return { photoId: existing[0].id, created: false, requiredPhotosMissing: row?.required_photos_missing ?? 0 };
    }

    let tireEntryId: string | null = null;
    if (input.tireNumber != null) {
      const te = await tx<{ id: string }[]>`select id from tire_entries where inspection_id = ${input.inspectionId} and tire_number = ${input.tireNumber}`;
      tireEntryId = te[0]?.id ?? null;
    }

    const ext = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
    // The id and object path are decided up front so the row is complete on insert
    // (driver sessions may insert photos but never update them).
    const photoId = randomUUID();
    const objectPath = `${scope.tenantId}/${input.inspectionId}/${photoId}.${ext}`;
    const [photo] = await tx<{ id: string }[]>`
      insert into photos (id, tenant_id, inspection_id, tire_entry_id, client_photo_id, storage_provider, storage_path, content_type, byte_size, width, height, taken_at)
      values (${photoId}, ${scope.tenantId}, ${input.inspectionId}, ${tireEntryId}, ${input.clientPhotoId}, ${storage().name}, ${objectPath}, ${input.contentType},
              ${input.bytes.byteLength}, ${input.width ?? null}, ${input.height ?? null}, ${input.takenAt ?? null})
      returning id`;
    // Upload inside the transaction: a failed upload rolls the row back.
    await storage().put(objectPath, input.bytes, input.contentType);
    const missing = await recomputeRequiredPhotos(tx, input.inspectionId);
    await tx`update inspections set photos_uploaded = photos_uploaded + 1, required_photos_missing = ${missing},
             status = case when ${missing} = 0 and status = 'pending_photos' then 'submitted'::app.inspection_status else status end,
             completed_at = case when ${missing} = 0 and completed_at is null then now() else completed_at end
             where id = ${input.inspectionId}`;
    return { photoId: photo.id, created: true, requiredPhotosMissing: missing };
  });
}

/** Tire entries whose policy requires a photo and that have none uploaded yet. */
export async function recomputeRequiredPhotos(tx: Tx, inspectionId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from tire_entries te
    where te.inspection_id = ${inspectionId} and te.photo_required and not exists (select 1 from photos p where p.tire_entry_id = te.id)`;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Report loading
// ---------------------------------------------------------------------------
export interface ReportTire {
  id: string;
  tire_number: number;
  position_code: string;
  axle_key: string;
  position_key: string | null;
  psi: number | null;
  tread_32nds: number | null;
  damage: "none" | "repairable" | "non_repairable";
  damage_type: string | null;
  absent: boolean;
  tire_make: string | null;
  tire_model: string | null;
  tire_size: string | null;
  tire_variant_id: string | null;
  variant_label: string | null;
  tire_asset_id: string | null;
  tire_code: string | null;
  psi_status: "none" | "green" | "yellow" | "red";
  tread_status: "none" | "green" | "yellow" | "red";
  overall_status: "none" | "green" | "yellow" | "red";
  photo_required: boolean;
  notes: string | null;
  ai_suggestion: Record<string, unknown> | null;
  photos: { id: string; url: string; taken_at: string | null }[];
}

export interface ReportData {
  id: string;
  tenant: { id: string; name: string; slug: string };
  mode: "truck" | "trailer" | "truck_trailer" | "combination";
  status: "submitted" | "pending_photos";
  driver: { id: string | null; name: string };
  truck: { id: string; unit_number: string; make: string | null; model: string | null } | null;
  trailer: { id: string; unit_number: string; make: string | null; model: string | null } | null;
  /** Layout snapshot used at submission (legacy inspections get the fixed 20-position layout). */
  layout: InspectionLayout;
  odometer: number | null;
  hubometer: number | null;
  submitted_at: string;
  completed_at: string | null;
  started_at: string | null;
  location: { lat: number; lng: number; accuracy: number | null; capturedAt: string } | null;
  notes: string | null;
  summary: Record<string, unknown>;
  photos_expected: number;
  photos_uploaded: number;
  required_photos_missing: number;
  threshold: { id: string; version: number; tenant_specific: boolean; config: ThresholdConfig };
  tires: ReportTire[];
  edited_at: string | null;
}

/** Layout of a stored inspection: the snapshot, or the legacy fixed layout for pre-configuration rows. */
export function layoutOfRow(row: { mode: string; equipment: unknown; truck_id?: string | null; truck_unit?: string | null; trailer_id?: string | null; trailer_unit?: string | null }): InspectionLayout {
  if (isInspectionLayout(row.equipment)) return row.equipment;
  const mode = row.mode === "combination" ? "truck_trailer" : (row.mode as "truck" | "trailer" | "truck_trailer");
  return legacyLayout(mode, {
    truck: row.truck_id ? { id: row.truck_id, unitNumber: row.truck_unit ?? "" } : null,
    trailer: row.trailer_id ? { id: row.trailer_id, unitNumber: row.trailer_unit ?? "" } : null,
  });
}

export async function loadReport(scope: Scope & { tenantId: string }, inspectionId: string): Promise<ReportData | null> {
  return withScope(scope, async (tx) => {
    const rows = await tx<Record<string, unknown>[]>`
      select i.id, i.mode, i.status, i.equipment, i.odometer::float8 as odometer, i.hubometer::float8 as hubometer, i.submitted_at, i.completed_at, i.started_at, i.location, i.notes, i.summary,
             i.photos_expected, i.photos_uploaded, i.required_photos_missing, i.edited_at, i.driver_id,
             t.id as tenant_id, t.name as tenant_name, t.slug as tenant_slug,
             d.full_name as driver_name,
             tr.id as truck_id, tr.unit_number as truck_unit, tr.make as truck_make, tr.model as truck_model,
             tl.id as trailer_id, tl.unit_number as trailer_unit, tl.make as trailer_make, tl.model as trailer_model,
             tv.id as tv_id, tv.version as tv_version, tv.tenant_id as tv_tenant, tv.config as tv_config
      from inspections i
      join tenants t on t.id = i.tenant_id
      left join drivers d on d.id = i.driver_id
      left join assets tr on tr.id = i.truck_asset_id
      left join assets tl on tl.id = i.trailer_asset_id
      join threshold_versions tv on tv.id = i.threshold_version_id
      where i.id = ${inspectionId} and i.tenant_id = ${scope.tenantId} and i.status in ('submitted', 'pending_photos')`;
    const r = rows[0];
    if (!r) return null;

    const entries = await tx<Omit<ReportTire, "photos">[]>`
      select te.id, te.tire_number, te.position_code, te.axle_key, te.position_key, te.psi::float8 as psi, te.tread_32nds, te.damage, te.damage_type, te.absent, te.tire_make, te.tire_model, te.tire_size,
             te.tire_variant_id, case when v.id is null then null else b.name || ' ' || m.name || ' ' || v.size || coalesce(' ' || v.load_range, '') end as variant_label,
             te.tire_asset_id, ta.code as tire_code,
             te.psi_status, te.tread_status, te.overall_status, te.photo_required, te.notes, te.ai_suggestion
      from tire_entries te
      left join tire_variants v on v.id = te.tire_variant_id
      left join tire_models m on m.id = v.model_id
      left join tire_brands b on b.id = v.brand_id
      left join tire_assets ta on ta.id = te.tire_asset_id
      where te.inspection_id = ${inspectionId} order by te.tire_number`;
    const photos = await tx<{ id: string; tire_entry_id: string | null; storage_path: string; taken_at: string | null }[]>`
      select id, tire_entry_id, storage_path, taken_at from photos where inspection_id = ${inspectionId} and storage_path <> '' order by created_at`;

    const urls = await Promise.all(photos.map((p) => storage().signedUrl(p.storage_path, 60 * 60).catch(() => "")));
    const byEntry = new Map<string, ReportTire["photos"]>();
    photos.forEach((p, i) => {
      if (!p.tire_entry_id || !urls[i]) return;
      const list = byEntry.get(p.tire_entry_id) ?? [];
      list.push({ id: p.id, url: urls[i], taken_at: p.taken_at });
      byEntry.set(p.tire_entry_id, list);
    });

    const { validateThresholdConfig, DEFAULT_THRESHOLDS } = await import("@/lib/tires/thresholds");
    const cfg = validateThresholdConfig(r.tv_config, { statutory: false });
    const loc = r.location as ReportData["location"];
    const layout = layoutOfRow({ mode: r.mode as string, equipment: r.equipment, truck_id: r.truck_id as string | null, truck_unit: r.truck_unit as string | null, trailer_id: r.trailer_id as string | null, trailer_unit: r.trailer_unit as string | null });
    return {
      id: r.id as string,
      tenant: { id: r.tenant_id as string, name: r.tenant_name as string, slug: r.tenant_slug as string },
      mode: r.mode as ReportData["mode"],
      status: r.status as ReportData["status"],
      driver: { id: (r.driver_id as string | null) ?? null, name: (r.driver_name as string | null) ?? "—" },
      truck: r.truck_id ? { id: r.truck_id as string, unit_number: r.truck_unit as string, make: r.truck_make as string | null, model: r.truck_model as string | null } : null,
      trailer: r.trailer_id ? { id: r.trailer_id as string, unit_number: r.trailer_unit as string, make: r.trailer_make as string | null, model: r.trailer_model as string | null } : null,
      layout,
      odometer: r.odometer as number | null,
      hubometer: r.hubometer as number | null,
      submitted_at: (r.submitted_at as Date).toISOString(),
      completed_at: r.completed_at ? (r.completed_at as Date).toISOString() : null,
      started_at: r.started_at ? (r.started_at as Date).toISOString() : null,
      location: loc ?? null,
      notes: r.notes as string | null,
      summary: (r.summary as Record<string, unknown>) ?? {},
      photos_expected: r.photos_expected as number,
      photos_uploaded: r.photos_uploaded as number,
      required_photos_missing: (r.required_photos_missing as number) ?? 0,
      threshold: { id: r.tv_id as string, version: r.tv_version as number, tenant_specific: !!r.tv_tenant, config: cfg.ok ? cfg.config : DEFAULT_THRESHOLDS },
      tires: entries.map((e) => ({ ...e, photos: byEntry.get(e.id) ?? [] })),
      edited_at: r.edited_at ? (r.edited_at as Date).toISOString() : null,
    };
  });
}

export interface HistoryPoint {
  inspection_id: string;
  submitted_at: string;
  tire_number: number;
  position_key: string | null;
  asset_id: string;
  psi: number | null;
  tread_32nds: number | null;
  overall_status: "none" | "green" | "yellow" | "red";
  odometer: number | null;
}

/** Previous readings (excluding this inspection) for every position of the report's assets, keyed by asset + position. */
export async function reportHistory(scope: Scope & { tenantId: string }, assetIds: string[], excludeInspectionId: string, perTire = 5): Promise<HistoryPoint[]> {
  if (assetIds.length === 0) return [];
  return withScope(scope, async (tx) => {
    const rows = await tx<(HistoryPoint & { submitted_at: Date })[]>`
      select * from (
        select te.inspection_id, i.submitted_at, te.tire_number, te.position_key, te.asset_id, te.psi::float8 as psi, te.tread_32nds, te.overall_status, i.odometer::float8 as odometer,
               row_number() over (partition by te.asset_id, te.position_key order by i.submitted_at desc) as rn
        from tire_entries te join inspections i on i.id = te.inspection_id
        where te.asset_id in ${tx(assetIds)} and te.inspection_id <> ${excludeInspectionId} and i.status in ('submitted', 'pending_photos')
      ) h where rn <= ${perTire}
      order by asset_id, position_key, submitted_at desc`;
    return rows.map((r) => ({ ...r, submitted_at: r.submitted_at.toISOString() }));
  });
}
