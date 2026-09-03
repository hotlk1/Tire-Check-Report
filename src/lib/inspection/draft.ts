import { buildLayout, SLOT_KIND, type ComponentSlot, type InspectionLayout } from "@/lib/equipment/layout";
import { defaultConfigFor } from "@/lib/equipment/templates";
import type { ComponentKind, EquipmentConfig } from "@/lib/equipment/types";
import type { ThresholdConfig } from "@/lib/tires/thresholds";
import type { DamageStatus, TireReading } from "@/lib/tires/types";
import type { InspectionSubmission } from "./schema";

/**
 * Client-side draft model (persisted in IndexedDB, spec §10). Photos are
 * stored as blobs in a separate object store and referenced by id.
 *
 * Schema 2: the draft carries the equipment components (each with its
 * configuration snapshot) and readings keyed by layout position key, so the
 * driver can add/remove equipment mid-inspection without losing readings for
 * equipment that stays.
 */
export interface DraftAsset {
  id: string;
  unitNumber: string;
  label?: string | null;
}

/** What the server knows about the physical tire currently mounted at a position. */
export interface MountedTireInfo {
  tireAssetId: string;
  tireVariantId: string | null;
  tireMake: string | null;
  tireModel: string | null;
  tireSize: string | null;
  originalTread32?: number | null;
  maxColdPsi?: number | null;
}

export interface DraftComponent {
  slot: ComponentSlot;
  kind: ComponentKind;
  asset: DraftAsset | null;
  configurationId: string | null;
  configVersion: number | null;
  /** Configuration snapshot; null until the asset is picked (default template applies for the kind). */
  config: EquipmentConfig | null;
  /** Mounted physical tires by position key (`axleKey:ABBR` without the slot prefix). */
  mounted?: Record<string, MountedTireInfo>;
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
  /** Layout position key (`truck/drive-1:LO`). */
  key: string;
  psi: number | null;
  tread32: number | null;
  damage: DamageStatus;
  damageType?: string | null;
  photoIds: string[];
  tireMake?: string;
  tireModel?: string;
  tireSize?: string;
  /** Catalog variant id when the tire was picked from the catalog (make/model/size are copied as text too). */
  tireVariantId?: string | null;
  /** Physical tire pre-filled from the mounted record; cleared when the driver enters a different tire. */
  tireAssetId?: string | null;
  notes?: string;
  aiSuggestion?: DraftAiSuggestion | null;
  /** Driver confirmed an unusual reading (sanity warning acknowledged). */
  confirmedUnusual?: boolean;
  /** Legacy "No spare" flag (kept for drafts created before spares became optional). */
  absent?: boolean;
}

export interface DraftLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
}

export type DraftStatus = "draft" | "queued" | "submitting" | "submitted" | "failed";

/** Quick selector state; components are the source of truth. */
export type BaseMode = "truck" | "trailer" | "truck_trailer";

