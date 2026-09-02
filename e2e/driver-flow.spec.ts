import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test of the driver flow against a running dev server with
 * the local dev seed (phone 5550000001 on tenant "jgg").
 */
test("driver can verify, inspect a truck and see the report", async ({ page }) => {
  await page.goto("/t/jgg");
  await page.getByTestId("phone").fill("5550000001");
  await page.getByTestId("continue").click();
  await page.waitForURL(/\/t\/jgg\/inspect/);

  // Resume prompt may appear from a previous run – start fresh.
  const startNew = page.getByTestId("start-new");
  if (await startNew.isVisible({ timeout: 1500 }).catch(() => false)) await startNew.click();

  await page.locator('[data-mode="truck"]').click();
  await page.getByPlaceholder(/unit number/i).first().fill("T101");
  await page.getByRole("button", { name: /JGG-T101/ }).click();
  await page.getByLabel("Odometer").fill("123456");
  await page.getByTestId("start-inspection").click();

  await expect(page.locator("[data-diagram]")).toBeVisible();
  await page.screenshot({ path: "e2e/out/diagram-empty.png", fullPage: true });

  // Submit early → issues panel lists incomplete tires.
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("issues")).toBeVisible();

  const values: Record<number, [number, number]> = { 1: [108, 12], 2: [106, 11], 3: [102, 10], 4: [101, 9], 5: [103, 10], 6: [102, 10], 7: [100, 8], 8: [95, 4], 9: [104, 12], 10: [102, 12] };
  for (const [n, [psi, tread]] of Object.entries(values)) {
    await page.locator(`[data-tire="${n}"]`).click();
    const sheet = page.locator("[data-tire-sheet]");
    await sheet.getByLabel("PSI").fill(String(psi));
    await sheet.getByLabel("Tread").fill(String(tread));
    if (Number(n) === 8) {
      await page.screenshot({ path: "e2e/out/sheet-tire-8.png", fullPage: true });
      // low tread → photo required
      await sheet.locator('input[type="file"]').last().setInputFiles({ name: "tire.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPEG_1x1, "base64") });
      await expect(sheet.locator("img")).toHaveCount(1);
    }
    await sheet.getByRole("button", { name: "Done" }).click();
  }
  // Spare 19: explicit "No spare"
  await page.locator('[data-tire="19"]').click();
  await page.getByTestId("no-spare").click();
  await page.locator("[data-tire-sheet]").getByRole("button", { name: "Done" }).click();
  await page.screenshot({ path: "e2e/out/diagram-filled.png", fullPage: true });

  await page.getByTestId("submit").click();
  await page.waitForURL(/\/report\//, { timeout: 30000 });
  await expect(page.getByText("Inspection report").first()).toBeVisible();
  await page.screenshot({ path: "e2e/out/report.png", fullPage: true });
  await page.locator('[data-tire="8"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "e2e/out/report-tire-8.png", fullPage: true });
});

// smallest valid JPEG (1x1)
const JPEG_1x1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
