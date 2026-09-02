import { expect, test } from "@playwright/test";

/**
 * Admin smoke test against the dev seed (dev login, tenant JGG). Assumes at
 * least one inspection exists (run driver-flow.spec.ts first).
 */
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test("admin can sign in, see the dashboard, edit a report, manage drivers and publish thresholds", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByTestId("login-email").selectOption("admin@dev.local");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/admin$/);
  await page.getByTestId("tenant-switcher").selectOption("jgg");
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/Operational view of JGG/)).toBeVisible();
  await page.screenshot({ path: "e2e/out/admin-dashboard.png", fullPage: true });

  // KPI drill-down → tires list filtered
  await page.getByRole("link", { name: /Yellow warnings/ }).click();
  await page.waitForURL(/\/admin\/tires\?status=yellow/);
  await expect(page.getByRole("heading", { name: "Tires" })).toBeVisible();

  // Reports → open latest → edit tire 8 → history shows the audit entry
  await page.goto("/admin/reports");
  await page.locator("tbody tr a").first().click();
  await page.waitForURL(/\/admin\/reports\/[0-9a-f-]+$/);
  const tireForm = page.locator("#tire-8");
  await tireForm.locator('input[name="tread32"]').fill("6");
  await tireForm.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(page.locator("text=tire_entry").first()).toBeVisible();
  await page.screenshot({ path: "e2e/out/admin-report.png", fullPage: true });

  // Drivers: add one, then it appears in the list; invalid phone is rejected
  await page.goto("/admin/drivers?add=1");
  await page.getByTestId("driver-name").fill("E2E Driver");
  await page.getByTestId("driver-phone").fill("555-123");
  await page.getByTestId("driver-save").click();
  await expect(page.getByText("Phone must be 10 US digits")).toBeVisible();
  await page.getByTestId("driver-name").fill("E2E Driver");
  await page.getByTestId("driver-phone").fill("(555) 777-1212");
  await page.getByTestId("driver-save").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("E2E Driver")).toBeVisible();

  // Users: invite an editor (dev auth provider assigns an id)
  await page.getByTestId("invite-email").fill("e2e-editor@dev.local");
  await page.getByTestId("invite-submit").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("e2e-editor@dev.local")).toBeVisible();

  // Trucks: add an asset and open its detail
  await page.goto("/admin/trucks?add=1");
  await page.getByTestId("unit-number").fill("JGG-E2E-1");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/admin\/trucks\/[0-9a-f-]+\?saved=1/);
  await expect(page.getByRole("heading", { name: "JGG-E2E-1" })).toBeVisible();

  // Settings: publish a new threshold version and see it in the history + audit
  await page.goto("/admin/settings");
  await page.locator('input[name="tread.steer.yellowMax"]').fill("9");
  await page.locator('input[name="note"]').fill("e2e change");
  await page.getByTestId("publish-thresholds").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("e2e change").first()).toBeVisible();
  await expect(page.getByText(/JGG v1/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/out/admin-settings.png", fullPage: true });

  // Tenant switch (super admin) → ZSP shows its own data only
  await page.getByTestId("tenant-switcher").selectOption("zsp");
  await page.waitForURL(/\/admin$/);
  await expect(page.getByText(/Operational view of ZSP/)).toBeVisible();
  await page.goto("/admin/drivers");
  await expect(page.getByText("E2E Driver")).toHaveCount(0);
});
