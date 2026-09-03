import { describe, expect, it } from "vitest";
import { buildLayout, legacyLayout, requiredNumbers, type LayoutComponentInput } from "@/lib/equipment/layout";
import { templateByKey } from "@/lib/equipment/templates";
import { blockingIssues, evaluateAxle, evaluateInspection, evaluateTire } from "./evaluate";
import { DEFAULT_THRESHOLDS } from "./thresholds";
import type { TireReading } from "./types";

const comp = (slot: LayoutComponentInput["slot"], templateKey: string): LayoutComponentInput => {
  const t = templateByKey(templateKey)!;
  return { slot, kind: t.kind, assetId: `${slot}-id`, unitNumber: slot, configurationId: null, configVersion: null, config: t.config };
};
const TRUCK = buildLayout([comp("truck", "tractor-standard")]);
const BOTH = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-2-axle")]);
const pos = (n: number, layout = BOTH) => layout.positions.find((p) => p.number === n)!;
const r = (number: number, psi: number | null, tread32: number | null, extra: Partial<TireReading> = {}, layout = BOTH): TireReading => ({ key: pos(number, layout).key, number, psi, tread32, damage: "none", photoCount: 0, ...extra });

describe("evaluateTire", () => {
  it("is gray until complete and reports what is missing", () => {
    expect(evaluateTire(r(1, null, null), pos(1)).overall).toBe("none");
    expect(evaluateTire(r(1, null, null), pos(1)).missing).toEqual(["psi", "tread"]);
    expect(evaluateTire(r(1, 108, null), pos(1)).missing).toEqual(["tread"]);
    expect(evaluateTire(r(1, 108, 12), pos(1)).overall).toBe("green");
    expect(evaluateTire(r(1, 108, 12), pos(1)).complete).toBe(true);
  });
  it("takes the worst of psi/tread/damage", () => {
    expect(evaluateTire(r(1, 100, 12), pos(1)).overall).toBe("yellow");
    expect(evaluateTire(r(1, 108, 3), pos(1)).overall).toBe("red");
    expect(evaluateTire(r(3, 102, 10, { damage: "repairable", photoCount: 1 }), pos(3)).overall).toBe("yellow");
    expect(evaluateTire(r(3, 102, 10, { damage: "non_repairable", photoCount: 1 }), pos(3)).overall).toBe("red");
  });
  it("photo rules follow the policy and make the tire incomplete until satisfied", () => {
    expect(evaluateTire(r(3, 102, 10), pos(3)).photoRequired).toBe(false);
    const low = evaluateTire(r(3, 102, 5), pos(3));
    expect(low.photoRequired).toBe(true);
    expect(low.photoMissing).toBe(true);
    expect(low.complete).toBe(false);
    expect(low.missing).toEqual(["photo"]);
    expect(evaluateTire(r(3, 102, 5, { photoCount: 1 }), pos(3)).complete).toBe(true);
    expect(evaluateTire(r(3, 102, 12, { damage: "repairable" }), pos(3)).photoRequired).toBe(true);
    // tenant policy override: PSI red also needs a photo, repairable damage does not
    const policy = { ...DEFAULT_THRESHOLDS, photoPolicy: { ...DEFAULT_THRESHOLDS.photoPolicy, psiRed: true, damagedRepairable: false } };
    expect(evaluateTire(r(3, 60, 12), pos(3), policy).photoRequired).toBe(true);
    expect(evaluateTire(r(3, 102, 12, { damage: "repairable" }), pos(3), policy).photoRequired).toBe(false);
  });
  it("spares complete with tread only, classify PSI only when entered", () => {
    expect(evaluateTire(r(19, null, 10), pos(19)).complete).toBe(true);
    expect(evaluateTire(r(19, null, 10), pos(19)).overall).toBe("green");
    expect(evaluateTire(r(19, 60, 10), pos(19)).psiStatus).toBe("red");
    expect(evaluateTire(r(19, null, null), pos(19)).touched).toBe(false);
  });
});

describe("evaluateAxle", () => {
  const steer = BOTH.components[0].axles[0];
  const drive1 = BOTH.components[0].axles[1];
  it("steer side-to-side", () => {
    const ax = evaluateAxle(steer, BOTH, { 1: r(1, 108, 12), 2: r(2, 100, 12) });
    expect(ax.sideToSidePsiDiff).toBe(8);
    expect(ax.sideToSideStatus).toBe("yellow");
    expect(ax.pairs).toHaveLength(0);
    expect(ax.complete).toBe(true);
  });
  it("waits for readings", () => {
    const ax = evaluateAxle(steer, BOTH, { 1: r(1, 108, 12) });
    expect(ax.sideToSidePsiDiff).toBeNull();
    expect(ax.complete).toBe(false);
  });
  it("dual pairs compute psi and tread match independently", () => {
    const ax = evaluateAxle(drive1, BOTH, { 3: r(3, 100, 10), 4: r(4, 90, 7), 5: r(5, 102, 9), 6: r(6, 103, 9) });
    const left = ax.pairs.find((p) => p.side === "left")!;
    const right = ax.pairs.find((p) => p.side === "right")!;
    expect(left.psiDiff).toBe(10);
    expect(left.psiStatus).toBe("red");
    expect(left.treadMatch).toBe(false);
    expect(right.psiStatus).toBe("green");
    expect(right.treadMatch).toBe(true);
    expect(ax.sideToSidePsiDiff).toBe(7.5);
    expect(ax.sideToSideStatus).toBe("yellow");
  });
});

