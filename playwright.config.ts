import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// Playwright 1.64 expects a newer browser build than the one cached on the dev machine,
// so allow pointing at any installed Chromium: PW_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e
const cached = `${homedir()}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`;
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(cached) ? cached : undefined);
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [["list"], ["html", { open: "never", outputFolder: "qa/playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth.json", launchOptions },
      dependencies: ["setup"],
      testIgnore: /(auth\.setup|login|mobile)\.spec/,
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: "tests/e2e/.auth.json", launchOptions },
      dependencies: ["setup"],
      testMatch: /(pages|mobile)\.spec\.ts/,
    },
    { name: "anon", use: { ...devices["Desktop Chrome"], launchOptions }, testMatch: /login\.spec\.ts/ },
  ],
});
