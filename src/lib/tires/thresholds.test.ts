import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, dualTreadMatches, psiDiffStatus, psiStatus, treadStatus, validateThresholdConfig, worstStatus } from "./thresholds";

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

describe("drive/trailer thresholds", () => {
  it("tread", () => {
    for (const cls of ["drive", "trailer"] as const) {
      expect(treadStatus(2, cls)).toBe("red");
      expect(treadStatus(0, cls)).toBe("red");
      expect(treadStatus(3, cls)).toBe("yellow");
      expect(treadStatus(6, cls)).toBe("yellow");
      expect(treadStatus(7, cls)).toBe("green");
    }
  });
  it("psi", () => {
    for (const cls of ["drive", "trailer"] as const) {
      expect(psiStatus(85, cls)).toBe("red");
      expect(psiStatus(106, cls)).toBe("red");
      expect(psiStatus(86, cls)).toBe("yellow");
      expect(psiStatus(99, cls)).toBe("yellow");
      expect(psiStatus(100, cls)).toBe("green");
      expect(psiStatus(105, cls)).toBe("green");
    }
  });
  it("spare tread uses drive rule and has no PSI status", () => {
    expect(treadStatus(2, "spare")).toBe("red");
    expect(treadStatus(7, "spare")).toBe("green");
    expect(psiStatus(50, "spare")).toBe("none");
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

describe("helpers", () => {
  it("worstStatus", () => {
    expect(worstStatus("green", "yellow", "none")).toBe("yellow");
    expect(worstStatus("red", "green")).toBe("red");
    expect(worstStatus()).toBe("none");
  });
  it("validateThresholdConfig accepts default and rejects nonsense", () => {
    expect(validateThresholdConfig(DEFAULT_THRESHOLDS).ok).toBe(true);
    expect(validateThresholdConfig({}).ok).toBe(false);
    const bad = structuredClone(DEFAULT_THRESHOLDS);
    bad.psi.steer.redBelow = 120;
    expect(validateThresholdConfig(bad).ok).toBe(false);
  });
});
