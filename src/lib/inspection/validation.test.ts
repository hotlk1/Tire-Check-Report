import { describe, expect, it } from "vitest";
import { buildLayout } from "@/lib/equipment/layout";
import { templateByKey } from "@/lib/equipment/templates";
import { DEFAULT_THRESHOLDS } from "@/lib/tires/thresholds";
import type { TireReading } from "@/lib/tires/types";
import { equipmentIssues, sanityWarnings, tireSaveIssues } from "./validation";

const layout = buildLayout([{ slot: "truck", kind: "truck", assetId: "a", unitNumber: "T", configurationId: null, configVersion: null, config: templateByKey("tractor-standard")!.config }]);
const pos = (n: number) => layout.positions.find((p) => p.number === n)!;
const r = (n: number, psi: number | null, tread32: number | null, extra: Partial<TireReading> = {}): TireReading => ({ key: pos(n).key, number: n, psi, tread32, damage: "none", photoCount: 0, ...extra });

describe("tireSaveIssues (explicit save validation)", () => {
  it("names every missing input", () => {
    expect(tireSaveIssues(r(3, null, null), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toEqual(["psi_required", "tread_required"]);
    expect(tireSaveIssues(r(3, 100, null, { damage: "repairable" }), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toEqual(["tread_required", "photo_required_damaged"]);
    expect(tireSaveIssues(r(3, 100, 12, { damage: "non_repairable" }), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toEqual(["photo_required_oos"]);
    expect(tireSaveIssues(r(3, 100, 4), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toEqual(["photo_required_tread_threshold"]);
    expect(tireSaveIssues(r(3, 100, 5), pos(3), DEFAULT_THRESHOLDS)).toEqual([]);
    expect(tireSaveIssues(r(3, 100, 4, { photoCount: 1 }), pos(3), DEFAULT_THRESHOLDS)).toEqual([]);
    const colour = { ...DEFAULT_THRESHOLDS, photoPolicy: { ...DEFAULT_THRESHOLDS.photoPolicy, treadYellow: true } };
    expect(tireSaveIssues(r(3, 100, 6), pos(3), colour).map((i) => i.code)).toEqual(["photo_required_tread"]);
  });
  it("spares need tread only; PSI policy trigger honoured", () => {
    expect(tireSaveIssues(r(11, null, null), pos(11), DEFAULT_THRESHOLDS).map((i) => i.code)).toEqual(["tread_required"]);
    const policy = { ...DEFAULT_THRESHOLDS, photoPolicy: { ...DEFAULT_THRESHOLDS.photoPolicy, psiRed: true } };
    expect(tireSaveIssues(r(3, 60, 12), pos(3), policy).map((i) => i.code)).toEqual(["photo_required_psi"]);
  });
  it("refuses impossible numbers regardless of thresholds", () => {
    expect(tireSaveIssues(r(3, 100, 99), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toContain("tread_out_of_range");
    expect(tireSaveIssues(r(3, 999, 12), pos(3), DEFAULT_THRESHOLDS).map((i) => i.code)).toContain("psi_out_of_range");
  });
});

describe("sanityWarnings", () => {
  it("uses the catalog's original tread depth when known", () => {
    expect(sanityWarnings({ psi: 100, tread32: 24 }, { originalTread32: 22 })).toEqual([{ code: "tread_above_original", original: 22 }]);
    expect(sanityWarnings({ psi: 100, tread32: 22 }, { originalTread32: 22 })).toEqual([]);
  });
  it("falls back to a generous absolute line for unknown tires", () => {
    expect(sanityWarnings({ psi: 100, tread32: 30 }, null)).toEqual([]);
    expect(sanityWarnings({ psi: 100, tread32: 35 }, null)).toEqual([{ code: "tread_unusually_high" }]);
  });
  it("PSI: max cold pressure from the catalog, else absolute lines", () => {
    expect(sanityWarnings({ psi: 128, tread32: 12 }, { maxColdPsi: 120 })).toEqual([{ code: "psi_above_max_cold", max: 120 }]);
    expect(sanityWarnings({ psi: 124, tread32: 12 }, { maxColdPsi: 120 })).toEqual([]);
    expect(sanityWarnings({ psi: 140, tread32: 12 }, null)).toEqual([{ code: "psi_unusually_high" }]);
    expect(sanityWarnings({ psi: 10, tread32: 12 }, null)).toEqual([{ code: "psi_unusually_low" }]);
  });
});

describe("equipmentIssues", () => {
  it("explains why Start inspection cannot proceed", () => {
    expect(equipmentIssues([], null)).toEqual([{ code: "no_equipment" }]);
    expect(equipmentIssues([{ slot: "truck", kind: "truck", assetId: null }], null)).toEqual([{ code: "asset_required", slot: "truck" }]);
    expect(equipmentIssues([{ slot: "truck", kind: "truck", assetId: "a" }], null)).toEqual([{ code: "odometer_required", slot: "truck" }]);
    expect(equipmentIssues([{ slot: "truck", kind: "truck", assetId: "a" }, { slot: "trailer", kind: "trailer", assetId: null }], 100)).toEqual([{ code: "asset_required", slot: "trailer" }]);
    expect(equipmentIssues([{ slot: "trailer", kind: "trailer", assetId: "b" }], null)).toEqual([]);
  });
});
