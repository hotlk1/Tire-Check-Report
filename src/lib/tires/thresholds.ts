import type { PositionClass, Status } from "./types";

/**
 * Rules configuration (thresholds + photo policy), spec §6, §7, §14.
 *
 * This JSON document is what gets versioned in `threshold_versions`. The
 * system defaults live in the row with tenant_id NULL; a tenant override is a
 * new tenant row. Every inspection stores the id of the version that was
 * active when it was submitted, so old inspections keep the rules (thresholds
 * AND photo policy) that classified them.
 *
 * Semantics (all values inclusive unless the name says otherwise):
 *  tread:  tread <= redMax → red; tread <= yellowMax → yellow; else green
 *  psi:    psi < redBelow OR psi > redAbove → red; psi < yellowBelow → yellow; else green
 *  axle:   |Δpsi| >= psiDiffRed → red; >= psiDiffYellow → yellow; else green
 *          |Δtread| >= dualTreadMismatch → "≠", else "="
 */
export interface TreadRule {
  redMax: number;
  yellowMax: number;
}

/**
 * PSI bands: red below `redBelow`; yellow from `redBelow` to below
 * `yellowBelow`; green from `yellowBelow` to `yellowAbove`; yellow above
 * `yellowAbove` up to `redAbove`; red above `redAbove`.
 */
export interface PsiRule {
  redBelow: number;
  yellowBelow: number;
  yellowAbove: number;
  redAbove: number;
}

export type ThresholdClass = PositionClass; // steer | drive | trailer | spare

/**
 * When a photo becomes mandatory for a tire. `treadBelow32` is a per-class
 * tread depth (32nds) under which a photo is required, independent of the
 * green/yellow/red thresholds; null disables that trigger for the class.
 */
export interface PhotoPolicy {
  damagedRepairable: boolean;
  damagedOos: boolean;
  treadYellow: boolean;
  treadRed: boolean;
  psiYellow: boolean;
  psiRed: boolean;
  treadBelow32: Record<ThresholdClass, number | null>;
}

export interface ThresholdConfig {
  schemaVersion: 3;
  tread32: Record<ThresholdClass, TreadRule>;
  psi: Record<ThresholdClass, PsiRule>;
  axle: {
    psiDiffYellow: number;
    psiDiffRed: number;
    dualTreadMismatch: number;
  };
  photoPolicy: PhotoPolicy;
}

/** Stored documents may still be schema 1 (no spare class, no photo policy). */
export interface PsiRuleV1 {
  redBelow: number;
  yellowBelow: number;
  redAbove: number;
}
export interface ThresholdConfigV1 {
  schemaVersion: 1;
  tread32: Record<Exclude<ThresholdClass, "spare">, TreadRule> & { spare?: TreadRule };
  psi: Record<Exclude<ThresholdClass, "spare">, PsiRuleV1>;
  axle: ThresholdConfig["axle"];
}
/** Schema 2: spare class + boolean photo policy, PSI without a high yellow band. */
export interface ThresholdConfigV2 {
  schemaVersion: 2;
  tread32: Record<ThresholdClass, TreadRule>;
  psi: Record<ThresholdClass, PsiRuleV1>;
  axle: ThresholdConfig["axle"];
  photoPolicy: Omit<PhotoPolicy, "treadBelow32">;
}

/**
 * Statutory minimum tread depth (FMCSA 49 CFR 393.75): 4/32" on steer axles,
 * 2/32" elsewhere. A tenant cannot configure its red limit below these;
 * operational policy may be stricter (higher).
 */
export const STATUTORY_MIN_TREAD_32: Record<ThresholdClass, number> = { steer: 4, drive: 2, trailer: 2, spare: 2 };

/** Photo mandatory for damage / OOS and under a per-class tread depth (steer 3/32, others 5/32). */
export const DEFAULT_PHOTO_POLICY: PhotoPolicy = { damagedRepairable: true, damagedOos: true, treadYellow: false, treadRed: false, psiYellow: false, psiRed: false, treadBelow32: { steer: 3, drive: 5, trailer: 5, spare: 5 } };

