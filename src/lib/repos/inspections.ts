import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { withScope, type Scope, type Tx } from "@/lib/db/client";
import type { InspectionSubmission } from "@/lib/inspection/schema";
import { storage } from "@/lib/storage";
import { blockingIssues, evaluateInspection, getPosition, tiresForMode, type BlockingIssue, type TireReading } from "@/lib/tires";
import type { ThresholdConfig } from "@/lib/tires/thresholds";
import { activeThresholdVersion } from "./thresholds";

export interface CreateInspectionResult {
  inspectionId: string;
  created: boolean;
  tireEntryIds: Record<number, string>;
  photosExpected: number;
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

function readingsFrom(sub: InspectionSubmission): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const t of sub.tires) {
    out[t.number] = {
      number: t.number,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      photoCount: t.photoClientIds.length,
      absent: !!t.absent,
      tireMake: t.tireMake ?? null,
      tireModel: t.tireModel ?? null,
      tireSize: t.tireSize ?? null,
      notes: t.notes ?? null,
    };
  }
  return out;
}

/**
 * Creates the inspection and its tire entries in one transaction. Idempotent
 * on (tenant_id, client_draft_id): a retry from the offline outbox returns
 * the existing record instead of duplicating it.
 */
export async function createInspection(scope: Scope & { actor: "driver"; tenantId: string; driverId: string }, sub: InspectionSubmission, meta: { ip?: string | null; driverName: string }): Promise<CreateInspectionResult> {
  return withScope(scope, async (tx) => {
    const existing = await tx<{ id: string; photos_expected: number }[]>`
      select id, photos_expected from inspections where tenant_id = ${scope.tenantId} and client_draft_id = ${sub.clientDraftId}`;
    if (existing[0]) {
      const entries = await tx<{ id: string; tire_number: number }[]>`select id, tire_number from tire_entries where inspection_id = ${existing[0].id}`;
      return {
        inspectionId: existing[0].id,
        created: false,
        tireEntryIds: Object.fromEntries(entries.map((e) => [e.tire_number, e.id])),
        photosExpected: existing[0].photos_expected,
      };
    }

    const needsTruck = sub.mode !== "trailer";
    const needsTrailer = sub.mode !== "truck";
    const truck = needsTruck && sub.truckAssetId ? await assetOf(tx, scope.tenantId, sub.truckAssetId, "truck") : null;
    const trailer = needsTrailer && sub.trailerAssetId ? await assetOf(tx, scope.tenantId, sub.trailerAssetId, "trailer") : null;
    if (needsTruck && !truck) throw new SubmissionRejected("asset_not_found", [{ kind: "truck_required" }]);
    if (needsTrailer && !trailer) throw new SubmissionRejected("asset_not_found", [{ kind: "trailer_required" }]);

    const readings = readingsFrom(sub);
    // Only tires that belong to the mode are accepted.
    const allowed = new Set(tiresForMode(sub.mode));
    for (const n of Object.keys(readings)) {
      if (!allowed.has(Number(n))) throw new SubmissionRejected("validation", [], `tire ${n} not valid for mode ${sub.mode}`);
    }
    const issues = blockingIssues({
      mode: sub.mode,
      truckSelected: !!truck,
      trailerSelected: !!trailer,
      odometer: sub.odometer ?? null,
      readings,
    });
    const threshold = await activeThresholdVersion(tx, scope.tenantId);
    // Re-run readiness check with the tenant's active thresholds (photo rules depend on them).
    const issuesWithConfig = blockingIssues({
      mode: sub.mode,
      truckSelected: !!truck,
      trailerSelected: !!trailer,
      odometer: sub.odometer ?? null,
      readings,
      config: threshold.config,
    });
    const allIssues = issuesWithConfig.length ? issuesWithConfig : issues;
    if (allIssues.length) throw new SubmissionRejected("not_ready", allIssues);

    const evaluation = evaluateInspection(sub.mode, readings, threshold.config);
    const photosExpected = sub.tires.reduce((n, t) => n + t.photoClientIds.length, 0);

    const [ins] = await tx<{ id: string }[]>`
      insert into inspections (tenant_id, driver_id, mode, truck_asset_id, trailer_asset_id, odometer, hubometer,
                               threshold_version_id, client_draft_id, started_at, location, notes, summary, photos_expected, context)
      values (${scope.tenantId}, ${scope.driverId}, ${sub.mode}, ${truck?.id ?? null}, ${trailer?.id ?? null},
              ${sub.odometer ?? null}, ${sub.hubometer ?? null}, ${threshold.id}, ${sub.clientDraftId},
              ${sub.startedAt ?? null}, ${sub.location ? tx.json(sub.location) : null}, ${sub.notes ?? null},
              ${tx.json(evaluation.summary as unknown as postgres.JSONValue)}, ${photosExpected},
              ${tx.json({ client: sub.client ?? {}, ip: meta.ip ?? null })})
      returning id`;

    const tireEntryIds: Record<number, string> = {};
    for (const t of sub.tires) {
      const pos = getPosition(t.number);
      const ev = evaluation.tires[t.number];
      const assetId = pos.vehicle === "truck" ? (truck?.id ?? null) : (trailer?.id ?? null);
      const [row] = await tx<{ id: string }[]>`
        insert into tire_entries (tenant_id, inspection_id, asset_id, tire_number, position_code, axle_key, psi, tread_32nds, damage, absent,
                                  tire_make, tire_model, tire_size, psi_status, tread_status, overall_status, notes, ai_suggestion)
        values (${scope.tenantId}, ${ins.id}, ${assetId}, ${t.number}, ${pos.abbreviation}, ${pos.axleKey}, ${t.psi}, ${t.tread32}, ${t.damage}, ${!!t.absent && pos.positionClass === "spare"},
                ${t.tireMake ?? null}, ${t.tireModel ?? null}, ${t.tireSize ?? null}, ${ev.psiStatus}, ${ev.treadStatus}, ${ev.overall},
                ${t.notes ?? null}, ${t.aiSuggestion ? tx.json(t.aiSuggestion as postgres.JSONValue) : null})
        returning id`;
      tireEntryIds[t.number] = row.id;
    }

    // Keep the asset's last known odometer current for dashboards.
    if (truck && sub.odometer != null) {
      await tx`update assets set last_odometer = ${sub.odometer}, last_odometer_at = now() where id = ${truck.id} and (last_odometer_at is null or last_odometer_at < now())`;
    }

    await tx`insert into audit_log (tenant_id, actor_driver_id, actor_label, action, entity_type, entity_id, new_value, ip)
             values (${scope.tenantId}, ${scope.driverId}, ${meta.driverName}, 'create', 'inspection', ${ins.id},
                     ${tx.json({ mode: sub.mode, truck: truck?.unit_number ?? null, trailer: trailer?.unit_number ?? null, summary: evaluation.summary } as postgres.JSONValue)},
                     ${meta.ip ?? null})`;

    return { inspectionId: ins.id, created: true, tireEntryIds, photosExpected };
  });
}

