import { test, expect } from "@playwright/test";
import { OWNER } from "./helpers";

test("protected workspace redirects anonymous visitors to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows an error and stays on login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill("definitely-wrong");
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("owner can sign in and sign out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await expect(page.locator(".sb-nav")).toBeVisible();
  await page.getByRole("link", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});