/** System default (system threshold version 3). Tread per spec §6/§7; PSI with a high yellow band so a hot tire is not "out of service". */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  schemaVersion: 3,
  tread32: {
    steer: { redMax: 4, yellowMax: 8 },
    drive: { redMax: 2, yellowMax: 6 },
    trailer: { redMax: 2, yellowMax: 6 },
    spare: { redMax: 2, yellowMax: 6 },
  },
  psi: {
    // Steer: red <95, yellow 95–104, green 105–110, yellow 111–125, red >125
    steer: { redBelow: 95, yellowBelow: 105, yellowAbove: 110, redAbove: 125 },
    // Drive/trailer: red <=85, yellow 86–99, green 100–105, yellow 106–120, red >120
    drive: { redBelow: 86, yellowBelow: 100, yellowAbove: 105, redAbove: 120 },
    trailer: { redBelow: 86, yellowBelow: 100, yellowAbove: 105, redAbove: 120 },
    // Spares carry no PSI requirement; the rule only classifies a reading when one is entered.
    spare: { redBelow: 86, yellowBelow: 100, yellowAbove: 105, redAbove: 120 },
  },
  axle: {
    psiDiffYellow: 7,
    psiDiffRed: 10,
    dualTreadMismatch: 3,
  },
  photoPolicy: DEFAULT_PHOTO_POLICY,
};

/**
 * Absolute numeric sanity limits for driver input. These are NOT thresholds:
 * they only reject impossible readings (a typo like 99/32). Commercial truck
 * tires ship with roughly 12–32/32" of tread; cold inflation rarely exceeds
 * 130 PSI even on load range L tires. Values above the "confirm" line ask the
 * driver to double-check; values above "max" are refused.
 */
export const INPUT_LIMITS = {
  tread32: { min: 0, max: 40, confirmAbove: 32 },
  psi: { min: 0, max: 160, confirmAbove: 130, confirmBelow: 20 },
} as const;

export function treadStatus(tread32: number | null | undefined, cls: PositionClass, config: ThresholdConfig = DEFAULT_THRESHOLDS): Status {
  if (tread32 === null || tread32 === undefined || Number.isNaN(tread32)) return "none";
  const rule = config.tread32[cls];
  if (tread32 <= rule.redMax) return "red";
  if (tread32 <= rule.yellowMax) return "yellow";
  return "green";
}

export function psiStatus(psi: number | null | undefined, cls: PositionClass, config: ThresholdConfig = DEFAULT_THRESHOLDS): Status {
  if (psi === null || psi === undefined || Number.isNaN(psi)) return "none";
  const rule = config.psi[cls];
  if (psi < rule.redBelow || psi > rule.redAbove) return "red";
  if (psi < rule.yellowBelow || psi > rule.yellowAbove) return "yellow";
  return "green";
}

export function psiDiffStatus(diff: number | null, config: ThresholdConfig = DEFAULT_THRESHOLDS): Status {
  if (diff === null || Number.isNaN(diff)) return "none";
  const d = Math.abs(diff);
  if (d >= config.axle.psiDiffRed) return "red";
  if (d >= config.axle.psiDiffYellow) return "yellow";
  return "green";
}

export function dualTreadMatches(diff: number | null, config: ThresholdConfig = DEFAULT_THRESHOLDS): boolean | null {
  if (diff === null || Number.isNaN(diff)) return null;
  return Math.abs(diff) < config.axle.dualTreadMismatch;
}

const RANK: Record<Status, number> = { none: 0, green: 1, yellow: 2, red: 3 };

export function worstStatus(...statuses: Status[]): Status {
  return statuses.reduce<Status>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "none");
}

export type PhotoReason = "damaged" | "oos" | "tread_threshold" | "tread_status" | "psi_status";

/** Why the photo policy makes a photo mandatory for this reading, or null. */
export function photoReasonBy(policy: PhotoPolicy, input: { damage: "none" | "repairable" | "non_repairable"; treadStatus: Status; psiStatus: Status; tread32?: number | null; cls?: ThresholdClass }): PhotoReason | null {
  if (input.damage === "non_repairable" && policy.damagedOos) return "oos";
  if (input.damage === "repairable" && policy.damagedRepairable) return "damaged";
  const below = input.cls ? policy.treadBelow32[input.cls] : null;
  if (below !== null && below !== undefined && input.tread32 !== null && input.tread32 !== undefined && input.tread32 < below) return "tread_threshold";
  if (input.treadStatus === "red" && policy.treadRed) return "tread_status";
  if (input.treadStatus === "yellow" && policy.treadYellow) return "tread_status";
  if (input.psiStatus === "red" && policy.psiRed) return "psi_status";
  if (input.psiStatus === "yellow" && policy.psiYellow) return "psi_status";
  return null;
}