async function assetOf(tx: Tx, tenantId: string, id: string, type: "truck" | "trailer") {
  const rows = await tx<{ id: string; unit_number: string }[]>`select id, unit_number from assets where id = ${id} and tenant_id = ${tenantId} and type = ${type} and status = 'active'`;
  return rows[0] ?? null;
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

/** Stores a photo and links it to the tire entry. Idempotent on (inspection_id, client_photo_id). */
export async function addPhoto(scope: Scope & { tenantId: string }, input: AddPhotoInput): Promise<{ photoId: string; created: boolean }> {
  return withScope(scope, async (tx) => {
    const insp = await tx<{ id: string }[]>`select id from inspections where id = ${input.inspectionId} and tenant_id = ${scope.tenantId} and status = 'submitted'`;
    if (!insp[0]) throw new Error("inspection_not_found");

    const existing = await tx<{ id: string }[]>`select id from photos where inspection_id = ${input.inspectionId} and client_photo_id = ${input.clientPhotoId}`;
    if (existing[0]) return { photoId: existing[0].id, created: false };

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
    await tx`update inspections set photos_uploaded = photos_uploaded + 1 where id = ${input.inspectionId}`;
    return { photoId: photo.id, created: true };
  });
}

// ---------------------------------------------------------------------------
// Report loading
// ---------------------------------------------------------------------------
export interface ReportTire {
  id: string;
  tire_number: number;
  position_code: string;
  axle_key: string;
  psi: number | null;
  tread_32nds: number | null;
  damage: "none" | "repairable" | "non_repairable";
  absent: boolean;
  tire_make: string | null;
  tire_model: string | null;
  tire_size: string | null;
  psi_status: "none" | "green" | "yellow" | "red";
  tread_status: "none" | "green" | "yellow" | "red";
  overall_status: "none" | "green" | "yellow" | "red";
  notes: string | null;
  ai_suggestion: Record<string, unknown> | null;
  photos: { id: string; url: string; taken_at: string | null }[];
}

export interface ReportData {
  id: string;
  tenant: { id: string; name: string; slug: string };
  mode: "truck" | "trailer" | "truck_trailer";
  driver: { id: string | null; name: string };
  truck: { id: string; unit_number: string; make: string | null; model: string | null } | null;
  trailer: { id: string; unit_number: string; make: string | null; model: string | null } | null;
  odometer: number | null;
  hubometer: number | null;
  submitted_at: string;
  started_at: string | null;
  location: { lat: number; lng: number; accuracy: number | null; capturedAt: string } | null;
  notes: string | null;
  summary: Record<string, unknown>;
  photos_expected: number;
  photos_uploaded: number;
  threshold: { id: string; version: number; tenant_specific: boolean; config: ThresholdConfig };
  tires: ReportTire[];
  edited_at: string | null;
}

export async function loadReport(scope: Scope & { tenantId: string }, inspectionId: string): Promise<ReportData | null> {
  return withScope(scope, async (tx) => {
    const rows = await tx<Record<string, unknown>[]>`
      select i.id, i.mode, i.odometer::float8 as odometer, i.hubometer::float8 as hubometer, i.submitted_at, i.started_at, i.location, i.notes, i.summary,
             i.photos_expected, i.photos_uploaded, i.edited_at, i.driver_id,
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
      where i.id = ${inspectionId} and i.tenant_id = ${scope.tenantId} and i.status = 'submitted'`;
    const r = rows[0];
    if (!r) return null;

    const entries = await tx<Omit<ReportTire, "photos">[]>`
      select id, tire_number, position_code, axle_key, psi::float8 as psi, tread_32nds, damage, absent, tire_make, tire_model, tire_size,
             psi_status, tread_status, overall_status, notes, ai_suggestion
      from tire_entries where inspection_id = ${inspectionId} order by tire_number`;
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

    const loc = r.location as ReportData["location"];
    return {
      id: r.id as string,
      tenant: { id: r.tenant_id as string, name: r.tenant_name as string, slug: r.tenant_slug as string },
      mode: r.mode as ReportData["mode"],
      driver: { id: (r.driver_id as string | null) ?? null, name: (r.driver_name as string | null) ?? "—" },
      truck: r.truck_id ? { id: r.truck_id as string, unit_number: r.truck_unit as string, make: r.truck_make as string | null, model: r.truck_model as string | null } : null,
      trailer: r.trailer_id ? { id: r.trailer_id as string, unit_number: r.trailer_unit as string, make: r.trailer_make as string | null, model: r.trailer_model as string | null } : null,
      odometer: r.odometer as number | null,
      hubometer: r.hubometer as number | null,
      submitted_at: (r.submitted_at as Date).toISOString(),
      started_at: r.started_at ? (r.started_at as Date).toISOString() : null,
      location: loc ?? null,
      notes: r.notes as string | null,
      summary: (r.summary as Record<string, unknown>) ?? {},
      photos_expected: r.photos_expected as number,
      photos_uploaded: r.photos_uploaded as number,
      threshold: { id: r.tv_id as string, version: r.tv_version as number, tenant_specific: !!r.tv_tenant, config: r.tv_config as ThresholdConfig },
      tires: entries.map((e) => ({ ...e, photos: byEntry.get(e.id) ?? [] })),
      edited_at: r.edited_at ? (r.edited_at as Date).toISOString() : null,
    };
  });
}

/** Previous readings for the same asset + position (for the tire detail "history" panel). */
export async function positionHistory(scope: Scope & { tenantId: string }, assetId: string, tireNumber: number, limit = 10) {
  return withScope(scope, async (tx) => {
    return tx<{ inspection_id: string; submitted_at: string; psi: number | null; tread_32nds: number | null; overall_status: string; odometer: number | null }[]>`
      select te.inspection_id, i.submitted_at, te.psi::float8 as psi, te.tread_32nds, te.overall_status, i.odometer::float8 as odometer
      from tire_entries te join inspections i on i.id = te.inspection_id
      where te.asset_id = ${assetId} and te.tire_number = ${tireNumber} and i.status = 'submitted'
      order by i.submitted_at desc limit ${limit}`;
  });
}

export interface HistoryPoint {
  inspection_id: string;
  submitted_at: string;
  tire_number: number;
  asset_id: string;
  psi: number | null;
  tread_32nds: number | null;
  overall_status: "none" | "green" | "yellow" | "red";
  odometer: number | null;
}

/** Previous readings (excluding this inspection) for every position of the report's assets. */
export async function reportHistory(scope: Scope & { tenantId: string }, assetIds: string[], excludeInspectionId: string, perTire = 5): Promise<HistoryPoint[]> {
  if (assetIds.length === 0) return [];
  return withScope(scope, async (tx) => {
    const rows = await tx<(HistoryPoint & { submitted_at: Date })[]>`
      select * from (
        select te.inspection_id, i.submitted_at, te.tire_number, te.asset_id, te.psi::float8 as psi, te.tread_32nds, te.overall_status, i.odometer::float8 as odometer,
               row_number() over (partition by te.asset_id, te.tire_number order by i.submitted_at desc) as rn
        from tire_entries te join inspections i on i.id = te.inspection_id
        where te.asset_id in ${tx(assetIds)} and te.inspection_id <> ${excludeInspectionId} and i.status = 'submitted'
      ) h where rn <= ${perTire}
      order by asset_id, tire_number, submitted_at desc`;
    return rows.map((r) => ({ ...r, submitted_at: r.submitted_at.toISOString() }));
  });
}
