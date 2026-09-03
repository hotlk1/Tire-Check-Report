/**
 * Core tire domain types. These are deliberately independent of the database
 * schema and of any UI framework so they can be shared by the driver app, the
 * admin dashboard, report rendering and server-side validation.
 */

export type VehicleKind = "truck" | "trailer";

/** Legacy coarse mode of an inspection; `combination` = jeep/dolly/booster/second trailer present. */
export type InspectionMode = "truck" | "trailer" | "truck_trailer" | "combination";

/** Classification used by threshold rules. */
export type PositionClass = "steer" | "drive" | "trailer" | "spare";

export type Side = "left" | "right" | "spare";

/** Traffic-light status. `none` = not completed yet (rendered gray). */
export type Status = "none" | "green" | "yellow" | "red";

export type DamageStatus = "none" | "repairable" | "non_repairable";

/** A single reading as entered by the driver (or edited by an admin). Keyed by the layout position key. */
export interface TireReading {
  /** Layout position key (`truck/drive-1:LO`). */
  key: string;
  /** Display number within the inspection (from the layout). */
  number: number;
  psi: number | null;
  tread32: number | null;
  damage: DamageStatus;
  /** Number of photos attached (used for validation only). */
  photoCount: number;
  /** Legacy spare positions declared "No spare" (kept for old reports; no longer required). */
  absent?: boolean;
  tireMake?: string | null;
  tireModel?: string | null;
  tireSize?: string | null;
  /** Catalog variant chosen from the cascading picker; null for custom / unlisted tires. */
  tireVariantId?: string | null;
  /** Physical tire occupying the position (TireAsset id), when known. */
  tireAssetId?: string | null;
  notes?: string | null;
}

export interface TireEvaluation {
  key: string;
  number: number;
  psiStatus: Status;
  treadStatus: Status;
  damageStatus: Status;
  /** Worst of psi/tread/damage; `none` while the tire is incomplete. */
  overall: Status;
  /** All required readings present (PSI where required, tread). */
  complete: boolean;
  /** Any input at all (readings, damage, photo). Spares are validated only when touched. */
  touched: boolean;
  /** Spare declared absent (legacy). */
  absent: boolean;
  photoRequired: boolean;
  photoMissing: boolean;
  /** Which required inputs are missing, for explicit UI messages. */
  missing: MissingInput[];
}

export type MissingInput = "psi" | "tread" | "photo";

export interface DualPairComparison {
  axleKey: string;
  side: Side;
  tires: [number, number];
  /** Absolute PSI difference between the two tires of the pair, once both are complete. */
  psiDiff: number | null;
  psiStatus: Status;
  treadDiff: number | null;
  /** true when tread difference is within tolerance (renders `=`), false renders `≠`. */
  treadMatch: boolean | null;
}

export interface AxleComparison {
  axleKey: string;
  /** Left-vs-right PSI difference (mean of each side for duals). */
  sideToSidePsiDiff: number | null;
  sideToSideStatus: Status;
  pairs: DualPairComparison[];
  complete: boolean;
}

export interface InspectionEvaluation {
  /** Keyed by tire number. */
  tires: Record<number, TireEvaluation>;
  axles: Record<string, AxleComparison>;
  summary: {
    /** Required (non-spare) positions. */
    total: number;
    completed: number;
    red: number;
    yellow: number;
    green: number;
    damaged: number;
    outOfService: number;
    photosMissing: number[];
    /** Spare slots in the layout and how many were inspected. */
    spares: number;
    sparesInspected: number;
  };
}
