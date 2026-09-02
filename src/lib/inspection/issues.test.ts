import { describe, expect, it } from "vitest";
import { buildIssues, verdictOf } from "./issues";
import type { TireReading } from "@/lib/tires";

const r = (number: number, psi: number | null, tread32: number | null, extra: Partial<TireReading> = {}): TireReading => ({ number, psi, tread32, damage: "none", photoCount: 0, ...extra });

describe("buildIssues", () => {
  it("classifies psi/tread/damage and blocking items", () => {
    const readings: Record<number, TireReading> = {};
    for (let n = 1; n <= 10; n++) readings[n] = r(n, n <= 2 ? 108 : 102, 12);
    readings[19] = r(19, null, null, { absent: true });
    readings[3] = r(3, 80, 12); // red psi (drive <=85)
    readings[4] = r(4, 102, 5, { photoCount: 1 }); // yellow tread w/ photo
    readings[5] = r(5, 102, 12, { damage: "non_repairable" }); // oos, photo missing
    delete readings[6]; // missing
    const issues = buildIssues({ mode: "truck", readings, truckSelected: true, trailerSelected: false, odometer: 1 });
    expect(issues.find((i) => i.tire === 3)?.textKey).toBe("psiLow");
    expect(issues.find((i) => i.tire === 4)?.tag).toBe("tread");
    expect(issues.filter((i) => i.tire === 5).map((i) => i.tag).sort()).toEqual(["oos", "photo"]);
    expect(issues.find((i) => i.tire === 6)?.tag).toBe("missing");
    expect(issues[0].blocking).toBe(true);
    expect(verdictOf(issues)).toBe("action");
  });
  it("clear when nothing is wrong", () => {
    const readings: Record<number, TireReading> = {};
    for (let n = 1; n <= 10; n++) readings[n] = r(n, n <= 2 ? 108 : 102, 12);
    readings[19] = r(19, null, 12);
    const issues = buildIssues({ mode: "truck", readings, truckSelected: true, trailerSelected: false, odometer: 1 });
    expect(issues).toEqual([]);
    expect(verdictOf(issues)).toBe("clear");
  });
});
