import { describe, expect, it } from "vitest";
import { buildLayout, legacyLayout, modeOf, requiredNumbers, spareNumbers, type LayoutComponentInput } from "./layout";
import { defaultConfigFor, templateByKey, TEMPLATES } from "./templates";
import { validateEquipmentConfig, wheelPositionsOf } from "./types";

const comp = (slot: LayoutComponentInput["slot"], templateKey: string, unit = slot.toUpperCase()): LayoutComponentInput => {
  const t = templateByKey(templateKey)!;
  return { slot, kind: t.kind, assetId: `${slot}-id`, unitNumber: unit, configurationId: null, configVersion: null, config: t.config };
};

describe("equipment templates", () => {
  it("every template is structurally valid", () => {
    for (const t of TEMPLATES) expect(validateEquipmentConfig(t.config)).toMatchObject({ ok: true });
  });
  it("derives wheel positions from axles", () => {
    expect(wheelPositionsOf({ key: "steer", role: "steer", wheels: "single" }).map((w) => w.abbreviation)).toEqual(["L", "R"]);
    expect(wheelPositionsOf({ key: "drive-1", role: "drive", wheels: "dual" }).map((w) => w.key)).toEqual(["drive-1:LO", "drive-1:LI", "drive-1:RI", "drive-1:RO"]);
    expect(wheelPositionsOf({ key: "drive-1", role: "drive", wheels: "super_single" }).map((w) => w.abbreviation)).toEqual(["L", "R"]);
  });
  it("rejects invalid configurations", () => {
    expect(validateEquipmentConfig({ schemaVersion: 1, kind: "truck", axles: [], spares: [] })).toMatchObject({ ok: false });
    expect(validateEquipmentConfig({ schemaVersion: 1, kind: "truck", axles: [{ key: "a", role: "steer", wheels: "single" }, { key: "a", role: "drive", wheels: "dual" }], spares: [] })).toMatchObject({ ok: false });
    expect(validateEquipmentConfig({ schemaVersion: 1, kind: "rocket", axles: [{ key: "a", role: "steer", wheels: "single" }], spares: [] })).toMatchObject({ ok: false });
  });
});

describe("buildLayout", () => {
  it("standard tractor + 2-axle trailer keeps the original 1–18 numbering, with spares after (trailer has two spare slots)", () => {
    const l = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-2-axle")]);
    expect(l.positions.map((p) => p.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(l.positions[0]).toMatchObject({ key: "truck/steer:L", positionClass: "steer", abbreviation: "L", requiresPsi: true });
    expect(l.positions[10]).toMatchObject({ number: 11, key: "trailer/axle-1:LO", positionClass: "trailer" });
    expect(spareNumbers(l)).toEqual([19, 20, 21]);
    expect(requiredNumbers(l)).toHaveLength(18);
    expect(l.components.map((c) => c.axles.length)).toEqual([3, 2]);
    expect(modeOf(l)).toBe("truck_trailer");
  });
  it("tractor with a pusher axle adds four dual positions before the drives", () => {
    const l = buildLayout([comp("truck", "tractor-pusher")]);
    const pusher = l.components[0].axles[1];
    expect(pusher).toMatchObject({ role: "pusher", positionClass: "trailer", liftable: true, tires: [3, 4, 5, 6] });
    expect(l.components[0].axles[2].tires).toEqual([7, 8, 9, 10]);
    expect(requiredNumbers(l)).toHaveLength(14);
    expect(spareNumbers(l)).toEqual([15]);
    expect(modeOf(l)).toBe("truck");
  });
  it("4- and 5-axle trailers", () => {
    const four = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-4-axle")]);
    expect(requiredNumbers(four)).toHaveLength(10 + 16);
    const five = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-5-axle")]);
    expect(requiredNumbers(five)).toHaveLength(10 + 20);
    expect(five.positions.at(-1)).toMatchObject({ number: 33, isSpare: true, slot: "trailer" });
  });
  it("Michigan 11-axle trailer with two spares", () => {
    const l = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-michigan-11")]);
    expect(requiredNumbers(l)).toHaveLength(10 + 44);
    expect(spareNumbers(l)).toEqual([55, 56, 57]);
  });
  it("tractor + jeep + dolly + trailer + booster in road order, numbered sequentially", () => {
    const l = buildLayout([comp("trailer", "trailer-3-axle"), comp("booster", "booster-2-axle"), comp("truck", "tractor-standard"), comp("dolly", "dolly-1-axle"), comp("jeep", "jeep-2-axle")]);
    expect(l.components.map((c) => c.slot)).toEqual(["truck", "jeep", "trailer", "dolly", "booster"]);
    expect(l.components[1].axles[0].tires).toEqual([11, 12, 13, 14]);
    expect(l.components[2].axles[0].tires).toEqual([19, 20, 21, 22]);
    expect(requiredNumbers(l)).toHaveLength(10 + 8 + 12 + 4 + 8);
    expect(modeOf(l)).toBe("combination");
  });
  it("driver-added spare slots extend a component without changing its configuration", () => {
    const l = buildLayout([{ ...comp("truck", "tractor-standard"), extraSpares: 2 }]);
    expect(spareNumbers(l)).toEqual([11, 12, 13]);
    expect(l.positions.filter((p) => p.isSpare).map((p) => p.key)).toEqual(["truck/spare-1", "truck/extra-1", "truck/extra-2"]);
  });
  it("zero spares and multiple spares", () => {
    const none = buildLayout([comp("trailer", "trailer-no-spare")]);
    expect(spareNumbers(none)).toEqual([]);
    expect(modeOf(none)).toBe("trailer");
    const cfg = { ...defaultConfigFor("truck"), spares: [{ key: "spare-1" }, { key: "spare-2" }, { key: "spare-3" }] };
    const many = buildLayout([{ slot: "truck", kind: "truck", assetId: "t", unitNumber: "T", configurationId: null, configVersion: null, config: cfg }]);
    expect(spareNumbers(many)).toEqual([11, 12, 13]);
    expect(many.positions.filter((p) => p.isSpare).map((p) => p.key)).toEqual(["truck/spare-1", "truck/spare-2", "truck/spare-3"]);
  });
  it("position keys stay stable when equipment is added (only numbers shift)", () => {
    const before = buildLayout([comp("truck", "tractor-standard"), comp("trailer", "trailer-2-axle")]);
    const after = buildLayout([comp("truck", "tractor-standard"), comp("jeep", "jeep-2-axle"), comp("trailer", "trailer-2-axle")]);
    const key = "trailer/axle-1:LO";
    expect(before.positions.find((p) => p.key === key)!.number).toBe(11);
    expect(after.positions.find((p) => p.key === key)!.number).toBe(19);
    expect(after.positions.find((p) => p.key === "truck/drive-2:RO")!.number).toBe(10);
  });
});

describe("legacyLayout", () => {
  it("keeps spares at 19/20 and trailer-only tires at 11–18", () => {
    const both = legacyLayout("truck_trailer");
    expect(both.positions.map((p) => p.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const truck = legacyLayout("truck");
    expect(truck.positions.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19]);
    const trailer = legacyLayout("trailer");
    expect(trailer.positions.map((p) => p.number)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 20]);
    expect(trailer.components[0].axles[1].tires).toEqual([15, 16, 17, 18]);
  });
});
