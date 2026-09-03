import type { InspectionLayout, LayoutAxle, LayoutPosition } from "@/lib/equipment/layout";
import { DEFAULT_THRESHOLDS, dualTreadMatches, photoReasonBy, psiDiffStatus, psiStatus, treadStatus, worstStatus, type ThresholdConfig } from "./thresholds";
import type { AxleComparison, DualPairComparison, InspectionEvaluation, MissingInput, Status, TireEvaluation, TireReading } from "./types";

/**
 * Pure evaluation of an inspection against a layout and a rules version:
 * per-tire statuses, axle/dual comparisons and summary counters. Used
 * identically on the client (live feedback while the driver types) and on
 * the server (persisted statuses at submit time).
 */
export function isTouched(r: TireReading | undefined): boolean {
  return !!r && (r.psi !== null || r.tread32 !== null || r.damage !== "none" || r.photoCount > 0 || !!r.absent);
}

export function evaluateTire(reading: TireReading, pos: LayoutPosition, config: ThresholdConfig = DEFAULT_THRESHOLDS): TireEvaluation {
  const base = { key: pos.key, number: pos.number };
  if (pos.isSpare && reading.absent) {
    return { ...base, psiStatus: "none", treadStatus: "none", damageStatus: "none", overall: "none", complete: true, touched: true, absent: true, photoRequired: false, photoReason: null, photoMissing: false, missing: [] };
  }
  const tStatus = treadStatus(reading.tread32, pos.positionClass, config);
  const pStatus = pos.requiresPsi || reading.psi !== null ? psiStatus(reading.psi, pos.positionClass, config) : "none";
  const damageStatus: Status = reading.damage === "non_repairable" ? "red" : reading.damage === "repairable" ? "yellow" : "none";

  const missing: MissingInput[] = [];
  if (pos.requiresPsi && (reading.psi === null || reading.psi === undefined)) missing.push("psi");
  if (reading.tread32 === null || reading.tread32 === undefined) missing.push("tread");
  const photoReason = photoReasonBy(config.photoPolicy, { damage: reading.damage, treadStatus: tStatus, psiStatus: pStatus, tread32: reading.tread32, cls: pos.positionClass });
  const photoRequired = photoReason !== null;
  const photoMissing = photoRequired && reading.photoCount === 0;
  if (photoMissing) missing.push("photo");

  const readingsComplete = !missing.includes("psi") && !missing.includes("tread");
  const complete = readingsComplete && !photoMissing;
  const overall: Status = readingsComplete ? worstStatus(tStatus, pStatus, damageStatus, "green") : damageStatus !== "none" ? damageStatus : "none";

  return { ...base, psiStatus: pStatus, treadStatus: tStatus, damageStatus, overall, complete, touched: isTouched(reading), absent: false, photoRequired, photoReason, photoMissing, missing };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function evaluateAxle(axle: LayoutAxle, layout: InspectionLayout, readings: Record<number, TireReading | undefined>, config: ThresholdConfig = DEFAULT_THRESHOLDS): AxleComparison {
  const get = (n: number) => readings[n];
  const psiOf = (n: number) => get(n)?.psi ?? null;
  const treadOf = (n: number) => get(n)?.tread32 ?? null;
  const posOf = (n: number) => layout.positions.find((p) => p.number === n)!;

  const pairs: DualPairComparison[] = [];
  if (axle.dual) {
    const [lo, li, ri, ro] = axle.tires;
    for (const [side, a, b] of [["left", lo, li], ["right", ri, ro]] as const) {
      const pa = psiOf(a);
      const pb = psiOf(b);
      const ta = treadOf(a);
      const tb = treadOf(b);
      const psiDiff = pa !== null && pb !== null ? Math.abs(pa - pb) : null;
      const treadDiff = ta !== null && tb !== null ? Math.abs(ta - tb) : null;
      pairs.push({ axleKey: axle.key, side, tires: [a, b], psiDiff, psiStatus: psiDiffStatus(psiDiff, config), treadDiff, treadMatch: dualTreadMatches(treadDiff, config) });
    }
  }

  const leftPsi = axle.tires.filter((n) => posOf(n).side === "left").map(psiOf);
  const rightPsi = axle.tires.filter((n) => posOf(n).side === "right").map(psiOf);
  const allPsiPresent = [...leftPsi, ...rightPsi].every((v) => v !== null);
  const sideToSidePsiDiff = allPsiPresent ? Math.abs((mean(leftPsi as number[]) ?? 0) - (mean(rightPsi as number[]) ?? 0)) : null;
  const rounded = sideToSidePsiDiff === null ? null : Math.round(sideToSidePsiDiff * 10) / 10;
  const complete = axle.tires.every((n) => {
    const r = get(n);
    return !!r && r.psi !== null && r.tread32 !== null;
  });
  return { axleKey: axle.key, sideToSidePsiDiff: rounded, sideToSideStatus: psiDiffStatus(rounded, config), pairs, complete };
}

export function emptyReading(pos: LayoutPosition): TireReading {
  return { key: pos.key, number: pos.number, psi: null, tread32: null, damage: "none", photoCount: 0 };
}

export function evaluateInspection(layout: InspectionLayout, readings: Record<number, TireReading | undefined>, config: ThresholdConfig = DEFAULT_THRESHOLDS): InspectionEvaluation {
  const tires: Record<number, TireEvaluation> = {};
  const summary = { total: 0, completed: 0, red: 0, yellow: 0, green: 0, damaged: 0, outOfService: 0, photosMissing: [] as number[], spares: 0, sparesInspected: 0 };

  for (const pos of layout.positions) {
    const reading = readings[pos.number] ?? emptyReading(pos);
    const ev = evaluateTire(reading, pos, config);
    tires[pos.number] = ev;
    if (pos.isSpare) {
      summary.spares += 1;
      if (ev.complete && !ev.absent && ev.touched) summary.sparesInspected += 1;
    } else {
      summary.total += 1;
      if (ev.complete) summary.completed += 1;
    }
    if (ev.complete && !ev.absent && ev.touched) {
      if (ev.overall === "red") summary.red += 1;
      else if (ev.overall === "yellow") summary.yellow += 1;
      else if (ev.overall === "green") summary.green += 1;
    }
    if (reading.damage !== "none") summary.damaged += 1;
    if (reading.damage === "non_repairable") summary.outOfService += 1;
    if (ev.photoMissing) summary.photosMissing.push(pos.number);
  }

  const axles: Record<string, AxleComparison> = {};
  for (const c of layout.components) for (const axle of c.axles) axles[axle.key] = evaluateAxle(axle, layout, readings, config);
  return { tires, axles, summary };
}

/** Reasons an inspection cannot be submitted yet. Empty array = ready. */
export type BlockingIssue =
  | { kind: "tire_incomplete"; tire: number; missing: MissingInput[] }
  | { kind: "photo_required"; tire: number }
  | { kind: "odometer_required"; slot: string }
  | { kind: "asset_required"; slot: string }
  | { kind: "no_equipment" };

export function blockingIssues(input: {
  layout: InspectionLayout;
  odometer: number | null;
  readings: Record<number, TireReading | undefined>;
  config?: ThresholdConfig;
}): BlockingIssue[] {
  const issues: BlockingIssue[] = [];
  if (input.layout.components.length === 0) issues.push({ kind: "no_equipment" });
  for (const c of input.layout.components) {
    if (!c.assetId) issues.push({ kind: "asset_required", slot: c.slot });
    if (c.kind === "truck" && (input.odometer === null || Number.isNaN(input.odometer))) issues.push({ kind: "odometer_required", slot: c.slot });
  }
  const ev = evaluateInspection(input.layout, input.readings, input.config);
  for (const pos of input.layout.positions) {
    const t = ev.tires[pos.number];
    // Spares are optional: only validated when the driver entered something.
    if (pos.isSpare && !t.touched) continue;
    const readingsMissing = t.missing.filter((m) => m !== "photo");
    if (readingsMissing.length) issues.push({ kind: "tire_incomplete", tire: pos.number, missing: readingsMissing });
    if (t.photoMissing) issues.push({ kind: "photo_required", tire: pos.number });
  }
  return issues;
}
