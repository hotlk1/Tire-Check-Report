import type { PositionClass, Status } from "./types";

/**
 * Threshold configuration (spec §6, §7, §14).
 *
 * This JSON document is what gets versioned in `threshold_versions`. Every
 * inspection stores the id of the version that was active when it was
 * submitted, so old inspections keep the rules that classified them.
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

export interface ThresholdConfig {
  schemaVersion: 1;
  tread32: Record<Exclude<PositionClass, "spare">, TreadRule> & { spare?: TreadRule };
  psi: Record<Exclude<PositionClass, "spare">, PsiRule>;
  axle: {
    psiDiffYellow: number;
    psiDiffRed: number;
    dualTreadMismatch: number;
  };
}

/** System default, matches spec §6/§7 exactly. Seeded as system threshold version 1. */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  schemaVersion: 1,
  tread32: {
    steer: { redMax: 4, yellowMax: 8 },
    drive: { redMax: 2, yellowMax: 6 },
    trailer: { redMax: 2, yellowMax: 6 },
  },
  psi: {
    // Steer: red <95 or >110, yellow 95–<105, green 105–110
    steer: { redBelow: 95, yellowBelow: 105, redAbove: 110 },
    // Drive/trailer: red <=85 or >105, yellow >85 and <100, green 100–105
    drive: { redBelow: 86, yellowBelow: 100, redAbove: 105 },
    trailer: { redBelow: 86, yellowBelow: 100, redAbove: 105 },
  },
  axle: {
    psiDiffYellow: 7,
    psiDiffRed: 10,
    dualTreadMismatch: 3,
  },
};

function treadRuleFor(config: ThresholdConfig, cls: PositionClass): TreadRule {
  if (cls === "spare") return config.tread32.spare ?? config.tread32.drive;
  return config.tread32[cls];
}

export function treadStatus(tread32: number | null | undefined, cls: PositionClass, config: ThresholdConfig = DEFAULT_THRESHOLDS): Status {
  if (tread32 === null || tread32 === undefined || Number.isNaN(tread32)) return "none";
  const rule = treadRuleFor(config, cls);
  if (tread32 <= rule.redMax) return "red";
  if (tread32 <= rule.yellowMax) return "yellow";
  return "green";
}

export function psiStatus(psi: number | null | undefined, cls: PositionClass, config: ThresholdConfig = DEFAULT_THRESHOLDS): Status {
  if (psi === null || psi === undefined || Number.isNaN(psi)) return "none";
  if (cls === "spare") return "none"; // spares have no PSI requirement
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

/** Lightweight structural validation for admin-edited configs. */
export function validateThresholdConfig(input: unknown): { ok: true; config: ThresholdConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "config must be an object" };
  const c = input as Partial<ThresholdConfig>;
  if (c.schemaVersion !== 1) return { ok: false, error: "schemaVersion must be 1" };
  for (const cls of ["steer", "drive", "trailer"] as const) {
    const t = c.tread32?.[cls];
    if (!t || typeof t.redMax !== "number" || typeof t.yellowMax !== "number" || t.redMax > t.yellowMax) {
      return { ok: false, error: `tread32.${cls} invalid` };
    }
    const p = c.psi?.[cls];
    if (
      !p ||
      typeof p.redBelow !== "number" ||
      typeof p.yellowBelow !== "number" ||
      typeof p.redAbove !== "number" ||
      !(p.redBelow <= p.yellowBelow && p.yellowBelow <= p.redAbove)
    ) {
      return { ok: false, error: `psi.${cls} invalid` };
    }
  }
  const a = c.axle;
  if (!a || typeof a.psiDiffYellow !== "number" || typeof a.psiDiffRed !== "number" || typeof a.dualTreadMismatch !== "number" || a.psiDiffYellow > a.psiDiffRed) {
    return { ok: false, error: "axle invalid" };
  }
  return { ok: true, config: c as ThresholdConfig };
}
