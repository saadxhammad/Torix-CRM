import { test, expect } from "@playwright/test";
import { openPage } from "./helpers";

test.describe("dashboard shell", () => {
  test("sidebar stays put while the content scrolls, and the nav scrolls on its own", async ({ page }) => {
    await openPage(page, "Attendance"); // long, seeded list
    const sidebar = page.locator("#app-sidebar"), main = page.locator(".dash-main"), nav = page.locator(".sb-nav");
    const before = await sidebar.boundingBox();
    expect(before?.y).toBe(0);

    await main.evaluate((el) => (el.scrollTop = 700));
    expect(await main.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // the window itself never scrolls
    expect(await sidebar.boundingBox()).toEqual(before);

    const mainTop = await main.evaluate((el) => el.scrollTop);
    await nav.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await nav.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await main.evaluate((el) => el.scrollTop)).toBe(mainTop); // nav scroll does not move the page
    await expect(page.locator(".sb-foot")).toBeInViewport(); // user footer stays pinned
  });

  test("sidebar is fixed-height, shows icons and large readable labels", async ({ page }) => {
    await openPage(page, "Dashboard");
    const item = page.locator(".sb-item").first();
    expect(await item.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    expect(await page.locator(".sb-item svg").count()).toBeGreaterThanOrEqual(30);
    const box = await page.locator("#app-sidebar").boundingBox();
    expect(box?.height).toBe(900);
  });

  test("navigating updates the URL, active state, title and survives reload", async ({ page }) => {
    await openPage(page, "Dashboard");
    await page.locator(".sb-item", { hasText: /^Leads$/ }).click();
    await expect(page).toHaveURL(/#\/leads$/);
    await expect(page.locator(".dash-main h1")).toHaveText("Leads");
    await expect(page.locator(".sb-item.is-active")).toHaveText(/Leads/);
    await page.reload();
    await expect(page.locator(".dash-main h1")).toHaveText("Leads");
    await page.goBack();
    await expect(page.locator(".dash-main h1")).not.toHaveText("Leads");
  });

  test("groups collapse, and the quick filter narrows the nav", async ({ page }) => {
    await openPage(page, "Dashboard");
    await page.getByRole("button", { name: /^Sales$/i }).click();
    await expect(page.locator(".sb-item", { hasText: /^Proposals$/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Sales$/i }).click();
    await expect(page.locator(".sb-item", { hasText: /^Proposals$/ })).toBeVisible();
    await page.getByLabel("Filter navigation").fill("pay");
    await expect(page.locator(".sb-item")).toHaveCount(1);
    await expect(page.locator(".sb-item")).toHaveText(/Payroll/);
    await page.getByLabel("Filter navigation").fill("zzz");
    await expect(page.getByText(/No page matches/)).toBeVisible();
  });

  test("sidebar collapses to an icon rail and back", async ({ page }) => {
    await openPage(page, "Dashboard");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(async () => (await page.locator("#app-sidebar").boundingBox())?.width).toBeLessThan(90);
    await expect(page.locator(".sb-label").first()).toBeHidden();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(async () => (await page.locator("#app-sidebar").boundingBox())?.width).toBeGreaterThan(240);
  });
});
