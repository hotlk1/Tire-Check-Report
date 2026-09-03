import type { PositionClass, Side } from "@/lib/tires/types";

/**
 * Equipment configuration model.
 *
 * An Asset (truck, trailer, jeep, dolly, booster) carries a versioned
 * configuration: an ordered list of axles, each with single or dual wheels,
 * plus any number of spare slots. Wheel positions are derived from the axles
 * (left/right, outer/inner for duals) so a configuration is small and
 * unambiguous. Inspections snapshot the configuration used, so history never
 * changes when equipment is reconfigured.
 */
export type ComponentKind = "truck" | "trailer" | "jeep" | "dolly" | "booster";

/** Mechanical role of an axle. The role decides the threshold class. */
export type AxleRole = "steer" | "drive" | "pusher" | "tag" | "lift" | "trailer" | "dolly";

export type WheelSetup = "single" | "dual" | "super_single";

export interface AxleDefinitionConfig {
  /** Stable key within the configuration, e.g. `steer`, `drive-1`, `axle-3`. */
  key: string;
  role: AxleRole;
  wheels: WheelSetup;
  /** Optional free-text label override; templates use role-based labels. */
  label?: string | null;
  /** Lift/drop axle: can be raised; still inspected. */
  liftable?: boolean;
}

export interface SpareSlotDefinitionConfig {
  key: string;
  label?: string | null;
}

export interface EquipmentConfig {
  schemaVersion: 1;
  kind: ComponentKind;
  /** Template this configuration was derived from (informational). */
  templateKey?: string | null;
  axles: AxleDefinitionConfig[];
  spares: SpareSlotDefinitionConfig[];
}

/** Threshold class of an axle role. Steer axles use steer rules; powered axles use drive rules; everything else non-steer. */
export function positionClassOf(role: AxleRole): Exclude<PositionClass, "spare"> {
  if (role === "steer") return "steer";
  if (role === "drive") return "drive";
  return "trailer";
}

/** A wheel position derived from an axle definition. */
export interface WheelPositionDefinition {
  /** `${axleKey}:${abbreviation}` — stable within a configuration. */
  key: string;
  axleKey: string;
  side: Side;
  /** L / R for singles, LO / LI / RI / RO for duals. */
  abbreviation: string;
  order: number;
}

export function wheelPositionsOf(axle: AxleDefinitionConfig): WheelPositionDefinition[] {
  const dual = axle.wheels === "dual";
  const abbrs: Array<[string, Side]> = dual
    ? [["LO", "left"], ["LI", "left"], ["RI", "right"], ["RO", "right"]]
    : [["L", "left"], ["R", "right"]];
  return abbrs.map(([abbreviation, side], order) => ({ key: `${axle.key}:${abbreviation}`, axleKey: axle.key, side, abbreviation, order }));
}

export function isDual(axle: AxleDefinitionConfig): boolean {
  return axle.wheels === "dual";
}

/** Structural validation of a configuration document (admin input, stored JSON). */
export function validateEquipmentConfig(input: unknown): { ok: true; config: EquipmentConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "config must be an object" };
  const c = input as Partial<EquipmentConfig>;
  if (c.schemaVersion !== 1) return { ok: false, error: "schemaVersion must be 1" };
  if (!["truck", "trailer", "jeep", "dolly", "booster"].includes(c.kind as string)) return { ok: false, error: "kind invalid" };
  if (!Array.isArray(c.axles) || c.axles.length === 0) return { ok: false, error: "at least one axle is required" };
  if (c.axles.length > 20) return { ok: false, error: "too many axles" };
  const keys = new Set<string>();
  for (const a of c.axles) {
    if (!a || typeof a.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(a.key)) return { ok: false, error: "axle key invalid" };
    if (keys.has(a.key)) return { ok: false, error: `duplicate axle key ${a.key}` };
    keys.add(a.key);
    if (!["steer", "drive", "pusher", "tag", "lift", "trailer", "dolly"].includes(a.role)) return { ok: false, error: `axle ${a.key}: role invalid` };
    if (!["single", "dual", "super_single"].includes(a.wheels)) return { ok: false, error: `axle ${a.key}: wheels invalid` };
  }
  if (!Array.isArray(c.spares)) return { ok: false, error: "spares must be an array" };
  if (c.spares.length > 6) return { ok: false, error: "too many spare slots" };
  const spareKeys = new Set<string>();
  for (const s of c.spares) {
    if (!s || typeof s.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(s.key)) return { ok: false, error: "spare key invalid" };
    if (spareKeys.has(s.key)) return { ok: false, error: `duplicate spare key ${s.key}` };
    spareKeys.add(s.key);
  }
  return { ok: true, config: c as EquipmentConfig };
}
