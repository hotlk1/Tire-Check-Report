import { appendFileSync, writeFileSync } from "node:fs";

// Defaults match the local dev seed; override for staging (tenant "test", driver 5550001234, truck T-100).
const TENANT = process.env.E2E_TENANT ?? "jgg";
const PHONE = process.env.E2E_PHONE ?? "5550000001";
const TRUCK_QUERY = process.env.E2E_TRUCK_QUERY ?? "T101";
const TRUCK_NAME = process.env.E2E_TRUCK_NAME ?? "JGG-T101";
import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end smoke test of the driver flow (design §1a) against a running dev
 * server with the local dev seed (phone 5550000001 on tenant "jgg").
 */
async function keypad(page: Page, value: string) {
  const sheet = page.locator("[data-tire-sheet]");
  for (const ch of value) await sheet.locator(`[data-key="${ch}"]`).click();
}

async function enterTire(page: Page, n: number, psi: number | null, tread: number, opts: { photo?: boolean; oos?: boolean } = {}) {
  await page.locator(`[data-tire="${n}"]`).click();
  const sheet = page.locator("[data-tire-sheet]");
  await expect(sheet).toBeVisible();
  if (psi !== null) {
    await sheet.getByTestId("field-psi").click();
    await keypad(page, String(psi));
  }
  await sheet.getByTestId("field-tread").click();
  await keypad(page, String(tread));
  if (opts.oos) {
    await sheet.getByTestId("mark-damaged").click();
    await sheet.getByTestId("oos").click();
  }
  if (opts.photo) {
    await sheet.locator('input[type="file"]').first().setInputFiles({ name: "tire.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPEG_1x1, "base64") });
    await expect(sheet.locator("img")).toHaveCount(1);
  }
  await sheet.getByTestId("save-tire").click();
  await expect(sheet).toHaveCount(0);
}

test("driver can verify, inspect a truck, review and see the report", async ({ page }) => {
  // Browser console errors/warnings go to e2e/out/console.log for diagnostics.
  writeFileSync("e2e/out/console.log", "");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") appendFileSync("e2e/out/console.log", `[${m.type()}] ${m.text().slice(0, 4000)}\n\n`); });
  page.on("pageerror", (e) => appendFileSync("e2e/out/console.log", `[pageerror] ${String(e).slice(0, 4000)}\n\n`));
  await page.goto(`/t/${TENANT}`);
  // Screenshot only after hydration: Playwright's caret hiding injects a style attribute on the
  // auto-focused input, which would otherwise register as a (test-only) hydration mismatch.
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "e2e/out/d1-phone.png", fullPage: true, caret: "initial" });
  await page.getByTestId("phone").fill(PHONE);
  await expect(page.getByTestId("matched")).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: "e2e/out/d1-phone-matched.png", fullPage: true });
  await page.getByTestId("continue").click();
  await page.waitForURL(new RegExp(`/t/${TENANT}/inspect`));

  const startNew = page.getByTestId("start-new");
  if (await startNew.isVisible({ timeout: 1500 }).catch(() => false)) await startNew.click();

  await page.locator('[data-mode="truck"]').click();
  await page.getByPlaceholder(/unit number/i).first().fill(TRUCK_QUERY);
  await page.getByRole("button", { name: new RegExp(TRUCK_NAME) }).click();
  await page.getByTestId("odometer").fill("123456");
  await page.screenshot({ path: "e2e/out/d2-equipment.png", fullPage: true });
  await page.getByTestId("start-inspection").click();

  await expect(page.locator("[data-diagram]")).toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("0/11");
  await page.screenshot({ path: "e2e/out/d3-diagram-empty.png", fullPage: true });

  // Review early → blocking items listed, submit disabled.
  await page.getByTestId("review").click();
  await expect(page.getByTestId("issues")).toBeVisible();
  await expect(page.getByTestId("submit")).toBeDisabled();

  await page.getByRole("button", { name: "Edit" }).click();

  // Catalog picker: tire 1 gets a catalog variant (search → pick), never blocking.
  await page.locator('[data-tire="1"]').first().click();
  const sheet1 = page.locator("[data-tire-sheet]");
  await sheet1.getByTestId("details-toggle").click();
  await sheet1.getByTestId("catalog-search").fill("michelin");
  await sheet1.locator(".catalog-row").first().click();
  await expect(sheet1.getByTestId("catalog-selected")).toContainText("Michelin");
  await page.screenshot({ path: "e2e/out/d4b-catalog-picked.png", fullPage: true });
  await sheet1.getByTestId("save-tire").click();

  const values: Record<number, [number, number]> = { 1: [108, 12], 2: [106, 11], 3: [102, 10], 4: [101, 9], 5: [103, 10], 6: [102, 10], 7: [100, 8], 8: [95, 4], 9: [104, 12], 10: [102, 12] };
  for (const [n, [psi, tread]] of Object.entries(values)) {
    if (Number(n) === 8) {
      await page.locator('[data-tire="8"]').click();
      await page.screenshot({ path: "e2e/out/d4-sheet.png", fullPage: true });
      await page.locator("[data-tire-sheet]").getByTestId("save-tire").click();
    }
    await enterTire(page, Number(n), psi, tread, { photo: Number(n) === 8 });
  }
  // Spare 19: explicit "No spare"
  await page.locator('[data-tire="19"]').click();
  await page.getByTestId("no-spare").click();
  await page.locator("[data-tire-sheet]").getByTestId("save-tire").click();
  await expect(page.getByTestId("progress")).toContainText("11/11");
  await page.screenshot({ path: "e2e/out/d5-diagram-filled.png", fullPage: true });

  await page.getByTestId("review").click();
  await expect(page.getByTestId("submit")).toBeEnabled();
  await page.screenshot({ path: "e2e/out/d6-review.png", fullPage: true });
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("submitted")).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "e2e/out/d7-submitted.png", fullPage: true });
  await page.getByTestId("view-report").click();
  await page.waitForURL(/\/report\//, { timeout: 30000 });
  await page.locator('[data-tire="1"]').first().click();
  await expect(page.getByRole("dialog")).toContainText("Michelin");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForURL(/\/report\//);
  await expect(page.locator("[data-diagram]")).toBeVisible();
  await page.screenshot({ path: "e2e/out/d8-report.png", fullPage: true });
  await page.locator('[data-tire="8"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "e2e/out/d9-report-tire-8.png", fullPage: true });
});

// smallest valid JPEG (1x1)
const JPEG_1x1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
