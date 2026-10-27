import type { Page } from "@playwright/test";
// @ts-expect-error plain .mjs config shared with the app
import { GROUPS } from "../../lib/ui-config.mjs";

export const OWNER = {
  email: process.env.TORIX_OWNER_EMAIL || "owner@torix.test",
  password: process.env.TORIX_OWNER_PASSWORD || "torix-local-pass",
};
export const PAGES: { group: string; name: string }[] = (GROUPS as [string, string[]][]).flatMap(([group, names]) =>
  names.map((name) => ({ group, name })),
);
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Open a page by its hash route and wait for the workspace to finish loading. */
export async function openPage(page: Page, name: string) {
  await page.goto(`/#/${slug(name)}`);
  await page.locator(".dash-main h1").first().waitFor();
  await page.waitForLoadState("networkidle");
}
