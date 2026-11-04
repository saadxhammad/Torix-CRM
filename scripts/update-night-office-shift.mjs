/**
 * Point all live shifts at Torix night office 19:00–04:00 Karachi.
 */
import { chromium } from "@playwright/test";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const email = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const password = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";

const NIGHT = {
  name: "Night office",
  startTime: "19:00",
  endTime: "04:00",
  breakMinutes: 45,
  graceMinutes: 15,
  paidBreaks: false,
  allowMultipleBreaks: true,
};

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  const ws = await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } }).then((r) =>
    r.json(),
  );
  const shifts = (ws.records || []).filter((r) => r.kind === "shift" && !r.archived);
  console.log("Updating", shifts.length, "shift(s)");

  for (const s of shifts) {
    const res = await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
      body: JSON.stringify({
        action: "save",
        kind: "shift",
        id: s.id,
        mode: "live",
        requestId: crypto.randomUUID(),
        data: { ...s.data, ...NIGHT },
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || s.id);
    console.log("  ✓", s.id, "→ 19:00–04:00");
  }

  if (!shifts.length) {
    const res = await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
      body: JSON.stringify({
        action: "save",
        kind: "shift",
        mode: "live",
        requestId: crypto.randomUUID(),
        data: NIGHT,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "create");
    console.log("  ✓ created Night office");
  }

  // Point portal employee + Smoke Staff at night shift
  const night = (
    await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } }).then((r) => r.json())
  ).records.find((r) => r.kind === "shift" && r.data.startTime === "19:00");

  for (const st of (ws.records || []).filter((r) => r.kind === "staff" && !r.archived)) {
    await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
      body: JSON.stringify({
        action: "save",
        kind: "staff",
        id: st.id,
        mode: "live",
        requestId: crypto.randomUUID(),
        data: { ...st.data, name: st.data.name, department: st.data.department || "Development", shiftId: night.id, status: st.data.status || "Active" },
      }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) console.warn("staff", st.data.name, j.error);
      else console.log("  staff", st.data.name, "→ night shift");
    });
  }

  await browser.close();
  console.log("Done. Office 7pm–4am, grace 15m, short≤2h / half>2h of", 9 * 60 - 45, "m scheduled.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
