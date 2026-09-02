import { AXLES, axlesForMode, getPosition, tiresForMode } from "./layout";
import { DEFAULT_THRESHOLDS, dualTreadMatches, psiDiffStatus, psiStatus, treadStatus, worstStatus, type ThresholdConfig } from "./thresholds";
import type { AxleComparison, DualPairComparison, InspectionEvaluation, InspectionMode, Status, TireEvaluation, TireReading } from "./types";

/**
 * Pure evaluation of an inspection: per-tire statuses, axle/dual comparisons
 * and summary counters. Used identically on the client (live feedback while
 * the driver types) and on the server (persisted statuses at submit time).
 */

export function evaluateTire(reading: TireReading, config: ThresholdConfig = DEFAULT_THRESHOLDS): TireEvaluation {
  const pos = getPosition(reading.number);
  if (pos.positionClass === "spare" && reading.absent) {
    return { number: reading.number, psiStatus: "none", treadStatus: "none", damageStatus: "none", overall: "none", complete: true, absent: true, photoRequired: false, photoMissing: false };
  }
  const tStatus = treadStatus(reading.tread32, pos.positionClass, config);
  const pStatus = pos.requiresPsi ? psiStatus(reading.psi, pos.positionClass, config) : "none";
  const damageStatus: Status = reading.damage === "non_repairable" ? "red" : reading.damage === "repairable" ? "yellow" : "none";

  const hasTread = reading.tread32 !== null && reading.tread32 !== undefined;
  const hasPsi = !pos.requiresPsi || (reading.psi !== null && reading.psi !== undefined);
  const complete = hasTread && hasPsi;

  const photoRequired = reading.damage !== "none" || tStatus === "yellow" || tStatus === "red";
  const photoMissing = photoRequired && reading.photoCount === 0;

  const overall: Status = complete ? worstStatus(tStatus, pStatus, damageStatus, "green") : damageStatus !== "none" ? damageStatus : "none";

  return {
    number: reading.number,
    psiStatus: pStatus,
    treadStatus: tStatus,
    damageStatus,
    overall,
    complete,
    absent: false,
    photoRequired,
    photoMissing,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function evaluateAxle(
  axleKey: string,
  readings: Record<number, TireReading | undefined>,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): AxleComparison {
  const axle = AXLES.find((a) => a.key === axleKey);
  if (!axle) throw new Error(`Unknown axle ${axleKey}`);

  const get = (n: number) => readings[n];
  const psiOf = (n: number) => get(n)?.psi ?? null;
  const treadOf = (n: number) => get(n)?.tread32 ?? null;

  const pairs: DualPairComparison[] = [];
  if (axle.dual) {
    const [lo, li, ri, ro] = axle.tires;
    for (const [side, a, b] of [
      ["left", lo, li],
      ["right", ri, ro],
    ] as const) {
      const pa = psiOf(a);
      const pb = psiOf(b);
      const ta = treadOf(a);
      const tb = treadOf(b);
      const psiDiff = pa !== null && pb !== null ? Math.abs(pa - pb) : null;
      const treadDiff = ta !== null && tb !== null ? Math.abs(ta - tb) : null;
      pairs.push({
        axleKey,
        side,
        tires: [a, b],
        psiDiff,
        psiStatus: psiDiffStatus(psiDiff, config),
        treadDiff,
        treadMatch: dualTreadMatches(treadDiff, config),
      });
    }
  }

  const leftTires = axle.tires.filter((n) => getPosition(n).side === "left");
  const rightTires = axle.tires.filter((n) => getPosition(n).side === "right");
  const leftPsi = leftTires.map(psiOf);
  const rightPsi = rightTires.map(psiOf);
  const allPsiPresent = [...leftPsi, ...rightPsi].every((v) => v !== null);
  const sideToSidePsiDiff = allPsiPresent
    ? Math.abs((mean(leftPsi as number[]) ?? 0) - (mean(rightPsi as number[]) ?? 0))
    : null;
  const rounded = sideToSidePsiDiff === null ? null : Math.round(sideToSidePsiDiff * 10) / 10;

  const complete = axle.tires.every((n) => {
    const r = get(n);
    return !!r && r.psi !== null && r.psi !== undefined && r.tread32 !== null && r.tread32 !== undefined;
  });

  return {
    axleKey,
    sideToSidePsiDiff: rounded,
    sideToSideStatus: psiDiffStatus(rounded, config),
    pairs,
    complete,
  };
}

export function evaluateInspection(
  mode: InspectionMode,
  readings: Record<number, TireReading | undefined>,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): InspectionEvaluation {
  const tires: Record<number, TireEvaluation> = {};
  const numbers = tiresForMode(mode);
  const summary = { total: 0, completed: 0, red: 0, yellow: 0, green: 0, damaged: 0, outOfService: 0, photosMissing: [] as number[] };

  for (const n of numbers) {
    const reading = readings[n] ?? { number: n, psi: null, tread32: null, damage: "none" as const, photoCount: 0 };
    const ev = evaluateTire(reading, config);
    tires[n] = ev;
    const spare = getPosition(n).positionClass === "spare";
    if (!spare) summary.total += 1;
    if (ev.complete && !ev.absent) {
      if (!spare) summary.completed += 1;
      if (ev.overall === "red") summary.red += 1;
      else if (ev.overall === "yellow") summary.yellow += 1;
      else if (ev.overall === "green") summary.green += 1;
    }
    if (reading.damage !== "none") summary.damaged += 1;
    if (reading.damage === "non_repairable") summary.outOfService += 1;
    if (ev.photoMissing) summary.photosMissing.push(n);
  }

  const axles: Record<string, AxleComparison> = {};
  for (const axle of axlesForMode(mode)) {
    axles[axle.key] = evaluateAxle(axle.key, readings, config);
  }

  return { tires, axles, summary };
}

/** Reasons an inspection cannot be submitted yet. Empty array = ready. */
export type BlockingIssue =
  | { kind: "tire_incomplete"; tire: number }
  | { kind: "spare_required"; tire: number }
  | { kind: "photo_required"; tire: number }
  | { kind: "odometer_required" }
  | { kind: "truck_required" }
  | { kind: "trailer_required" };

export function blockingIssues(input: {
  mode: InspectionMode;
  truckSelected: boolean;
  trailerSelected: boolean;
  odometer: number | null;
  readings: Record<number, TireReading | undefined>;
  config?: ThresholdConfig;
}): BlockingIssue[] {
  const issues: BlockingIssue[] = [];
  const needsTruck = input.mode !== "trailer";
  const needsTrailer = input.mode !== "truck";
  if (needsTruck && !input.truckSelected) issues.push({ kind: "truck_required" });
  if (needsTrailer && !input.trailerSelected) issues.push({ kind: "trailer_required" });
  if (needsTruck && (input.odometer === null || Number.isNaN(input.odometer))) issues.push({ kind: "odometer_required" });

  const ev = evaluateInspection(input.mode, input.readings, input.config);
  for (const n of tiresForMode(input.mode)) {
    const t = ev.tires[n];
    const spare = getPosition(n).positionClass === "spare";
    const reading = input.readings[n];
    const touched = !!reading && (reading.psi !== null || reading.tread32 !== null || reading.damage !== "none" || reading.photoCount > 0);
    if (!spare && !t.complete) issues.push({ kind: "tire_incomplete", tire: n });
    // Spares are never silently skipped: either a tread/damage reading or an explicit "No spare".
    if (spare && !t.complete) issues.push({ kind: touched ? "tire_incomplete" : "spare_required", tire: n });
    if (t.photoMissing) issues.push({ kind: "photo_required", tire: n });
  }
  return issues;
}
