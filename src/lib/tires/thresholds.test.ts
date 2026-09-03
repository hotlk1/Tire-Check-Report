import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, dualTreadMatches, photoRequiredBy, psiDiffStatus, psiStatus, STATUTORY_MIN_TREAD_32, treadStatus, upgradeThresholdConfig, validateThresholdConfig, worstStatus, type ThresholdConfigV1 } from "./thresholds";

describe("steer tire thresholds (1–2)", () => {
  it("tread", () => {
    expect(treadStatus(4, "steer")).toBe("red");
    expect(treadStatus(3, "steer")).toBe("red");
    expect(treadStatus(5, "steer")).toBe("yellow");
    expect(treadStatus(8, "steer")).toBe("yellow");
    expect(treadStatus(9, "steer")).toBe("green");
    expect(treadStatus(null, "steer")).toBe("none");
  });
  it("psi", () => {
    expect(psiStatus(94, "steer")).toBe("red");
    expect(psiStatus(111, "steer")).toBe("red");
    expect(psiStatus(95, "steer")).toBe("yellow");
    expect(psiStatus(104, "steer")).toBe("yellow");
    expect(psiStatus(105, "steer")).toBe("green");
    expect(psiStatus(110, "steer")).toBe("green");
  });
});

describe("drive/trailer/spare thresholds", () => {
  it("tread", () => {
    for (const cls of ["drive", "trailer", "spare"] as const) {
      expect(treadStatus(2, cls)).toBe("red");
      expect(treadStatus(0, cls)).toBe("red");
      expect(treadStatus(3, cls)).toBe("yellow");
      expect(treadStatus(6, cls)).toBe("yellow");
      expect(treadStatus(7, cls)).toBe("green");
    }
  });
  it("psi", () => {
    for (const cls of ["drive", "trailer", "spare"] as const) {
      expect(psiStatus(85, cls)).toBe("red");
      expect(psiStatus(106, cls)).toBe("red");
      expect(psiStatus(86, cls)).toBe("yellow");
      expect(psiStatus(99, cls)).toBe("yellow");
      expect(psiStatus(100, cls)).toBe("green");
      expect(psiStatus(105, cls)).toBe("green");
    }
  });
});

describe("axle comparisons", () => {
  it("psi diff", () => {
    expect(psiDiffStatus(6)).toBe("green");
    expect(psiDiffStatus(7)).toBe("yellow");
    expect(psiDiffStatus(9)).toBe("yellow");
    expect(psiDiffStatus(10)).toBe("red");
    expect(psiDiffStatus(-12)).toBe("red");
    expect(psiDiffStatus(null)).toBe("none");
  });
  it("dual tread match", () => {
    expect(dualTreadMatches(2)).toBe(true);
    expect(dualTreadMatches(3)).toBe(false);
    expect(dualTreadMatches(null)).toBeNull();
  });
});

describe("photo policy", () => {
  it("system defaults: damage, OOS, yellow/red tread", () => {
    const p = DEFAULT_THRESHOLDS.photoPolicy;
    expect(photoRequiredBy(p, { damage: "repairable", treadStatus: "green", psiStatus: "green" })).toBe(true);
    expect(photoRequiredBy(p, { damage: "non_repairable", treadStatus: "green", psiStatus: "green" })).toBe(true);
    expect(photoRequiredBy(p, { damage: "none", treadStatus: "yellow", psiStatus: "green" })).toBe(true);
    expect(photoRequiredBy(p, { damage: "none", treadStatus: "red", psiStatus: "green" })).toBe(true);
    expect(photoRequiredBy(p, { damage: "none", treadStatus: "green", psiStatus: "red" })).toBe(false);
  });
  it("tenant override can add PSI triggers or drop tread ones", () => {
    const p = { ...DEFAULT_THRESHOLDS.photoPolicy, psiYellow: true, treadYellow: false };
    expect(photoRequiredBy(p, { damage: "none", treadStatus: "green", psiStatus: "yellow" })).toBe(true);
    expect(photoRequiredBy(p, { damage: "none", treadStatus: "yellow", psiStatus: "green" })).toBe(false);
  });
});

describe("configuration validation", () => {
  it("accepts the default and rejects nonsense", () => {
    expect(validateThresholdConfig(DEFAULT_THRESHOLDS).ok).toBe(true);
    expect(validateThresholdConfig({}).ok).toBe(false);
    const bad = structuredClone(DEFAULT_THRESHOLDS);
    bad.psi.steer.redBelow = 120;
    expect(validateThresholdConfig(bad).ok).toBe(false);
  });
  it("tenant override may be stricter but never below the statutory tread minimum", () => {
    const stricter = structuredClone(DEFAULT_THRESHOLDS);
    stricter.tread32.steer = { redMax: 6, yellowMax: 10 };
    stricter.tread32.drive = { redMax: 4, yellowMax: 8 };
    expect(validateThresholdConfig(stricter).ok).toBe(true);
    const illegal = structuredClone(DEFAULT_THRESHOLDS);
    illegal.tread32.steer.redMax = STATUTORY_MIN_TREAD_32.steer - 1;
    const res = validateThresholdConfig(illegal);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/statutory/);
    const illegalDrive = structuredClone(DEFAULT_THRESHOLDS);
    illegalDrive.tread32.trailer.redMax = 1;
    expect(validateThresholdConfig(illegalDrive).ok).toBe(false);
    // reading a legacy stored row never fails on the floor
    expect(validateThresholdConfig(illegal, { statutory: false }).ok).toBe(true);
  });
  it("upgrades schema-1 documents (stored before spare rules and photo policy existed)", () => {
    const v1: ThresholdConfigV1 = { schemaVersion: 1, tread32: { steer: { redMax: 4, yellowMax: 8 }, drive: { redMax: 2, yellowMax: 6 }, trailer: { redMax: 2, yellowMax: 6 } }, psi: { steer: { redBelow: 95, yellowBelow: 105, redAbove: 110 }, drive: { redBelow: 86, yellowBelow: 100, redAbove: 105 }, trailer: { redBelow: 86, yellowBelow: 100, redAbove: 105 } }, axle: { psiDiffYellow: 7, psiDiffRed: 10, dualTreadMismatch: 3 } };
    const up = upgradeThresholdConfig(v1);
    expect(up).toEqual(DEFAULT_THRESHOLDS);
    const parsed = validateThresholdConfig(v1);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config.photoPolicy).toEqual(DEFAULT_THRESHOLDS.photoPolicy);
  });
  it("helpers", () => {
    expect(worstStatus("green", "yellow", "none")).toBe("yellow");
    expect(worstStatus("red", "green")).toBe("red");
    expect(worstStatus()).toBe("none");
  });
});
