import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Allow a pre-installed Chromium (e.g. remote sandboxes) via PW_CHROMIUM_PATH.
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Pixel 7"],
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  reporter: [["list"]],
});
