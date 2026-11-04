/**
 * Smoke: Admin sets employee password → login → employee changes password → re-login.
 */
import { chromium } from "@playwright/test";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const ownerEmail = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const ownerPassword = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";
const stamp = Date.now().toString(36);
const empEmail = `pwd.${stamp}@torix.demo`;
const initialPwd = `Init-${stamp}-pass`;
const nextPwd = `Next-${stamp}-pass9`;

async function api(cookie, body) {
  const r = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ ...body, mode: "live", requestId: crypto.randomUUID() }),
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, json: j };
}

async function loginJson(email, password) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  const set = r.headers.getSetCookie?.() || [];
  return { ok: r.ok, status: r.status, json: j, cookies: set };
}

function cookieHeader(setCookies) {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log("base", base);
  const owner = await loginJson(ownerEmail, ownerPassword);
  if (!owner.ok) throw new Error("Owner login failed: " + JSON.stringify(owner.json));
  const cookie = cookieHeader(owner.cookies);

  const created = await api(cookie, {
    action: "save",
    kind: "staff",
    data: {
      name: "Password Smoke " + stamp,
      department: "Development",
      email: empEmail,
      loginPassword: initialPwd,
      role: "QA Engineer",
      status: "Active",
      joinDate: "2026-01-01",
      salary: 100000,
      currency: "PKR",
    },
  });
  if (!created.ok) throw new Error("Create staff failed: " + (created.json.error || created.status));
  const staff = (created.json.records || []).find(
    (r) => r.kind === "staff" && String(r.data.email || "").toLowerCase() === empEmail,
  );
  if (!staff) throw new Error("Staff row missing after create");
  console.log("created staff", staff.id, empEmail);

  const bad = await loginJson(empEmail, "wrong-password-xx");
  if (bad.ok) throw new Error("Wrong password should fail");
  console.log("reject wrong password OK");

  const emp = await loginJson(empEmail, initialPwd);
  if (!emp.ok) throw new Error("Employee login with set password failed: " + JSON.stringify(emp.json));
  if (!String(emp.json.redirectTo || "").includes("/portal")) throw new Error("Expected portal redirect");
  console.log("login with Admin-set password OK →", emp.json.redirectTo);

  const empCookie = cookieHeader(emp.cookies);
  const changed = await api(empCookie, {
    action: "change_password",
    data: {
      currentPassword: initialPwd,
      newPassword: nextPwd,
      confirmPassword: nextPwd,
    },
  });
  if (!changed.ok) throw new Error("change_password failed: " + (changed.json.error || changed.status));
  console.log("employee change_password OK");

  const old = await loginJson(empEmail, initialPwd);
  if (old.ok) throw new Error("Old password should no longer work");
  const again = await loginJson(empEmail, nextPwd);
  if (!again.ok) throw new Error("Login with new password failed: " + JSON.stringify(again.json));
  console.log("login with changed password OK");

  // UI check: Password tab visible
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', empEmail);
  await page.fill('input[type="password"]', nextPwd);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  if (!page.url().includes("/portal")) throw new Error("UI login did not reach portal: " + page.url());
  await page.getByRole("button", { name: /^Password$/i }).click();
  await page.waitForTimeout(1000);
  const hasForm = await page.getByText(/Change password/i).count();
  if (!hasForm) throw new Error("Password tab missing");
  console.log("portal Password tab OK");
  await browser.close();

  console.log("PASS password-feature-smoke");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
