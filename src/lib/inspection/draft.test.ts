import { describe, expect, it } from "vitest";
import { draftHasContent, isDraftExpired, newDraft, toSubmission } from "./draft";
import { inspectionSubmissionSchema } from "./schema";

describe("draft", () => {
  it("new drafts are empty and not expired", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    expect(draftHasContent(d)).toBe(false);
    expect(isDraftExpired(d)).toBe(false);
  });
  it("expires after 24h of inactivity", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d.updatedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    expect(isDraftExpired(d)).toBe(true);
  });
  it("serializes to a valid submission", () => {
    const d = newDraft({ tenantSlug: "jgg", driverId: "d1", driverName: "Alex" });
    d.mode = "truck";
    d.truck = { id: "0f9a3c4e-3b6b-4a2f-9f5c-1c2d3e4f5a6b", unitNumber: "T101" };
    d.odometer = 123456;
    d.tires[1] = { number: 1, psi: 108, tread32: 12, damage: "none", photoIds: [] };
    d.tires[2] = { number: 2, psi: 100, tread32: 5, damage: "repairable", photoIds: [crypto.randomUUID()], notes: "cut " };
    const sub = toSubmission(d);
    const parsed = inspectionSubmissionSchema.safeParse(sub);
    expect(parsed.success).toBe(true);
    expect(sub.tires).toHaveLength(2);
    expect(sub.tires[1].notes).toBe("cut");
    expect(sub.tires[1].photoClientIds).toHaveLength(1);
  });
});
