import { expect, test } from "@playwright/test";

/**
 * Admin auth gating and Supabase callback handling. Runs locally (dev
 * provider) and against staging (Supabase provider). Establishing a real
 * magic-link session needs the emailed token, so the exchange itself is
 * verified manually; everything around it is covered here.
 */
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test("unauthenticated admin routes redirect to the login page", async ({ page }) => {
  for (const path of ["/admin", "/admin/reports", "/admin/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
});

test("callback without a valid code lands on login with an explanation", async ({ page }) => {
  await page.goto("/auth/callback?next=/admin/reports");
  await expect(page).toHaveURL(/\/admin\/login\?error=link$/);
  await expect(page.getByTestId("login-error")).toBeVisible();
});

test("a Supabase Site-URL fallback (code on the site root) is routed through the callback", async ({ page }) => {
  await page.goto("/?code=not-a-real-code");
  await expect(page).toHaveURL(/\/admin\/login\?error=link$/);
  await page.goto("/admin?error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page).toHaveURL(/\/admin\/login\?error=link$/);
});

test("the post-login destination cannot be an external URL", async ({ page, baseURL }) => {
  const res = await page.request.get("/auth/callback?code=bogus&next=//evil.example/phish", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const loc = res.headers()["location"] ?? "";
  expect(loc.startsWith(baseURL!) || loc.startsWith("/")).toBeTruthy();
  expect(loc).not.toContain("evil.example");
});

test("non-canonical hosts redirect to the canonical origin", async ({ page, baseURL }) => {
  const ALIAS = process.env.E2E_ALIAS_URL;
  test.skip(!ALIAS, "E2E_ALIAS_URL not set");
  const res = await page.request.get(`${ALIAS}/admin/login`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()["location"]).toBe(`${baseURL}/admin/login`);
});
