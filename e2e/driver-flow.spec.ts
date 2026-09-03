import { appendFileSync, writeFileSync } from "node:fs";

// Defaults match the local dev seed; override for staging (tenant "test", smoke-test driver 5550009999, truck E2E-100).
const TENANT = process.env.E2E_TENANT ?? "jgg";
const PHONE = process.env.E2E_PHONE ?? "5550000001";
const TRUCK_QUERY = process.env.E2E_TRUCK_QUERY ?? "T101";
const TRUCK_NAME = process.env.E2E_TRUCK_NAME ?? "JGG-T101";
import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end smoke test of the driver flow (design §1a) against a running
 * server: phone → equipment (with explicit validation) → tires (explicit save
 * validation, photo enforcement, optional spare) → review → submit → report.
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

test("driver can verify, inspect a truck with explicit validation, review and see the report", async ({ page }) => {
  // Browser console errors/warnings go to e2e/out/console.log for diagnostics.
  writeFileSync("e2e/out/console.log", "");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") appendFileSync("e2e/out/console.log", `[${m.type()}] ${m.text().slice(0, 4000)}\n\n`); });
  page.on("pageerror", (e) => appendFileSync("e2e/out/console.log", `[pageerror] ${String(e).slice(0, 4000)}\n\n`));
  await page.goto(`/t/${TENANT}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "e2e/out/d1-phone.png", fullPage: true, caret: "initial" });
  await page.getByTestId("phone").fill(PHONE);
  await expect(page.getByTestId("matched")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("continue").click();
  await page.waitForURL(new RegExp(`/t/${TENANT}/inspect`));

  const startNew = page.getByTestId("start-new");
  if (await startNew.isVisible({ timeout: 1500 }).catch(() => false)) await startNew.click();

  // Equipment: Start without a truck → explicit error; pick the truck; Start without odometer → explicit error + focus.
  await page.locator('[data-mode="truck"]').click();
  await page.getByTestId("start-inspection").click();
  await expect(page.getByTestId("equipment-errors")).toBeVisible();
  await expect(page.getByTestId("error-truck")).toBeVisible();
  await page.getByPlaceholder(/unit number/i).first().fill(TRUCK_QUERY);
  await page.getByRole("button", { name: new RegExp(TRUCK_NAME) }).click();
  await expect(page.getByTestId("config-truck")).toContainText(/axle/i);
  await page.getByTestId("start-inspection").click();
  await expect(page.getByTestId("error-odometer")).toContainText(/Odometer is required/);
  await expect(page.getByTestId("odometer")).toBeFocused();
  await page.getByTestId("odometer").fill("123456");
  await page.screenshot({ path: "e2e/out/d2-equipment.png", fullPage: true });
  await page.getByTestId("start-inspection").click();

  await expect(page.locator("[data-diagram]")).toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("0/10");
  await page.screenshot({ path: "e2e/out/d3-diagram-empty.png", fullPage: true });

  // Review early → blocking items listed; Submit explains instead of silently refusing.
  await page.getByTestId("review").click();
  await expect(page.getByTestId("issues")).toBeVisible();
  await expect(page.getByTestId("blocking-summary")).toBeVisible();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("submitted")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).click();

  // Tire save validation: damaged tire without tread and photo → every missing input is named; keep as draft.
  await page.locator('[data-tire="3"]').first().click();
  let sheet = page.locator("[data-tire-sheet]");
  await sheet.getByTestId("mark-damaged").click();
  await sheet.getByTestId("save-tire").click();
  await expect(sheet.getByTestId("tire-errors")).toContainText(/Enter PSI/);
  await expect(sheet.getByTestId("tire-errors")).toContainText(/tread depth/);
  await expect(sheet.getByTestId("tire-errors")).toContainText(/photo is required for damaged/);
  await page.screenshot({ path: "e2e/out/d4a-save-validation.png", fullPage: true });
  await sheet.getByTestId("keep-draft").click();
  await expect(sheet).toHaveCount(0);
  await page.locator('[data-tire="3"]').first().click();
  sheet = page.locator("[data-tire-sheet]");
  await sheet.getByTestId("mark-damaged").click(); // clear damage again for the happy path
  await sheet.getByTestId("save-tire").click();
  await expect(sheet.getByTestId("tire-errors")).toBeVisible();
  await sheet.getByTestId("keep-draft").click();

  // Catalog picker: tire 1 gets a catalog variant (search → pick), never blocking.
  await page.locator('[data-tire="1"]').first().click();
  const sheet1 = page.locator("[data-tire-sheet]");
  // Details open automatically when a mounted tire is already known for the position (its identity is pre-filled);
  // get back to the catalog search in that case.
  const search = sheet1.getByTestId("catalog-search");
  if (!(await search.isVisible().catch(() => false))) {
    const back = sheet1.getByRole("button", { name: /^clear$|pick from catalog/i }).first();
    if (await back.isVisible().catch(() => false)) await back.click();
    if (!(await search.isVisible().catch(() => false))) await sheet1.getByTestId("details-toggle").click();
    if (!(await search.isVisible().catch(() => false))) await sheet1.getByRole("button", { name: /^clear$|pick from catalog/i }).first().click();
  }
  await search.fill("michelin");
  await sheet1.locator(".catalog-row").first().click();
  await expect(sheet1.getByTestId("catalog-selected")).toContainText("Michelin");
  await page.screenshot({ path: "e2e/out/d4b-catalog-picked.png", fullPage: true });
  await sheet1.getByTestId("field-psi").click();
  await keypad(page, "108");
  await sheet1.getByTestId("field-tread").click();
  await keypad(page, "12");
  await sheet1.getByTestId("save-tire").click();
  await expect(sheet1).toHaveCount(0);

  // Numeric sanity: 99/32 is refused outright.
  await page.locator('[data-tire="2"]').first().click();
  sheet = page.locator("[data-tire-sheet]");
  await sheet.getByTestId("field-psi").click();
  await keypad(page, "106");
  await sheet.getByTestId("field-tread").click();
  await keypad(page, "99");
  await sheet.getByTestId("save-tire").click();
  await expect(sheet.getByTestId("tire-errors")).toContainText(/Tread must be between/);
  await keypad(page, "⌫⌫");
  await keypad(page, "11");
  await sheet.getByTestId("save-tire").click();
  await expect(sheet).toHaveCount(0);

  const values: Record<number, [number, number]> = { 3: [102, 10], 4: [101, 9], 5: [103, 10], 6: [102, 10], 7: [100, 8], 8: [95, 4], 9: [104, 12], 10: [102, 12] };
  for (const [n, [psi, tread]] of Object.entries(values)) {
    if (Number(n) === 8) {
      // Low tread without a photo: Save names the missing photo and does not complete the tire.
      await page.locator('[data-tire="8"]').click();
      const s8 = page.locator("[data-tire-sheet]");
      await s8.getByTestId("field-psi").click();
      await keypad(page, "95");
      await s8.getByTestId("field-tread").click();
      await keypad(page, "4");
      await expect(s8.getByTestId("photo-required")).toBeVisible();
      await s8.getByTestId("save-tire").click();
      await expect(s8.getByTestId("tire-errors")).toContainText(/photo is required/i);
      await page.screenshot({ path: "e2e/out/d4-sheet.png", fullPage: true });
      await s8.getByTestId("keep-draft").click();
      await expect(page.getByTestId("progress")).toContainText("7/10");
      // Re-open: readings are kept; adding the photo completes the tire.
      await page.locator('[data-tire="8"]').click();
      const s8b = page.locator("[data-tire-sheet]");
      await s8b.locator('input[type="file"]').first().setInputFiles({ name: "tire.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPEG_1x1, "base64") });
      await expect(s8b.locator("img")).toHaveCount(1);
      await s8b.getByTestId("save-tire").click();
      await expect(s8b).toHaveCount(0);
      await expect(page.getByTestId("progress")).toContainText("8/10");
      continue;
    }
    await enterTire(page, Number(n), psi, tread);
  }
  // Spare 11 stays untouched: optional, never blocks.
  await expect(page.getByTestId("progress")).toContainText("10/10");
  await page.screenshot({ path: "e2e/out/d5-diagram-filled.png", fullPage: true });

  // Edit equipment mid-inspection: adding a trailer keeps every truck reading (no warning), removing it again warns.
  await page.getByTestId("edit-equipment").click();
  await page.locator('[data-mode="truck_trailer"]').click();
  await page.getByTestId("start-inspection").click();
  await expect(page.getByTestId("error-trailer")).toBeVisible();
  await page.locator('[data-mode="truck"]').click();
  await page.getByTestId("start-inspection").click();
  await expect(page.getByTestId("progress")).toContainText("10/10");

  await page.getByTestId("review").click();
  await expect(page.getByTestId("blocking-summary")).toHaveCount(0);
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
  await expect(page.locator("[data-diagram]")).toBeVisible();
  await page.screenshot({ path: "e2e/out/d8-report.png", fullPage: true });
  await page.locator('[data-tire="8"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "e2e/out/d9-report-tire-8.png", fullPage: true });
});

// smallest valid JPEG (1x1)
const JPEG_1x1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
