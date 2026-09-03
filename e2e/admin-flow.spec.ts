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
  await page.screenshot({ path: "e2e/out/a1-dashboard.png", fullPage: true });

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
  await page.screenshot({ path: "e2e/out/a2-report.png", fullPage: true });

  // Drivers: add one, then it appears in the list; invalid phone is rejected
  await page.goto("/admin/drivers?add=1");
  await page.getByTestId("driver-name").fill("E2E Driver");
  await page.getByTestId("driver-phone").fill("555-123");
  await page.getByTestId("driver-save").click();
  await expect(page.getByText("Phone must be 10 US digits")).toBeVisible();
  const phone = "555" + String(Math.floor(1000000 + Math.random() * 8999999));
  const driverName = `E2E Driver ${phone.slice(-4)}`;
  await page.getByTestId("driver-name").fill(driverName);
  await page.getByTestId("driver-phone").fill(phone);
  await page.getByTestId("driver-save").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText(driverName)).toBeVisible();

  // Users: invite an editor (dev auth provider assigns an id)
  const email = `e2e-editor-${Date.now()}@dev.local`;
  await page.getByTestId("invite-email").fill(email);
  await page.getByTestId("invite-submit").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText(email)).toBeVisible();

  // Trucks: add an asset and open its detail
  await page.goto("/admin/trucks?add=1");
  const unit = `JGG-E2E-${Date.now() % 100000}`;
  await page.getByTestId("unit-number").fill(unit);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/admin\/trucks\/[0-9a-f-]+\?saved=1/);
  await expect(page.getByRole("heading", { name: unit })).toBeVisible();

  // Axle configuration: publish a pusher-axle layout from a template, then a second version with an added axle.
  await page.getByTestId("config-template").selectOption("tractor-pusher");
  await page.getByTestId("publish-config").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("Version 1").first()).toBeVisible();
  await expect(page.getByText(/4 axle\(s\) · 14 tires · 1 spare/).first()).toBeVisible();
  await page.getByTestId("add-axle").click();
  await page.getByTestId("spare-count").fill("0");
  await page.getByTestId("publish-config").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("Version 2").first()).toBeVisible();
  await expect(page.getByText(/5 axle\(s\) · 18 tires · 0 spare/).first()).toBeVisible();
  await expect(page.getByTestId("mounted-pusher-1:LO")).toBeVisible();
  await page.screenshot({ path: "e2e/out/a4-configuration.png", fullPage: true });

  // Physical tires: register one, mount it on the new truck, move it, mark it disposed — every step is history.
  await page.goto("/admin/tires/assets?register=1");
  await page.getByTestId("tire-make").fill("E2E Brand");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/admin\/tires\/assets\/[0-9a-f-]+\?saved=1/);
  await page.locator('[data-testid="mount-form"] select[name="assetId"]').selectOption({ label: `${unit} (truck)` });
  await page.locator('[data-testid="mount-form"] input[name="positionKey"]').fill("drive-1:LO");
  await page.getByTestId("mount-form").getByRole("button", { name: "Mount on a unit" }).click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText(/Mounted · .*drive-1:LO/).first()).toBeVisible();
  await page.locator('[data-testid="mount-form"] input[name="positionKey"]').fill("drive-2:RO");
  await page.getByTestId("mount-form").getByRole("button", { name: "Move" }).click();
  await page.waitForURL(/saved=1/);
  await page.getByTestId("state-disposed").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("Disposed").first()).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4); // registered, mount, move, unmount→disposed
  await page.screenshot({ path: "e2e/out/a5-tire-asset.png", fullPage: true });

  // Settings: publish a new threshold version and see it in the history + audit
  await page.goto("/admin/settings");
  await page.locator('input[name="tread.steer.yellowMax"]').fill("9");
  await page.getByTestId("photo-psiRed").check();
  await page.locator('input[name="note"]').fill("e2e change");
  await page.getByTestId("publish-thresholds").click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("e2e change").first()).toBeVisible();
  await expect(page.getByText(/JGG v\d+/).first()).toBeVisible();
  await expect(page.getByTestId("photo-psiRed")).toBeChecked();
  // Statutory floor: a steer red limit below 4/32 is refused with an explanation.
  await page.locator('input[name="tread.steer.redMax"]').fill("3");
  await page.getByTestId("publish-thresholds").click();
  await page.waitForURL(/error=/);
  await expect(page.getByText(/statutory/)).toBeVisible();
  await page.screenshot({ path: "e2e/out/a3-settings.png", fullPage: true });

  // Tenant switch (super admin) → ZSP shows its own data only
  await page.getByTestId("tenant-switcher").selectOption("zsp");
  await page.waitForURL(/\/admin$/);
  await expect(page.getByText(/Operational view of ZSP/)).toBeVisible();
  await page.goto("/admin/drivers");
  await expect(page.getByText(driverName)).toHaveCount(0);
});
