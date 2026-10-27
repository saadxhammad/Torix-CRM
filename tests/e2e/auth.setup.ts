import { test as setup, expect } from "@playwright/test";
import { OWNER } from "./helpers";

setup("sign in as owner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await expect(page.locator(".sb-nav")).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth.json" });
});
