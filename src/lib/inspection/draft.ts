import type { DamageStatus, InspectionMode, TireReading } from "@/lib/tires/types";
import { tiresForMode } from "@/lib/tires/layout";
import type { InspectionSubmission } from "./schema";

/**
 * Client-side draft model (persisted in IndexedDB, spec §10). Photos are
 * stored as blobs in a separate object store and referenced by id.
 */
export interface DraftAsset {
  id: string;
  unitNumber: string;
  label?: string | null;
}

export interface DraftAiSuggestion {
  tread32: number | null;
  confidence: number | null;
  defects?: string[];
  quality?: string;
  provider?: string;
  accepted?: boolean;
  photoId?: string;
}

export interface DraftTire {
  number: number;
  psi: number | null;
  tread32: number | null;
  damage: DamageStatus;
  damageType?: string | null;
  photoIds: string[];
  /** Spares only: driver declared "No spare". */
  absent?: boolean;
  tireMake?: string;
  tireModel?: string;
  tireSize?: string;
  /** Catalog variant id when the tire was picked from the catalog (make/model/size are copied as text too). */
  tireVariantId?: string | null;
  notes?: string;
  aiSuggestion?: DraftAiSuggestion | null;
}

export interface DraftLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
}

export type DraftStatus = "draft" | "queued" | "submitting" | "submitted" | "failed";

export interface InspectionDraft {
  id: string; // clientDraftId (uuid)
  tenantSlug: string;
  driverId: string;
  driverName: string;
  mode: InspectionMode | null;
  truck: DraftAsset | null;
  trailer: DraftAsset | null;
  odometer: number | null;
  hubometer: number | null;
  tires: Record<number, DraftTire>;
  notes: string;
  location: DraftLocation | null;
  locationState: "idle" | "capturing" | "captured" | "denied";
  status: DraftStatus;
  /** Server inspection id once created (photos may still be uploading). */
  inspectionId: string | null;
  startedAt: string;
  updatedAt: string;
  submittedAt: string | null;
  lastError: string | null;
  attempts: number;
}

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function newDraft(input: { tenantSlug: string; driverId: string; driverName: string }): InspectionDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    tenantSlug: input.tenantSlug,
    driverId: input.driverId,
    driverName: input.driverName,
    mode: null,
    truck: null,
    trailer: null,
    odometer: null,
    hubometer: null,
    tires: {},
    notes: "",
    location: null,
    locationState: "idle",
    status: "draft",
    inspectionId: null,
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    lastError: null,
    attempts: 0,
  };
}

export function emptyTire(number: number): DraftTire {
  return { number, psi: null, tread32: null, damage: "none", photoIds: [] };
}

export function tireOf(draft: InspectionDraft, number: number): DraftTire {
  return draft.tires[number] ?? emptyTire(number);
}

export function toReadings(draft: InspectionDraft): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const t of Object.values(draft.tires)) {
    out[t.number] = {
      number: t.number,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      photoCount: t.photoIds.length,
      absent: !!t.absent,
      tireMake: t.tireMake ?? null,
      tireModel: t.tireModel ?? null,
      tireSize: t.tireSize ?? null,
      tireVariantId: t.tireVariantId ?? null,
      notes: t.notes ?? null,
    };
  }
  return out;
}

/** Whether a draft has any meaningful driver input (used for the resume prompt). */
export function draftHasContent(draft: InspectionDraft): boolean {
  return (
    !!draft.mode ||
    !!draft.truck ||
    !!draft.trailer ||
    draft.odometer !== null ||
    Object.values(draft.tires).some((t) => t.psi !== null || t.tread32 !== null || t.damage !== "none" || t.photoIds.length > 0 || t.absent)
  );
}

export function isDraftExpired(draft: InspectionDraft, now = Date.now()): boolean {
  return now - new Date(draft.updatedAt).getTime() > DRAFT_TTL_MS;
}

export function toSubmission(draft: InspectionDraft, client?: InspectionSubmission["client"]): InspectionSubmission {
  if (!draft.mode) throw new Error("mode not set");
  const allowed = new Set(tiresForMode(draft.mode));
  const tires = Object.values(draft.tires)
    .filter((t) => allowed.has(t.number))
    .filter((t) => t.psi !== null || t.tread32 !== null || t.damage !== "none" || t.photoIds.length > 0 || t.absent)
    .map((t) => ({
      number: t.number,
      absent: !!t.absent,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      damageType: t.damage === "none" ? null : (t.damageType ?? null),
      tireMake: t.tireMake?.trim() || null,
      tireModel: t.tireModel?.trim() || null,
      tireSize: t.tireSize?.trim() || null,
      tireVariantId: t.tireVariantId ?? null,
      notes: t.notes?.trim() || null,
      photoClientIds: t.photoIds,
      aiSuggestion: t.aiSuggestion ?? null,
    }));
  return {
    clientDraftId: draft.id,
    mode: draft.mode,
    truckAssetId: draft.truck?.id ?? null,
    trailerAssetId: draft.trailer?.id ?? null,
    odometer: draft.odometer,
    hubometer: draft.hubometer,
    startedAt: draft.startedAt,
    location: draft.location,
    notes: draft.notes.trim() || null,
    tires,
    client,
  };
}
