import type { LayoutPosition } from "@/lib/equipment/layout";
import { INPUT_LIMITS, type ThresholdConfig } from "@/lib/tires/thresholds";
import { evaluateTire } from "@/lib/tires/evaluate";
import type { MissingInput, TireReading } from "@/lib/tires/types";

/**
 * Explicit, user-facing validation for the driver flow. Every function is
 * pure so the same messages appear in the UI, in unit tests and (for the
 * blocking ones) in the server's rejection payload.
 */
export type TireIssueCode = "psi_required" | "tread_required" | "photo_required_damaged" | "photo_required_oos" | "photo_required_tread_threshold" | "photo_required_tread" | "photo_required_psi" | "psi_out_of_range" | "tread_out_of_range";

export interface TireSaveIssue {
  code: TireIssueCode;
  /** Field to highlight / focus. */
  field: "psi" | "tread" | "photo";
}

/** Why a tire cannot be marked complete on Save. Empty = complete. */
export function tireSaveIssues(reading: TireReading, pos: LayoutPosition, config: ThresholdConfig): TireSaveIssue[] {
  const out: TireSaveIssue[] = [];
  if (reading.psi !== null && (reading.psi < INPUT_LIMITS.psi.min || reading.psi > INPUT_LIMITS.psi.max)) out.push({ code: "psi_out_of_range", field: "psi" });
  if (reading.tread32 !== null && (reading.tread32 < INPUT_LIMITS.tread32.min || reading.tread32 > INPUT_LIMITS.tread32.max)) out.push({ code: "tread_out_of_range", field: "tread" });
  const ev = evaluateTire(reading, pos, config);
  for (const m of ev.missing as MissingInput[]) {
    if (m === "psi") out.push({ code: "psi_required", field: "psi" });
    else if (m === "tread") out.push({ code: "tread_required", field: "tread" });
    else if (m === "photo") {
      const code: TireIssueCode =
        ev.photoReason === "oos" ? "photo_required_oos" : ev.photoReason === "damaged" ? "photo_required_damaged" : ev.photoReason === "tread_threshold" ? "photo_required_tread_threshold" : ev.photoReason === "tread_status" ? "photo_required_tread" : "photo_required_psi";
      out.push({ code, field: "photo" });
    }
  }
  return out;
}

export type SanityWarning = { code: "tread_above_original"; original: number } | { code: "tread_unusually_high" } | { code: "psi_unusually_high" } | { code: "psi_unusually_low" } | { code: "psi_above_max_cold"; max: number };

/**
 * Soft warnings that ask the driver to confirm an unusual reading. Catalog
 * data (original tread depth, max cold PSI) makes the check specific; without
 * it a generous absolute line applies.
 */
export function sanityWarnings(reading: { psi: number | null; tread32: number | null }, catalog?: { originalTread32?: number | null; maxColdPsi?: number | null } | null): SanityWarning[] {
  const out: SanityWarning[] = [];
  if (reading.tread32 !== null) {
    const original = catalog?.originalTread32 ?? null;
    if (original !== null && original > 0) {
      if (reading.tread32 > original + 1) out.push({ code: "tread_above_original", original });
    } else if (reading.tread32 > INPUT_LIMITS.tread32.confirmAbove) {
      out.push({ code: "tread_unusually_high" });
    }
  }
  if (reading.psi !== null) {
    const max = catalog?.maxColdPsi ?? null;
    if (max !== null && max > 0) {
      if (reading.psi > max + 5) out.push({ code: "psi_above_max_cold", max });
    } else if (reading.psi > INPUT_LIMITS.psi.confirmAbove) {
      out.push({ code: "psi_unusually_high" });
    }
    if (reading.psi > 0 && reading.psi < INPUT_LIMITS.psi.confirmBelow) out.push({ code: "psi_unusually_low" });
  }
  return out;
}

export type EquipmentIssue = { code: "no_equipment" } | { code: "asset_required"; slot: string } | { code: "odometer_required"; slot: string };

/** Why "Start inspection" cannot proceed. */
export function equipmentIssues(components: { slot: string; kind: string; assetId: string | null }[], odometer: number | null): EquipmentIssue[] {
  const out: EquipmentIssue[] = [];
  if (components.length === 0) return [{ code: "no_equipment" }];
  for (const c of components) {
    if (!c.assetId) out.push({ code: "asset_required", slot: c.slot });
    else if (c.kind === "truck" && (odometer === null || Number.isNaN(odometer) || odometer <= 0)) out.push({ code: "odometer_required", slot: c.slot });
  }
  return out;
}
