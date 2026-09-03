import { describe, expect, it } from "vitest";
import { templateByKey } from "@/lib/equipment/templates";
import { applyEquipmentChange, componentsForMode, draftHasContent, draftLayout, emptyComponent, isDraftExpired, newDraft, toSubmission, type DraftComponent } from "./draft";
import { inspectionSubmissionSchema } from "./schema";

const uuid = (n: number) => `0f9a3c4e-3b6b-4a2f-9f5c-1c2d3e4f5a6${n}`;
const truck: DraftComponent = { ...emptyComponent("truck"), asset: { id: uuid(1), unitNumber: "T101" }, config: templateByKey("tractor-standard")!.config };
const trailer: DraftComponent = { ...emptyComponent("trailer"), asset: { id: uuid(2), unitNumber: "TR9" }, config: templateByKey("trailer-2-axle")!.config };

describe("draft", () => {
  it("new drafts are empty and not expired", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    expect(draftHasContent(d)).toBe(false);
    expect(isDraftExpired(d)).toBe(false);
    expect(draftLayout(d)).toBeNull();
  });
  it("expires after 24h of inactivity", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d.updatedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    expect(isDraftExpired(d)).toBe(true);
  });
  it("base mode selection keeps picked assets and extra equipment", () => {
    let d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d = { ...d, components: [truck, trailer, { ...emptyComponent("jeep"), asset: { id: uuid(3), unitNumber: "J1" } }] };
    const truckOnly = componentsForMode(d, "truck");
    expect(truckOnly.map((c) => c.slot)).toEqual(["truck", "jeep"]);
    expect(truckOnly[0].asset?.unitNumber).toBe("T101");
    expect(componentsForMode(d, "truck_trailer").map((c) => c.slot)).toEqual(["truck", "trailer", "jeep"]);
  });
  it("serializes to a valid schema-2 submission", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d.mode = "truck";
    d.components = [truck];
    d.odometer = 123456;
    d.tires["truck/steer:L"] = { key: "truck/steer:L", psi: 108, tread32: 12, damage: "none", photoIds: [] };
    d.tires["truck/steer:R"] = { key: "truck/steer:R", psi: 100, tread32: 5, damage: "repairable", photoIds: [crypto.randomUUID()], notes: "cut " };
    const layout = draftLayout(d)!;
    const sub = toSubmission(d, layout);
    const parsed = inspectionSubmissionSchema.safeParse(sub);
    expect(parsed.success).toBe(true);
    expect(sub.components).toEqual([{ slot: "truck", kind: "truck", assetId: uuid(1), configurationId: null, extraSpares: 0 }]);
    expect(sub.tires).toHaveLength(2);
    expect(sub.tires[1]).toMatchObject({ key: "truck/steer:R", number: 2, notes: "cut" });
    expect(sub.tires[1].photoClientIds).toHaveLength(1);
  });
  it("changing equipment mid-inspection keeps readings for equipment that stays and reports what would be dropped", () => {
    let d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d = { ...d, mode: "truck_trailer", components: [truck, trailer] };
    d.tires["truck/steer:L"] = { key: "truck/steer:L", psi: 108, tread32: 12, damage: "none", photoIds: [] };
    d.tires["trailer/axle-1:LO"] = { key: "trailer/axle-1:LO", psi: 100, tread32: 10, damage: "none", photoIds: [] };
    d.tires["trailer/axle-1:LI"] = { key: "trailer/axle-1:LI", psi: 100, tread32: 10, damage: "none", photoIds: [] };
    // Truck + trailer → truck only: trailer readings are dropped (with a warning), truck readings stay.
    const toTruck = applyEquipmentChange(d, [truck]);
    expect(toTruck.dropped).toEqual([{ slot: "trailer", unitNumber: "TR9", count: 2 }]);
    expect(Object.keys(toTruck.draft.tires)).toEqual(["truck/steer:L"]);
    expect(toTruck.draft.mode).toBe("truck");
    // Adding a jeep between tractor and trailer renumbers but loses nothing.
    const withJeep = applyEquipmentChange(d, [truck, { ...emptyComponent("jeep"), asset: { id: uuid(3), unitNumber: "J1" } }, trailer]);
    expect(withJeep.dropped).toEqual([]);
    expect(Object.keys(withJeep.draft.tires)).toHaveLength(3);
    const layout = draftLayout(withJeep.draft)!;
    expect(layout.positions.find((p) => p.key === "trailer/axle-1:LO")!.number).toBe(19);
    // Swapping the trailer for a different unit drops that trailer's readings only.
    const swapped = applyEquipmentChange(d, [truck, { ...trailer, asset: { id: uuid(4), unitNumber: "TR10" } }]);
    expect(swapped.dropped).toEqual([{ slot: "trailer", unitNumber: "TR9", count: 2 }]);
    expect(Object.keys(swapped.draft.tires)).toEqual(["truck/steer:L"]);
  });
});
