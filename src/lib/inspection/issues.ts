import type { InspectionLayout } from "@/lib/equipment/layout";
import { blockingIssues, evaluateInspection } from "@/lib/tires/evaluate";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "@/lib/tires/thresholds";
import type { TireReading } from "@/lib/tires/types";

/**
 * "Needs attention" list for the review screen and the report (design §1a
 * summary). Pure: combines threshold evaluation with submission-blocking
 * rules so the UI only formats.
 */
export type IssueTag = "oos" | "dmg" | "psi" | "tread" | "missing" | "photo";
export type IssueStatus = "none" | "green" | "yellow" | "red";

export interface Issue {
  tire: number;
  key: string;
  tag: IssueTag;
  status: IssueStatus;
  /** i18n key under design.issue.* */
  textKey: "psiLow" | "psiHigh" | "psiWarn" | "treadCrit" | "treadWarn" | "missingPsi" | "missingTread" | "missingBoth" | "photo" | "damage" | "oos";
  params?: Record<string, string | number>;
  /** true = prevents submission */
  blocking: boolean;
}

export function buildIssues(input: { layout: InspectionLayout; readings: Record<number, TireReading | undefined>; odometer: number | null; config?: ThresholdConfig }): Issue[] {
  const config = input.config ?? DEFAULT_THRESHOLDS;
  const ev = evaluateInspection(input.layout, input.readings, config);
  const blocking = blockingIssues({ layout: input.layout, odometer: input.odometer, readings: input.readings, config });
  const out: Issue[] = [];
  for (const pos of input.layout.positions) {
    const n = pos.number;
    const r = input.readings[n];
    const t = ev.tires[n];
    if (r?.absent) continue;
    if (r?.damage === "non_repairable") out.push({ tire: n, key: pos.key, tag: "oos", status: "red", textKey: "oos", blocking: false });
    else if (r?.damage === "repairable") out.push({ tire: n, key: pos.key, tag: "dmg", status: "yellow", textKey: "damage", blocking: false });
    if (t.psiStatus === "red" && r?.psi != null) {
      const rule = config.psi[pos.positionClass];
      out.push({ tire: n, key: pos.key, tag: "psi", status: "red", textKey: r.psi < rule.redBelow ? "psiLow" : "psiHigh", params: { psi: r.psi }, blocking: false });
    } else if (t.psiStatus === "yellow" && r?.psi != null) {
      out.push({ tire: n, key: pos.key, tag: "psi", status: "yellow", textKey: "psiWarn", params: { psi: r.psi }, blocking: false });
    }
    if (t.treadStatus === "red" && r?.tread32 != null) out.push({ tire: n, key: pos.key, tag: "tread", status: "red", textKey: "treadCrit", params: { tread: r.tread32 }, blocking: false });
    else if (t.treadStatus === "yellow" && r?.tread32 != null) out.push({ tire: n, key: pos.key, tag: "tread", status: "yellow", textKey: "treadWarn", params: { tread: r.tread32 }, blocking: false });
    for (const b of blocking) {
      if (!("tire" in b) || b.tire !== n) continue;
      if (b.kind === "tire_incomplete") {
        const textKey = b.missing.includes("psi") && b.missing.includes("tread") ? "missingBoth" : b.missing.includes("psi") ? "missingPsi" : "missingTread";
        out.push({ tire: n, key: pos.key, tag: "missing", status: "none", textKey, blocking: true });
      }
      if (b.kind === "photo_required") out.push({ tire: n, key: pos.key, tag: "photo", status: "red", textKey: "photo", blocking: true });
    }
  }
  // blocking first, then by severity, then by tire number
  const rank: Record<IssueStatus, number> = { red: 0, yellow: 1, none: 2, green: 3 };
  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking) || rank[a.status] - rank[b.status] || a.tire - b.tire);
}

export function verdictOf(issues: Issue[]): "action" | "watch" | "clear" {
  if (issues.some((i) => i.status === "red")) return "action";
  if (issues.length) return "watch";
  return "clear";
}
