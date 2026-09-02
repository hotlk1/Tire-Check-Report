import { describe, expect, it } from "vitest";
import { formatUsPhone, normalizeUsPhone } from "./phone";

describe("normalizeUsPhone", () => {
  it("accepts common formats", () => {
    expect(normalizeUsPhone("(555) 000-0001")).toBe("5550000001");
    expect(normalizeUsPhone("+1 555 000 0001")).toBe("5550000001");
    expect(normalizeUsPhone("15550000001")).toBe("5550000001");
    expect(normalizeUsPhone("555.000.0001")).toBe("5550000001");
  });
  it("rejects anything that is not exactly 10 US digits", () => {
    expect(normalizeUsPhone("555000000")).toBeNull();
    expect(normalizeUsPhone("0550000001")).toBeNull();
    expect(normalizeUsPhone("+40 722 000 000")).toBeNull();
    expect(normalizeUsPhone("")).toBeNull();
  });
  it("formats", () => {
    expect(formatUsPhone("5550000001")).toBe("(555) 000-0001");
  });
});