/** Whether the photo policy makes a photo mandatory for this reading. */
export function photoRequiredBy(policy: PhotoPolicy, input: Parameters<typeof photoReasonBy>[1]): boolean {
  return photoReasonBy(policy, input) !== null;
}

/** Old PSI rules had no high yellow band: everything above redAbove was red, nothing above was yellow. */
function upgradePsi(p: PsiRuleV1): PsiRule {
  return { redBelow: p.redBelow, yellowBelow: p.yellowBelow, yellowAbove: p.redAbove, redAbove: p.redAbove };
}

/** Upgrades a schema-1 document (stored before spare rules / photo policy existed). Classification of old readings is unchanged. */
export function upgradeThresholdConfig(v1: ThresholdConfigV1): ThresholdConfig {
  return {
    schemaVersion: 3,
    tread32: { steer: v1.tread32.steer, drive: v1.tread32.drive, trailer: v1.tread32.trailer, spare: v1.tread32.spare ?? v1.tread32.drive },
    psi: { steer: upgradePsi(v1.psi.steer), drive: upgradePsi(v1.psi.drive), trailer: upgradePsi(v1.psi.trailer), spare: upgradePsi(v1.psi.drive) },
    axle: v1.axle,
    // Schema-1 inspections required photos for yellow/red tread (spec §9); keep that behaviour for them.
    photoPolicy: { damagedRepairable: true, damagedOos: true, treadYellow: true, treadRed: true, psiYellow: false, psiRed: false, treadBelow32: { steer: null, drive: null, trailer: null, spare: null } },
  };
}

/** Upgrades a schema-2 document. Classification and photo triggers of old readings are unchanged. */
export function upgradeThresholdConfigV2(v2: ThresholdConfigV2): ThresholdConfig {
  return {
    schemaVersion: 3,
    tread32: v2.tread32,
    psi: { steer: upgradePsi(v2.psi.steer), drive: upgradePsi(v2.psi.drive), trailer: upgradePsi(v2.psi.trailer), spare: upgradePsi(v2.psi.spare) },
    axle: v2.axle,
    photoPolicy: { ...v2.photoPolicy, treadBelow32: { steer: null, drive: null, trailer: null, spare: null } },
  };
}

const CLASSES: ThresholdClass[] = ["steer", "drive", "trailer", "spare"];
const POLICY_KEYS: (keyof Omit<PhotoPolicy, "treadBelow32">)[] = ["damagedRepairable", "damagedOos", "treadYellow", "treadRed", "psiYellow", "psiRed"];

/**
 * Structural + statutory validation for admin-edited configs. Accepts schema 1
 * (upgraded transparently) and schema 2. `statutory: false` skips the legal
 * floor (only for reading legacy stored rows, never for publishing).
 */
