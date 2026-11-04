/**
 * Portal E2E with screenshots → smoke-screenshots/portal/
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const ownerEmail = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const ownerPassword = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";
const staffPassword = process.env.TORIX_STAFF_PASSWORD || ownerPassword;
const staffEmail = process.env.TORIX_STAFF_EMAIL || "portal.employee@torix.test";
const outDir = join(process.cwd(), "smoke-screenshots", "portal");
mkdirSync(outDir, { recursive: true });

const log = [];
function step(msg) {
  console.log(msg);
  log.push(msg);
}

async function shot(page, name) {
  const path = join(outDir, name);
  await page.screenshot({ path, fullPage: true });
  console.log("  →", name);
  return path;
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // 1. Login page
  step("1. Login page");
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await shot(page, "01-login.png");

  // 2. Owner → CRM (not portal)
  step("2. Owner sign-in → CRM");
  await page.fill('input[type="email"]', ownerEmail);
  await page.fill('input[type="password"]', ownerPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
  await shot(page, "02-owner-crm.png");
  if (page.url().includes("/portal")) throw new Error("Owner landed on portal");

  // Ensure staff member linked
  const cookies = await context.cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  let ws = await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } }).then((r) =>
    r.json(),
  );
  let staff = (ws.records || []).find(
    (r) => r.kind === "staff" && !r.archived && r.data.email === staffEmail,
  );
  if (!staff) {
    const res = await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
      body: JSON.stringify({
        action: "save",
        kind: "staff",
        mode: "live",
        requestId: crypto.randomUUID(),
        data: {
          name: "Portal Employee",
          department: "Development",
          email: staffEmail,
          role: "Engineer",
          status: "Active",
          joinDate: "2025-01-01",
          salary: 80000,
          currency: "PKR",
        },
      }),
    });
    ws = await res.json();
    if (!res.ok) throw new Error(ws.error || "staff create");
    staff = ws.records.find((r) => r.kind === "staff" && r.data.email === staffEmail);
  }
  await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({
      action: "member",
      mode: "live",
      requestId: crypto.randomUUID(),
      data: {
        email: staffEmail,
        role: "Staff",
        departments: ["Development"],
        employeeId: staff.id,
        active: true,
        grants: [],
      },
    }),
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "member");
  });

  // Owner blocked from portal
  step("3. Owner /portal redirect");
  await page.goto(base + "/portal", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, "03-owner-blocked-from-portal.png");

  // Logout
  await page.goto(base + "/api/auth/logout?return_to=%2Flogin");
  await page.waitForTimeout(2000);

  // 4. Staff login → portal
  step("4. Staff sign-in → /portal");
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await page.fill('input[type="email"]', staffEmail);
  await page.fill('input[type="password"]', staffPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
  await shot(page, "04-staff-portal-today.png");
  if (!page.url().includes("/portal")) throw new Error("Staff not on /portal: " + page.url());

  // Close open session if any so check-in is visible
  const staffCookies = await context.cookies();
  const staffCookie = staffCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  let sws = await fetch(base + "/api/workspace?mode=live", {
    headers: { Cookie: staffCookie },
  }).then((r) => r.json());
  const open = (sws.records || []).find(
    (r) =>
      r.kind === "attendance" &&
      r.data.employeeId === staff.id &&
      r.data.status === "In progress",
  );
  if (open) {
    const last = (open.data.events || [])[(open.data.events || []).length - 1]?.type;
    if (last === "break_start") {
      await fetch(base + "/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: staffCookie, Origin: base },
        body: JSON.stringify({
          action: "break_end",
          id: open.id,
          mode: "live",
          requestId: crypto.randomUUID(),
        }),
      });
    }
    await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookie, Origin: base },
      body: JSON.stringify({
        action: "clock_out",
        id: open.id,
        mode: "live",
        requestId: crypto.randomUUID(),
      }),
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
  }

  // 5. Check-in
  step("5. Check-in today");
  const checkIn = page.getByRole("button", { name: /Check-in today/i });
  if (await checkIn.count()) {
    await checkIn.click();
    await page.waitForTimeout(4000);
  }
  await shot(page, "05-after-checkin.png");

  // 6. Break + checkout
  step("6. Break + Checkout");
  if (await page.getByRole("button", { name: /Start break/i }).count()) {
    await page.getByRole("button", { name: /Start break/i }).click();
    await page.waitForTimeout(2500);
    await shot(page, "06-on-break.png");
  }
  if (await page.getByRole("button", { name: /Checkout today/i }).count()) {
    await page.getByRole("button", { name: /Checkout today/i }).click();
    await page.waitForTimeout(4000);
  }
  await shot(page, "07-after-checkout.png");

  // 7. Month overview
  step("7. My attendance month grid");
  await page.getByRole("button", { name: /My attendance/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, "08-month-overview.png");

  // 8. Leave tab
  step("8. My leave");
  await page.getByRole("button", { name: /My leave/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, "09-leave-tab.png");

  // 9. Staff cannot use CRM /
  step("9. Staff / → redirect portal");
  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, "10-staff-blocked-from-crm.png");
  if (!page.url().includes("/portal")) throw new Error("Staff not redirected from /");

  writeFileSync(join(outDir, "FLOW-LOG.txt"), log.join("\n") + "\n");
  console.log("\nScreenshots →", outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
