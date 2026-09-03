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

export interface PsiRule {
  redBelow: number;
  yellowBelow: number;
  redAbove: number;
}

export type ThresholdClass = PositionClass; // steer | drive | trailer | spare

/** When a photo becomes mandatory for a tire. */
export interface PhotoPolicy {
  damagedRepairable: boolean;
  damagedOos: boolean;
  treadYellow: boolean;
  treadRed: boolean;
  psiYellow: boolean;
  psiRed: boolean;
}

export interface ThresholdConfig {
  schemaVersion: 2;
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
export interface ThresholdConfigV1 {
  schemaVersion: 1;
  tread32: Record<Exclude<ThresholdClass, "spare">, TreadRule> & { spare?: TreadRule };
  psi: Record<Exclude<ThresholdClass, "spare">, PsiRule>;
  axle: ThresholdConfig["axle"];
}

/**
 * Statutory minimum tread depth (FMCSA 49 CFR 393.75): 4/32" on steer axles,
 * 2/32" elsewhere. A tenant cannot configure its red limit below these;
 * operational policy may be stricter (higher).
 */
export const STATUTORY_MIN_TREAD_32: Record<ThresholdClass, number> = { steer: 4, drive: 2, trailer: 2, spare: 2 };

export const DEFAULT_PHOTO_POLICY: PhotoPolicy = { damagedRepairable: true, damagedOos: true, treadYellow: true, treadRed: true, psiYellow: false, psiRed: false };

/** System default, matches spec §6/§7 exactly. Seeded as system threshold version 1. */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  schemaVersion: 2,
  tread32: {
    steer: { redMax: 4, yellowMax: 8 },
    drive: { redMax: 2, yellowMax: 6 },
    trailer: { redMax: 2, yellowMax: 6 },
    spare: { redMax: 2, yellowMax: 6 },
  },
  psi: {
    // Steer: red <95 or >110, yellow 95–<105, green 105–110
    steer: { redBelow: 95, yellowBelow: 105, redAbove: 110 },
    // Drive/trailer: red <=85 or >105, yellow >85 and <100, green 100–105
    drive: { redBelow: 86, yellowBelow: 100, redAbove: 105 },
    trailer: { redBelow: 86, yellowBelow: 100, redAbove: 105 },
    // Spares carry no PSI requirement; the rule only classifies a reading when one is entered.
    spare: { redBelow: 86, yellowBelow: 100, redAbove: 105 },
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
  if (psi < rule.yellowBelow) return "yellow";
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

/** Whether the photo policy makes a photo mandatory for these statuses. */
export function photoRequiredBy(policy: PhotoPolicy, input: { damage: "none" | "repairable" | "non_repairable"; treadStatus: Status; psiStatus: Status }): boolean {
  if (input.damage === "non_repairable" && policy.damagedOos) return true;
  if (input.damage === "repairable" && policy.damagedRepairable) return true;
  if (input.treadStatus === "red" && policy.treadRed) return true;
  if (input.treadStatus === "yellow" && policy.treadYellow) return true;
  if (input.psiStatus === "red" && policy.psiRed) return true;
  if (input.psiStatus === "yellow" && policy.psiYellow) return true;
  return false;
}

/** Upgrades a schema-1 document (stored before spare rules / photo policy existed). */
export function upgradeThresholdConfig(v1: ThresholdConfigV1): ThresholdConfig {
  return {
    schemaVersion: 2,
    tread32: { steer: v1.tread32.steer, drive: v1.tread32.drive, trailer: v1.tread32.trailer, spare: v1.tread32.spare ?? v1.tread32.drive },
    psi: { steer: v1.psi.steer, drive: v1.psi.drive, trailer: v1.psi.trailer, spare: v1.psi.drive },
    axle: v1.axle,
    photoPolicy: DEFAULT_PHOTO_POLICY,
  };
}

const CLASSES: ThresholdClass[] = ["steer", "drive", "trailer", "spare"];
const POLICY_KEYS: (keyof PhotoPolicy)[] = ["damagedRepairable", "damagedOos", "treadYellow", "treadRed", "psiYellow", "psiRed"];

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
    c = input as Partial<ThresholdConfig>;
  } else {
    return { ok: false, error: "schemaVersion must be 1 or 2" };
  }
  for (const cls of CLASSES) {
    const t = c.tread32?.[cls];
    if (!t || !isNum(t.redMax) || !isNum(t.yellowMax) || t.redMax > t.yellowMax) return { ok: false, error: `tread32.${cls} invalid` };
    if (opts.statutory !== false && t.redMax < STATUTORY_MIN_TREAD_32[cls]) {
      return { ok: false, error: `tread32.${cls}.redMax below statutory minimum ${STATUTORY_MIN_TREAD_32[cls]}/32` };
    }
    const p = c.psi?.[cls];
    if (!p || !isNum(p.redBelow) || !isNum(p.yellowBelow) || !isNum(p.redAbove) || !(p.redBelow <= p.yellowBelow && p.yellowBelow <= p.redAbove)) {
      return { ok: false, error: `psi.${cls} invalid` };
    }
  }
  const a = c.axle;
  if (!a || !isNum(a.psiDiffYellow) || !isNum(a.psiDiffRed) || !isNum(a.dualTreadMismatch) || a.psiDiffYellow > a.psiDiffRed) return { ok: false, error: "axle invalid" };
  const pp = c.photoPolicy;
  if (!pp || typeof pp !== "object") return { ok: false, error: "photoPolicy missing" };
  for (const k of POLICY_KEYS) if (typeof pp[k] !== "boolean") return { ok: false, error: `photoPolicy.${k} invalid` };
  return { ok: true, config: { schemaVersion: 2, tread32: c.tread32!, psi: c.psi!, axle: a, photoPolicy: pp } };
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