describe("evaluateInspection + blockingIssues", () => {
  const truckAllGood: Record<number, TireReading> = {};
  for (const n of requiredNumbers(TRUCK)) truckAllGood[n] = r(n, n <= 2 ? 108 : 102, 12, {}, TRUCK);

  it("summary counts required positions and spares separately", () => {
    const ev = evaluateInspection(TRUCK, truckAllGood);
    expect(ev.summary).toMatchObject({ total: 10, completed: 10, green: 10, spares: 1, sparesInspected: 0 });
    expect(ev.axles["truck/drive-2"].complete).toBe(true);
  });

  it("spares never block: untouched is fine, touched must be valid", () => {
    const base = { layout: TRUCK, odometer: 120000 };
    expect(blockingIssues({ ...base, readings: truckAllGood })).toEqual([]);
    const touched = { ...truckAllGood, 11: r(11, null, null, { damage: "repairable" }, TRUCK) };
    expect(blockingIssues({ ...base, readings: touched })).toContainEqual({ kind: "tire_incomplete", tire: 11, missing: ["tread"] });
    expect(blockingIssues({ ...base, readings: touched })).toContainEqual({ kind: "photo_required", tire: 11 });
    const inspected = { ...truckAllGood, 11: r(11, null, 10, {}, TRUCK) };
    expect(blockingIssues({ ...base, readings: inspected })).toEqual([]);
    expect(evaluateInspection(TRUCK, inspected).summary.sparesInspected).toBe(1);
  });

  it("blocks on missing odometer, tire readings, and photos", () => {
    const readings = { ...truckAllGood, 5: r(5, 102, 4, {}, TRUCK), 7: r(7, null, 12, {}, TRUCK) };
    const issues = blockingIssues({ layout: TRUCK, odometer: null, readings });
    expect(issues).toContainEqual({ kind: "odometer_required", slot: "truck" });
    expect(issues).toContainEqual({ kind: "tire_incomplete", tire: 7, missing: ["psi"] });
    expect(issues).toContainEqual({ kind: "photo_required", tire: 5 });
  });

  it("trailer-only does not require an odometer; a missing asset blocks", () => {
    const trailer = buildLayout([comp("trailer", "trailer-2-axle")]);
    const readings: Record<number, TireReading> = {};
    for (const n of requiredNumbers(trailer)) readings[n] = r(n, 102, 12, {}, trailer);
    expect(blockingIssues({ layout: trailer, odometer: null, readings })).toEqual([]);
    const noAsset = buildLayout([{ ...comp("trailer", "trailer-2-axle"), assetId: null }]);
    expect(blockingIssues({ layout: noAsset, odometer: null, readings })).toContainEqual({ kind: "asset_required", slot: "trailer" });
  });

  it("photo is mandatory for damaged, low-tread and OOS tires by default", () => {
    const base = { layout: TRUCK, odometer: 1 };
    const damaged = { ...truckAllGood, 3: r(3, 102, 12, { damage: "repairable" }, TRUCK) };
    const low = { ...truckAllGood, 4: r(4, 102, 5, {}, TRUCK) };
    const oos = { ...truckAllGood, 5: r(5, 102, 12, { damage: "non_repairable" }, TRUCK) };
    expect(blockingIssues({ ...base, readings: damaged })).toContainEqual({ kind: "photo_required", tire: 3 });
    expect(blockingIssues({ ...base, readings: low })).toContainEqual({ kind: "photo_required", tire: 4 });
    expect(blockingIssues({ ...base, readings: oos })).toContainEqual({ kind: "photo_required", tire: 5 });
    const ok = { ...truckAllGood, 3: r(3, 102, 12, { damage: "repairable", photoCount: 1 }, TRUCK), 4: r(4, 102, 5, { photoCount: 1 }, TRUCK), 5: r(5, 102, 12, { damage: "non_repairable", photoCount: 2 }, TRUCK) };
    expect(blockingIssues({ ...base, readings: ok })).toEqual([]);
  });

  it("works on a heavy-haul combination (tractor + jeep + 4-axle trailer, no spares)", () => {
    const layout = buildLayout([comp("truck", "tractor-pusher"), comp("jeep", "jeep-2-axle"), { ...comp("trailer", "trailer-4-axle"), config: { ...templateByKey("trailer-4-axle")!.config, spares: [] } }]);
    const readings: Record<number, TireReading> = {};
    for (const n of requiredNumbers(layout)) readings[n] = r(n, n <= 2 ? 108 : 102, 12, {}, layout);
    const ev = evaluateInspection(layout, readings);
    expect(ev.summary).toMatchObject({ total: 14 + 8 + 16, completed: 38, spares: 1 });
    expect(blockingIssues({ layout, odometer: 5, readings })).toEqual([]);
  });

  it("legacy inspections evaluate with the legacy layout (spare 19 declared absent)", () => {
    const layout = legacyLayout("truck", { truck: { id: "t", unitNumber: "T1" } });
    const readings: Record<number, TireReading> = {};
    for (const n of requiredNumbers(layout)) readings[n] = r(n, n <= 2 ? 108 : 102, 12, {}, layout);
    readings[19] = { key: "truck/spare-1", number: 19, psi: null, tread32: null, damage: "none", photoCount: 0, absent: true };
    const ev = evaluateInspection(layout, readings);
    expect(ev.tires[19].absent).toBe(true);
    expect(blockingIssues({ layout, odometer: 1, readings })).toEqual([]);
  });
});
