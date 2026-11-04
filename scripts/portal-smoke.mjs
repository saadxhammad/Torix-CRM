/**
 * Smoke: Owner → CRM; Staff → /portal Check-in/Checkout.
 */
import { chromium } from "@playwright/test";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const ownerEmail = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const ownerPassword = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";
const staffPassword = process.env.TORIX_STAFF_PASSWORD || ownerPassword;
const staffEmail = process.env.TORIX_STAFF_EMAIL || "portal.employee@torix.test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // --- Owner: CRM home, bounce from /portal, unauth 401 ---
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await page.fill('input[type="email"]', ownerEmail);
  await page.fill('input[type="password"]', ownerPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  console.log("owner after login:", page.url());
  if (page.url().includes("/portal")) throw new Error("Owner must not land on /portal");

  await page.goto(base + "/portal", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log("owner /portal redirect:", page.url());
  if (page.url().includes("/portal")) throw new Error("Owner still on /portal");

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
    if (!res.ok) throw new Error(ws.error || "staff create failed");
    staff = ws.records.find((r) => r.kind === "staff" && r.data.email === staffEmail);
  }

  const mem = await fetch(base + "/api/workspace", {
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
  });
  const memJson = await mem.json();
  if (!mem.ok) throw new Error(memJson.error || "member link failed");
  console.log("linked Staff member", staffEmail, "→", staff.id);

  await page.goto(base + "/api/auth/logout?return_to=%2Flogin");
  await page.waitForTimeout(1500);

  const bare = await fetch(base + "/api/workspace?mode=live");
  console.log("unauth workspace status:", bare.status);
  if (bare.status !== 401) throw new Error("Expected 401 without session, got " + bare.status);

  // --- Staff: portal + check-in ---
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await page.fill('input[type="email"]', staffEmail);
  await page.fill('input[type="password"]', staffPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
  console.log("staff after login:", page.url());
  if (!page.url().includes("/portal")) throw new Error("Staff must land on /portal");

  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log("staff / redirect:", page.url());
  if (!page.url().includes("/portal")) throw new Error("Staff must be redirected from / to /portal");

  const checkIn = page.getByRole("button", { name: /Check-in today/i });
  const checkout = page.getByRole("button", { name: /Checkout today/i });
  if (await checkIn.count()) {
    await checkIn.click();
    await page.waitForTimeout(4000);
    console.log("clicked Check-in today");
  } else if (await checkout.count()) {
    console.log("already checked in");
  } else {
    const body = await page.locator(".portal").innerText();
    throw new Error("No check-in/checkout controls: " + body.slice(0, 200));
  }

  if (await page.getByRole("button", { name: /Start break/i }).count()) {
    await page.getByRole("button", { name: /Start break/i }).click();
    await page.waitForTimeout(2000);
  }
  if (await page.getByRole("button", { name: /Checkout today/i }).count()) {
    await page.getByRole("button", { name: /Checkout today/i }).click();
    await page.waitForTimeout(4000);
    console.log("clicked Checkout today");
  }

  await page.getByRole("button", { name: /My attendance/i }).click();
  await page.waitForTimeout(1500);
  const attText = await page.locator(".portal").innerText();
  if (!/Monthly overview|Present|Short|Half|Absent|In progress|—/i.test(attText)) {
    throw new Error("Month overview missing");
  }
  console.log("PASS portal-smoke (owner + staff check-in/out + month)");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
