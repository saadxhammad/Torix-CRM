import { test, expect } from "@playwright/test";
import { openPage } from "./helpers";

test("sidebar is an off-canvas drawer on small screens", async ({ page }) => {
  await openPage(page, "Dashboard");
  const sidebar = page.locator("#app-sidebar");
  expect((await sidebar.boundingBox())!.x).toBeLessThan(0); // hidden off-screen
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar).toBeInViewport();
  await page.locator(".sb-item", { hasText: /^Clients$/ }).click();
  await expect(page.locator(".dash-main h1")).toHaveText("Clients");
  expect((await sidebar.boundingBox())!.x).toBeLessThan(0); // closes after navigating
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.keyboard.press("Escape");
  expect((await sidebar.boundingBox())!.x).toBeLessThan(0);
});
