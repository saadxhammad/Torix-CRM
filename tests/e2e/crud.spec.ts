import { test, expect } from "@playwright/test";
import { openPage } from "./helpers";

// The workspace uses optimistic revision checks, so tests that write must not overlap.
test.describe.configure({ mode: "serial" });

test("create, find, edit and export a client through the UI", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6), name = `E2E Client ${stamp}`;
  await openPage(page, "Clients");

  await page.getByRole("button", { name: /add client/i }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel(/client or company/i).fill(name);
  await dialog.getByLabel(/contact name/i).fill("Test Contact");
  await dialog.getByLabel(/^email/i).fill(`e2e${stamp}@example.test`);
  await dialog.getByLabel(/department/i).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: /save/i }).click();
  await expect(dialog).toBeHidden();

  await page.getByPlaceholder(/search clients/i).fill(name);
  const row = page.locator("tbody tr", { hasText: name });
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: "Edit" }).click();
  await page.locator("dialog[open]").getByLabel(/contact name/i).fill("Renamed Contact");
  await page.locator("dialog[open]").getByRole("button", { name: /save/i }).click();
  await expect(page.locator("tbody tr", { hasText: name })).toContainText("Renamed Contact");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /export csv/i }).click();
  expect((await download).suggestedFilename()).toBe("Torix_Clients.csv");
});

test("create a lead and see it in the pipeline list", async ({ page }) => {
  const name = `E2E Lead ${Date.now().toString().slice(-6)}`;
  await openPage(page, "Leads");
  await page.getByRole("button", { name: /add lead/i }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel(/lead or organization/i).fill(name);
  await dialog.getByLabel(/department/i).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: /save/i }).click();
  await expect(dialog).toBeHidden();
  await page.getByPlaceholder(/search leads/i).fill(name);
  await expect(page.locator("tbody tr", { hasText: name })).toHaveCount(1);
});