export interface InspectionDraft {
  schema: 2;
  id: string; // clientDraftId (uuid)
  tenantSlug: string;
  driverId: string;
  driverName: string;
  mode: BaseMode | null;
  components: DraftComponent[];
  /** Tenant rules snapshot (thresholds + photo policy) fetched when the draft started; null = system defaults. */
  rules: { id: string; version: number; config: ThresholdConfig } | null;
  odometer: number | null;
  hubometer: number | null;
  tires: Record<string, DraftTire>;
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
    schema: 2,
    id: crypto.randomUUID(),
    tenantSlug: input.tenantSlug,
    driverId: input.driverId,
    driverName: input.driverName,
    mode: null,
    components: [],
    rules: null,
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

export function emptyTire(key: string): DraftTire {
  return { key, psi: null, tread32: null, damage: "none", photoIds: [] };
}

export function tireOf(draft: InspectionDraft, key: string): DraftTire {
  return draft.tires[key] ?? emptyTire(key);
}

export function emptyComponent(slot: ComponentSlot): DraftComponent {
  return { slot, kind: SLOT_KIND[slot], asset: null, configurationId: null, configVersion: null, config: null };
}

const BASE_SLOTS: Record<BaseMode, ComponentSlot[]> = { truck: ["truck"], trailer: ["trailer"], truck_trailer: ["truck", "trailer"] };

/** Components for a base mode, keeping any already-picked assets and extra equipment. */
export function componentsForMode(draft: InspectionDraft, mode: BaseMode): DraftComponent[] {
  const wanted = new Set<ComponentSlot>(BASE_SLOTS[mode]);
  for (const c of draft.components) if (c.slot !== "truck" && c.slot !== "trailer") wanted.add(c.slot);
  return [...wanted].map((slot) => draft.components.find((c) => c.slot === slot) ?? emptyComponent(slot));
}

export function baseModeOf(components: DraftComponent[]): BaseMode | null {
  const has = (s: ComponentSlot) => components.some((c) => c.slot === s);
  if (has("truck") && has("trailer")) return "truck_trailer";
  if (has("truck")) return "truck";
  if (has("trailer")) return "trailer";
  return null;
}

/** Layout of the draft's components (assets without a configuration use the kind's default template). */
export function draftLayout(draft: InspectionDraft): InspectionLayout | null {
  if (draft.components.length === 0) return null;
  return buildLayout(
    draft.components.map((c) => ({
      slot: c.slot,
      kind: c.kind,
      assetId: c.asset?.id ?? null,
      unitNumber: c.asset?.unitNumber ?? null,
      label: c.asset?.label ?? null,
      configurationId: c.configurationId,
      configVersion: c.configVersion,
      config: c.config ?? defaultConfigFor(c.kind),
    })),
  );
}

export function toReadings(draft: InspectionDraft, layout: InspectionLayout): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const p of layout.positions) {
    const t = draft.tires[p.key];
    if (!t) continue;
    out[p.number] = {
      key: p.key,
      number: p.number,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      photoCount: t.photoIds.length,
      absent: !!t.absent,
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

export function tireHasInput(t: DraftTire): boolean {
  return t.psi !== null || t.tread32 !== null || t.damage !== "none" || t.photoIds.length > 0 || !!t.absent;
}

/** Whether a draft has any meaningful driver input (used for the resume prompt). */
export function draftHasContent(draft: InspectionDraft): boolean {
  return !!draft.mode || draft.components.some((c) => !!c.asset) || draft.odometer !== null || Object.values(draft.tires).some(tireHasInput);
}

export function isDraftExpired(draft: InspectionDraft, now = Date.now()): boolean {
  return now - new Date(draft.updatedAt).getTime() > DRAFT_TTL_MS;
}

/**
 * Applies an equipment change. Readings whose position still exists in the
 * new layout are kept; readings of removed/replaced equipment are dropped and
 * reported so the UI can warn before applying.
 */
export function applyEquipmentChange(draft: InspectionDraft, components: DraftComponent[]): { draft: InspectionDraft; dropped: { slot: ComponentSlot; unitNumber: string | null; count: number }[] } {
  const next: InspectionDraft = { ...draft, components, mode: baseModeOf(components) };
  const layout = draftLayout(next);
  const keep = new Set(layout?.positions.map((p) => p.key) ?? []);
  const dropped = new Map<ComponentSlot, { slot: ComponentSlot; unitNumber: string | null; count: number }>();
  const tires: Record<string, DraftTire> = {};
  for (const [key, t] of Object.entries(draft.tires)) {
    const slot = key.split("/")[0] as ComponentSlot;
    const prevComponent = draft.components.find((c) => c.slot === slot);
    const nextComponent = components.find((c) => c.slot === slot);
    const sameAsset = !!prevComponent && !!nextComponent && prevComponent.asset?.id === nextComponent.asset?.id;
    if (keep.has(key) && sameAsset) {
      tires[key] = t;
    } else if (tireHasInput(t)) {
      const d = dropped.get(slot) ?? { slot, unitNumber: prevComponent?.asset?.unitNumber ?? null, count: 0 };
      d.count += 1;
      dropped.set(slot, d);
    }
  }
  return { draft: { ...next, tires }, dropped: [...dropped.values()] };
}

/** Readings that would be lost by an equipment change (for the confirmation dialog). */
export function previewEquipmentChange(draft: InspectionDraft, components: DraftComponent[]) {
  return applyEquipmentChange(draft, components).dropped;
}

export function toSubmission(draft: InspectionDraft, layout: InspectionLayout, client?: InspectionSubmission["client"]): InspectionSubmission {
  const tires = layout.positions
    .map((p) => ({ p, t: draft.tires[p.key] }))
    .filter((x): x is { p: (typeof layout.positions)[number]; t: DraftTire } => !!x.t && tireHasInput(x.t))
    .map(({ p, t }) => ({
      key: p.key,
      number: p.number,
      absent: !!t.absent && p.isSpare,
      psi: t.psi,
      tread32: t.tread32,
      damage: t.damage,
      damageType: t.damage === "none" ? null : (t.damageType ?? null),
      tireMake: t.tireMake?.trim() || null,
      tireModel: t.tireModel?.trim() || null,
      tireSize: t.tireSize?.trim() || null,
      tireVariantId: t.tireVariantId ?? null,
      tireAssetId: t.tireAssetId ?? null,
      notes: t.notes?.trim() || null,
      photoClientIds: t.photoIds,
      aiSuggestion: t.aiSuggestion ?? null,
    }));
  return {
    schemaVersion: 2,
    clientDraftId: draft.id,
    components: draft.components.filter((c) => c.asset).map((c) => ({ slot: c.slot, kind: c.kind, assetId: c.asset!.id, configurationId: c.configurationId })),
    odometer: draft.odometer,
    hubometer: draft.hubometer,
    startedAt: draft.startedAt,
    location: draft.location,
    notes: draft.notes.trim() || null,
    tires,
    client,
  };
}

/** Drafts written by the previous app version are not convertible (numeric keys); they are discarded. */
export function isCurrentDraft(x: unknown): x is InspectionDraft {
  return !!x && typeof x === "object" && (x as InspectionDraft).schema === 2 && Array.isArray((x as InspectionDraft).components);
}