export function validateThresholdConfig(input: unknown, opts: { statutory?: boolean } = {}): { ok: true; config: ThresholdConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "config must be an object" };
  const raw = input as { schemaVersion?: number };
  let c: Partial<ThresholdConfig>;
  if (raw.schemaVersion === 1) {
    const v1 = validateV1(input as Partial<ThresholdConfigV1>);
    if (!v1.ok) return v1;
    c = upgradeThresholdConfig(v1.config);
  } else if (raw.schemaVersion === 2) {
    const v2 = validateV2(input as Partial<ThresholdConfigV2>);
    if (!v2.ok) return v2;
    c = upgradeThresholdConfigV2(v2.config);
  } else if (raw.schemaVersion === 3) {
    c = input as Partial<ThresholdConfig>;
  } else {
    return { ok: false, error: "schemaVersion must be 1, 2 or 3" };
  }
  for (const cls of CLASSES) {
    const t = c.tread32?.[cls];
    if (!t || !isNum(t.redMax) || !isNum(t.yellowMax) || t.redMax > t.yellowMax) return { ok: false, error: `tread32.${cls} invalid` };
    if (opts.statutory !== false && t.redMax < STATUTORY_MIN_TREAD_32[cls]) {
      return { ok: false, error: `tread32.${cls}.redMax below statutory minimum ${STATUTORY_MIN_TREAD_32[cls]}/32` };
    }
    const p = c.psi?.[cls];
    if (!p || !isNum(p.redBelow) || !isNum(p.yellowBelow) || !isNum(p.yellowAbove) || !isNum(p.redAbove) || !(p.redBelow <= p.yellowBelow && p.yellowBelow <= p.yellowAbove && p.yellowAbove <= p.redAbove)) {
      return { ok: false, error: `psi.${cls} invalid` };
    }
  }
  const a = c.axle;
  if (!a || !isNum(a.psiDiffYellow) || !isNum(a.psiDiffRed) || !isNum(a.dualTreadMismatch) || a.psiDiffYellow > a.psiDiffRed) return { ok: false, error: "axle invalid" };
  const pp = c.photoPolicy;
  if (!pp || typeof pp !== "object") return { ok: false, error: "photoPolicy missing" };
  for (const k of POLICY_KEYS) if (typeof pp[k] !== "boolean") return { ok: false, error: `photoPolicy.${k} invalid` };
  if (!pp.treadBelow32 || typeof pp.treadBelow32 !== "object") return { ok: false, error: "photoPolicy.treadBelow32 missing" };
  for (const cls of CLASSES) {
    const v = pp.treadBelow32[cls];
    if (v !== null && (!isNum(v) || v < 0 || v > 40)) return { ok: false, error: `photoPolicy.treadBelow32.${cls} invalid` };
  }
  return { ok: true, config: { schemaVersion: 3, tread32: c.tread32!, psi: c.psi!, axle: a, photoPolicy: pp } };
}

function validateV2(c: Partial<ThresholdConfigV2>): { ok: true; config: ThresholdConfigV2 } | { ok: false; error: string } {
  for (const cls of CLASSES) {
    const t = c.tread32?.[cls];
    if (!t || !isNum(t.redMax) || !isNum(t.yellowMax) || t.redMax > t.yellowMax) return { ok: false, error: `tread32.${cls} invalid` };
    const p = c.psi?.[cls];
    if (!p || !isNum(p.redBelow) || !isNum(p.yellowBelow) || !isNum(p.redAbove) || !(p.redBelow <= p.yellowBelow && p.yellowBelow <= p.redAbove)) return { ok: false, error: `psi.${cls} invalid` };
  }
  const a = c.axle;
  if (!a || !isNum(a.psiDiffYellow) || !isNum(a.psiDiffRed) || !isNum(a.dualTreadMismatch) || a.psiDiffYellow > a.psiDiffRed) return { ok: false, error: "axle invalid" };
  const pp = c.photoPolicy;
  if (!pp || typeof pp !== "object") return { ok: false, error: "photoPolicy missing" };
  for (const k of POLICY_KEYS) if (typeof pp[k] !== "boolean") return { ok: false, error: `photoPolicy.${k} invalid` };
  return { ok: true, config: c as ThresholdConfigV2 };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateV1(c: Partial<ThresholdConfigV1>): { ok: true; config: ThresholdConfigV1 } | { ok: false; error: string } {
  for (const cls of ["steer", "drive", "trailer"] as const) {
    const t = c.tread32?.[cls];
    if (!t || !isNum(t.redMax) || !isNum(t.yellowMax) || t.redMax > t.yellowMax) return { ok: false, error: `tread32.${cls} invalid` };
    const p = c.psi?.[cls];
    if (!p || !isNum(p.redBelow) || !isNum(p.yellowBelow) || !isNum(p.redAbove) || !(p.redBelow <= p.yellowBelow && p.yellowBelow <= p.redAbove)) return { ok: false, error: `psi.${cls} invalid` };
  }
  const a = c.axle;
  if (!a || !isNum(a.psiDiffYellow) || !isNum(a.psiDiffRed) || !isNum(a.dualTreadMismatch) || a.psiDiffYellow > a.psiDiffRed) return { ok: false, error: "axle invalid" };
  return { ok: true, config: c as ThresholdConfigV1 };
}
