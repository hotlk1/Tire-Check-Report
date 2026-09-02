import { describe, expect, it } from "vitest";
import { collectKeys, createTranslator, LOCALES, MESSAGES, negotiateLocale } from "./index";

describe("i18n", () => {
  const enKeys = collectKeys(MESSAGES.en).sort();

  it.each(LOCALES)("%s has exactly the same keys as en", (locale) => {
    expect(collectKeys(MESSAGES[locale]).sort()).toEqual(enKeys);
  });

  it("interpolates params", () => {
    const t = createTranslator("en");
    expect(t("driver.welcome", { name: "Ana" })).toBe("Welcome, Ana");
    expect(createTranslator("es")("inspection.progress", { done: 3, total: 10 })).toBe("3 de 10 llantas");
  });

  it("negotiates locale", () => {
    expect(negotiateLocale("ro-RO,ro;q=0.9,en;q=0.8")).toBe("ro");
    expect(negotiateLocale(["fr-FR", "ru"])).toBe("ru");
    expect(negotiateLocale("de")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });
});
