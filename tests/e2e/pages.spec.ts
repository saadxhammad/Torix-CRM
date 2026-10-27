import { test, expect } from "@playwright/test";
import { PAGES, openPage } from "./helpers";

// Pages the seed script fills with rows; every other page just has to render cleanly.
const SEEDED = new Set([
  "Approvals", "Leads", "Clients", "Proposals", "Tenders", "Orders", "Contracts", "Amendments", "Tasks", "Milestones", "Work logs",
  "Team", "Attendance", "Leave", "Leave balances", "Payroll", "Shifts", "Holidays", "Invoices", "Expenses", "Vendors", "Bills",
  "Transactions", "Accounts", "Equipment", "Renewals",
]);

for (const { group, name } of PAGES) {
  test(`${group} / ${name} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await openPage(page, name);
    await expect(page.locator(".dash-main h1")).toHaveText(name === "Dashboard" ? "Company overview" : name);
    await expect(page.locator(".sb-item.is-active")).toContainText(name);
    await expect(page.locator(".error-banner")).toHaveCount(0);

    if (SEEDED.has(name)) {
      await expect(page.locator(".dash-main tbody tr, .dash-main .activity-row").first(), `${name} should show seeded rows`).toBeVisible();
    }

    // No horizontal page overflow: wide tables must scroll inside their own wrapper.
    const overflow = await page.evaluate(() => {
      const m = document.querySelector(".dash-main")!;
      return { content: m.scrollWidth - m.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
    });
    expect(overflow.content, "content column overflows horizontally").toBeLessThanOrEqual(1);
    expect(overflow.doc, "document overflows horizontally").toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
