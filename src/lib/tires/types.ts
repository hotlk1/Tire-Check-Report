/**
 * Core tire domain types. These are deliberately independent of the database
 * schema and of any UI framework so they can be shared by the driver app, the
 * admin dashboard, report rendering and server-side validation.
 */

export type VehicleKind = "truck" | "trailer";

/** Which vehicle(s) an inspection covers. */
export type InspectionMode = "truck" | "trailer" | "truck_trailer";

/** Classification used by threshold rules. Spares are evaluated like drive tires for tread. */
export type PositionClass = "steer" | "drive" | "trailer" | "spare";

export type Side = "left" | "right" | "spare";

/** Traffic-light status. `none` = not completed yet (rendered gray). */
export type Status = "none" | "green" | "yellow" | "red";

export type DamageStatus = "none" | "repairable" | "non_repairable";

export interface TirePosition {
  /** 1–20 numbering (see spec §5). */
  number: number;
  vehicle: VehicleKind;
  positionClass: PositionClass;
  /** Axle grouping key, e.g. `truck-steer`, `truck-drive-1`, `trailer-axle-2`, `truck-spare`. */
  axleKey: string;
  side: Side;
  /** Short label shown on the diagram: L, R, LO, LI, RI, RO, SP. */
  abbreviation: string;
  /** Longer human label key (i18n key). */
  labelKey: string;
  /** Position within the axle from left to right (0-based). */
  order: number;
  /** Whether a PSI reading is required for completion. */
  requiresPsi: boolean;
}

export interface AxleDefinition {
  key: string;
  vehicle: VehicleKind;
  positionClass: PositionClass;
  /** i18n label key, e.g. tires.axle.steer */
  labelKey: string;
  /** Tire numbers in left→right order. */
  tires: number[];
  /** Whether this axle carries duals (4 tires). */
  dual: boolean;
}

/** A single reading as entered by the driver (or edited by an admin). */
export interface TireReading {
  number: number;
  psi: number | null;
  tread32: number | null;
  damage: DamageStatus;
  /** Number of photos attached (used for validation only). */
  photoCount: number;
  tireMake?: string | null;
  tireModel?: string | null;
  tireSize?: string | null;
  notes?: string | null;
}

export interface TireEvaluation {
  number: number;
  psiStatus: Status;
  treadStatus: Status;
  damageStatus: Status;
  /** Worst of psi/tread/damage; `none` while the tire is incomplete. */
  overall: Status;
  complete: boolean;
  photoRequired: boolean;
  photoMissing: boolean;
}

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
  tires: Record<number, TireEvaluation>;
  axles: Record<string, AxleComparison>;
  summary: {
    total: number;
    completed: number;
    red: number;
    yellow: number;
    green: number;
    damaged: number;
    outOfService: number;
    photosMissing: number[];
  };
}
