import { describe, expect, it } from "vitest";
import { blockingIssues, evaluateAxle, evaluateInspection, evaluateTire } from "./evaluate";
import { axlesForMode, getPosition, requiredTiresForMode, tiresForMode } from "./layout";
import type { TireReading } from "./types";

const r = (number: number, psi: number | null, tread32: number | null, extra: Partial<TireReading> = {}): TireReading => ({
  number,
  psi,
  tread32,
  damage: "none",
  photoCount: 0,
  ...extra,
});

describe("layout", () => {
  it("has 20 positions with the spec numbering", () => {
    expect(getPosition(1).abbreviation).toBe("L");
    expect(getPosition(2).abbreviation).toBe("R");
    expect(getPosition(3).abbreviation).toBe("LO");
    expect(getPosition(4).abbreviation).toBe("LI");
    expect(getPosition(5).abbreviation).toBe("RI");
    expect(getPosition(6).abbreviation).toBe("RO");
    expect(getPosition(11).axleKey).toBe("trailer-axle-1");
    expect(getPosition(18).axleKey).toBe("trailer-axle-2");
    expect(getPosition(19).positionClass).toBe("spare");
    expect(getPosition(20).vehicle).toBe("trailer");
  });
  it("mode filtering", () => {
    expect(requiredTiresForMode("truck")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(requiredTiresForMode("trailer")).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(tiresForMode("truck_trailer")).toHaveLength(20);
    expect(axlesForMode("trailer").map((a) => a.key)).toEqual(["trailer-axle-1", "trailer-axle-2"]);
  });
});

describe("evaluateTire", () => {
  it("is gray until complete", () => {
    expect(evaluateTire(r(1, null, null)).overall).toBe("none");
    expect(evaluateTire(r(1, 108, null)).overall).toBe("none");
    expect(evaluateTire(r(1, 108, 12)).overall).toBe("green");
  });
  it("takes the worst of psi/tread/damage", () => {
    expect(evaluateTire(r(1, 100, 12)).overall).toBe("yellow");
    expect(evaluateTire(r(1, 108, 3)).overall).toBe("red");
    expect(evaluateTire(r(3, 102, 10, { damage: "repairable" })).overall).toBe("yellow");
    expect(evaluateTire(r(3, 102, 10, { damage: "non_repairable" })).overall).toBe("red");
  });
  it("photo rules", () => {
    expect(evaluateTire(r(3, 102, 10)).photoRequired).toBe(false);
    expect(evaluateTire(r(3, 102, 5)).photoRequired).toBe(true);
    expect(evaluateTire(r(3, 102, 5)).photoMissing).toBe(true);
    expect(evaluateTire(r(3, 102, 5, { photoCount: 1 })).photoMissing).toBe(false);
    expect(evaluateTire(r(3, 102, 12, { damage: "repairable" })).photoRequired).toBe(true);
  });
  it("spares complete with tread only", () => {
    expect(evaluateTire(r(19, null, 10)).complete).toBe(true);
    expect(evaluateTire(r(19, null, 10)).overall).toBe("green");
  });
});

describe("evaluateAxle", () => {
  it("steer side-to-side", () => {
    const ax = evaluateAxle("truck-steer", { 1: r(1, 108, 12), 2: r(2, 100, 12) });
    expect(ax.sideToSidePsiDiff).toBe(8);
    expect(ax.sideToSideStatus).toBe("yellow");
    expect(ax.pairs).toHaveLength(0);
    expect(ax.complete).toBe(true);
  });
  it("waits for readings", () => {
    const ax = evaluateAxle("truck-steer", { 1: r(1, 108, 12) });
    expect(ax.sideToSidePsiDiff).toBeNull();
    expect(ax.sideToSideStatus).toBe("none");
    expect(ax.complete).toBe(false);
  });
  it("dual pairs compute psi and tread match independently", () => {
    const ax = evaluateAxle("truck-drive-1", {
      3: r(3, 100, 10),
      4: r(4, 90, 7),
      5: r(5, 102, 9),
      6: r(6, 103, 9),
    });
    const left = ax.pairs.find((p) => p.side === "left")!;
    const right = ax.pairs.find((p) => p.side === "right")!;
    expect(left.psiDiff).toBe(10);
    expect(left.psiStatus).toBe("red");
    expect(left.treadDiff).toBe(3);
    expect(left.treadMatch).toBe(false);
    expect(right.psiDiff).toBe(1);
    expect(right.psiStatus).toBe("green");
    expect(right.treadMatch).toBe(true);
    // side-to-side uses means: left 95, right 102.5 → 7.5 → yellow
    expect(ax.sideToSidePsiDiff).toBe(7.5);
    expect(ax.sideToSideStatus).toBe("yellow");
  });
});

describe("evaluateInspection + blockingIssues", () => {
  const truckAllGood: Record<number, TireReading> = {};
  for (const n of requiredTiresForMode("truck")) {
    truckAllGood[n] = r(n, n <= 2 ? 108 : 102, 12);
  }

  it("summary counts", () => {
    const ev = evaluateInspection("truck", truckAllGood);
    expect(ev.summary.total).toBe(10);
    expect(ev.summary.completed).toBe(10);
    expect(ev.summary.green).toBe(10);
    expect(ev.axles["truck-drive-2"].complete).toBe(true);
  });

  it("ready to submit when everything is filled and the spare is addressed", () => {
    const readings = { ...truckAllGood, 19: r(19, null, null, { absent: true }) };
    expect(blockingIssues({ mode: "truck", truckSelected: true, trailerSelected: false, odometer: 120000, readings })).toEqual([]);
  });

  it("blocks on missing odometer, tire, and photo", () => {
    const readings = { ...truckAllGood, 5: r(5, 102, 4), 7: r(7, null, 12) };
    const issues = blockingIssues({ mode: "truck", truckSelected: true, trailerSelected: false, odometer: null, readings });
    expect(issues).toContainEqual({ kind: "odometer_required" });
    expect(issues).toContainEqual({ kind: "tire_incomplete", tire: 7 });
    expect(issues).toContainEqual({ kind: "photo_required", tire: 5 });
  });

  it("trailer-only does not require odometer or truck", () => {
    const readings: Record<number, TireReading> = { 20: r(20, null, 9) };
    for (const n of requiredTiresForMode("trailer")) readings[n] = r(n, 102, 12);
    expect(blockingIssues({ mode: "trailer", truckSelected: false, trailerSelected: true, odometer: null, readings })).toEqual([]);
  });

  it("spares require a reading or an explicit 'No spare'", () => {
    const base = { mode: "truck" as const, truckSelected: true, trailerSelected: false, odometer: 1 };
    // untouched → must be addressed
    expect(blockingIssues({ ...base, readings: truckAllGood })).toContainEqual({ kind: "spare_required", tire: 19 });
    // touched but incomplete
    const touched = { ...truckAllGood, 19: r(19, null, null, { damage: "repairable" }) };
    expect(blockingIssues({ ...base, readings: touched })).toContainEqual({ kind: "tire_incomplete", tire: 19 });
    expect(blockingIssues({ ...base, readings: touched })).toContainEqual({ kind: "photo_required", tire: 19 });
    // explicit no spare → fine
    const absent = { ...truckAllGood, 19: r(19, null, null, { absent: true }) };
    expect(blockingIssues({ ...base, readings: absent })).toEqual([]);
    expect(evaluateTire(r(19, null, null, { absent: true })).absent).toBe(true);
    // inspected → fine
    const inspected = { ...truckAllGood, 19: r(19, null, 10) };
    expect(blockingIssues({ ...base, readings: inspected })).toEqual([]);
  });

  it("photo is mandatory for damaged, low-tread (yellow/red) and OOS tires", () => {
    const base = { mode: "truck" as const, truckSelected: true, trailerSelected: false, odometer: 1 };
    const withSpare = { ...truckAllGood, 19: r(19, null, null, { absent: true }) };
    const damaged = { ...withSpare, 3: r(3, 102, 12, { damage: "repairable" }) };
    const low = { ...withSpare, 4: r(4, 102, 5) };
    const oos = { ...withSpare, 5: r(5, 102, 12, { damage: "non_repairable" }) };
    expect(blockingIssues({ ...base, readings: damaged })).toContainEqual({ kind: "photo_required", tire: 3 });
    expect(blockingIssues({ ...base, readings: low })).toContainEqual({ kind: "photo_required", tire: 4 });
    expect(blockingIssues({ ...base, readings: oos })).toContainEqual({ kind: "photo_required", tire: 5 });
    const ok = { ...withSpare, 3: r(3, 102, 12, { damage: "repairable", photoCount: 1 }), 4: r(4, 102, 5, { photoCount: 1 }), 5: r(5, 102, 12, { damage: "non_repairable", photoCount: 2 }) };
    expect(blockingIssues({ ...base, readings: ok })).toEqual([]);
  });
});
