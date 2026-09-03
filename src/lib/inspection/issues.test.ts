import { describe, expect, it } from "vitest";
import { buildLayout, requiredNumbers, type LayoutComponentInput } from "@/lib/equipment/layout";
import { templateByKey } from "@/lib/equipment/templates";
import type { TireReading } from "@/lib/tires";
import { buildIssues, verdictOf } from "./issues";

const t = templateByKey("tractor-standard")!;
const TRUCK = buildLayout([{ slot: "truck", kind: "truck", assetId: "a", unitNumber: "T1", configurationId: null, configVersion: null, config: t.config } satisfies LayoutComponentInput]);
const r = (number: number, psi: number | null, tread32: number | null, extra: Partial<TireReading> = {}): TireReading => ({ key: TRUCK.positions.find((p) => p.number === number)!.key, number, psi, tread32, damage: "none", photoCount: 0, ...extra });

describe("buildIssues", () => {
  it("classifies psi/tread/damage and blocking items", () => {
    const readings: Record<number, TireReading> = {};
    for (const n of requiredNumbers(TRUCK)) readings[n] = r(n, n <= 2 ? 108 : 102, 12);
    readings[3] = r(3, 80, 12); // red psi (drive <=85)
    readings[4] = r(4, 102, 5, { photoCount: 1 }); // yellow tread w/ photo
    readings[5] = r(5, 102, 12, { damage: "non_repairable" }); // oos, photo missing
    delete readings[6]; // missing
    readings[7] = r(7, null, 12); // missing psi only
    const issues = buildIssues({ layout: TRUCK, readings, odometer: 1 });
    expect(issues.find((i) => i.tire === 3)?.textKey).toBe("psiLow");
    expect(issues.find((i) => i.tire === 4)?.tag).toBe("tread");
    expect(issues.filter((i) => i.tire === 5).map((i) => i.tag).sort()).toEqual(["oos", "photo"]);
    expect(issues.find((i) => i.tire === 6)?.textKey).toBe("missingBoth");
    expect(issues.find((i) => i.tire === 7)?.textKey).toBe("missingPsi");
    expect(issues[0].blocking).toBe(true);
    expect(verdictOf(issues)).toBe("action");
  });
  it("clear when nothing is wrong (spare untouched)", () => {
    const readings: Record<number, TireReading> = {};
    for (const n of requiredNumbers(TRUCK)) readings[n] = r(n, n <= 2 ? 108 : 102, 12);
    const issues = buildIssues({ layout: TRUCK, readings, odometer: 1 });
    expect(issues).toEqual([]);
    expect(verdictOf(issues)).toBe("clear");
  });
});
