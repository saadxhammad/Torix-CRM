/**
 * Full Attendance module UI workflow with screenshots.
 * BASE_URL + TORIX_OWNER_EMAIL/PASSWORD
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const email = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const password = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";
const outDir = join(process.cwd(), "smoke-screenshots", "attendance-flow");
mkdirSync(outDir, { recursive: true });

const log = [];
function step(n, msg) {
  const line = `${n}. ${msg}`;
  log.push(line);
  console.log(line);
}

async function shot(page, name) {
  const path = join(outDir, name);
  await page.screenshot({ path, fullPage: true });
  console.log(`  → ${name}`);
  return path;
}

async function api(cookie, body) {
  const res = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ ...body, mode: "live", requestId: crypto.randomUUID() }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.status);
  return json;
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  // 1. Login page
  step(1, "Open login page");
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await shot(page, "01-login.png");

  // 2. Sign in
  step(2, "Sign in as owner");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.wait_for_timeout(8000);
  await shot(page, "02-dashboard.png");

  // Prepare data via API using browser cookies
  const cookies = await context.cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  step(3, "Ensure evening shift + staff profile for attendance");
  let ws = await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } }).then((r) => r.json());
  let shift = (ws.records || []).find((r) => r.kind === "shift" && !r.archived);
  if (!shift) {
    ws = await api(cookie, {
      action: "save",
      kind: "shift",
      data: {
        name: "Night office",
        startTime: "19:00",
        endTime: "04:00",
        breakMinutes: 45,
        graceMinutes: 15,
        paidBreaks: false,
        allowMultipleBreaks: true,
      },
    });
    shift = ws.records.find((r) => r.kind === "shift" && (r.data.name === "Night office" || r.data.startTime === "19:00"));
  }
  let staff = (ws.records || []).find((r) => r.kind === "staff" && !r.archived && r.data.email === email);
  if (!staff) {
    staff = (ws.records || []).find((r) => r.kind === "staff" && !r.archived);
  }
  if (!staff) {
    ws = await api(cookie, {
      action: "save",
      kind: "staff",
      data: {
        name: "Torix Owner",
        email,
        department: "Corporate",
        role: "Owner",
        status: "Active",
        shiftId: shift.id,
        salary: "0",
        currency: "PKR",
      },
    });
    staff = ws.records.find((r) => r.kind === "staff" && r.data.email === email);
  } else if (!staff.data.shiftId) {
    ws = await api(cookie, {
      action: "save",
      kind: "staff",
      id: staff.id,
      data: { ...staff.data, shiftId: shift.id, name: staff.data.name, department: staff.data.department, status: staff.data.status || "Active" },
    });
    staff = ws.records.find((r) => r.id === staff.id);
  }
  console.log(`  staff=${staff?.id} shift=${shift?.id}`);

  // Close any open session first
  const open = (ws.records || []).find(
    (r) => r.kind === "attendance" && r.data.employeeId === staff.id && r.data.status === "In progress",
  );
  if (open) {
    try {
      await api(cookie, { action: "clock_out", id: open.id });
    } catch {
      /* ignore */
    }
  }

  // 4. Navigate to Attendance
  step(4, "Open Attendance page");
  await page.goto(base + "/#/attendance", { waitUntil: "networkidle" });
  await page.wait_for_timeout(4000);
  await shot(page, "03-attendance-empty-or-list.png");

  // 5. Clock in via API (owner may lack employeeId on session — use staff id)
  step(5, "Clock in");
  ws = await api(cookie, { action: "clock_in", data: { employeeId: staff.id, shiftId: shift.id } });
  const session = ws.records.find(
    (r) => r.kind === "attendance" && r.data.employeeId === staff.id && r.data.status === "In progress",
  );
  if (!session) throw new Error("Clock in did not create open session");
  console.log(`  session=${session.id} state=${session.data.state} late=${session.data.lateMinutes}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "04-clocked-in-working.png");

  // 6. Start break
  step(6, "Start break");
  await api(cookie, { action: "break_start", id: session.id });
  await page.reload({ waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "05-on-break.png");

  // 7. End break
  step(7, "End break");
  await api(cookie, { action: "break_end", id: session.id });
  await page.reload({ waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "06-back-to-working.png");

  // 8. Clock out
  step(8, "Clock out");
  await api(cookie, { action: "clock_out", id: session.id });
  await page.reload({ waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "07-clocked-out-submitted.png");

  // Verify session fields
  ws = await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } }).then((r) => r.json());
  const done = ws.records.find((r) => r.id === session.id);
  step(9, `Verify session: status=${done?.data.status} worked=${done?.data.workedMinutes}m break=${done?.data.breakMinutes}m late=${done?.data.lateMinutes}m class=${done?.data.classification}`);
  await shot(page, "08-attendance-history.png");

  // 10. Leave grants page
  step(10, "Leave grants + create grant if needed");
  await page.goto(base + "/#/leave-grants", { waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  let grant = ws.records.find((r) => r.kind === "leavegrant" && r.data.employeeId === staff.id);
  if (!grant) {
    const year = new Date().getFullYear();
    ws = await api(cookie, {
      action: "save",
      kind: "leavegrant",
      data: {
        employeeId: staff.id,
        type: "Annual",
        amount: 10,
        effectiveDate: `${year}-01-01`,
        expiryDate: `${year}-12-31`,
        reason: "Flow test annual grant",
      },
    });
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.wait_for_timeout(2500);
  await shot(page, "09-leave-grants.png");

  // 11. Leave request
  step(11, "Submit leave request (half day)");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await api(cookie, {
    action: "save",
    kind: "leave",
    data: {
      employeeId: staff.id,
      type: "Annual",
      unit: "half",
      start: tomorrow,
      end: tomorrow,
      halfDay: true,
      reason: "Attendance flow test half-day leave",
    },
  });
  await page.goto(base + "/#/leave", { waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "10-leave-request.png");

  // 12. Approvals
  step(12, "Approvals inbox");
  await page.goto(base + "/#/approvals", { waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "11-approvals.png");

  // 13. Leave ledger
  step(13, "Leave ledger");
  await page.goto(base + "/#/leave-ledger", { waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "12-leave-ledger.png");

  // 14. People CSV
  step(14, "People CSV export (attendance)");
  const csvRes = await fetch(base + "/api/people-export?type=attendance&mode=live", {
    headers: { Cookie: cookie },
  });
  const csv = await csvRes.text();
  writeFileSync(join(outDir, "13-attendance-export.csv"), csv);
  console.log(`  CSV ${csvRes.status} bytes=${csv.length} head=${csv.split("\n")[0]}`);

  // 15. Team page (shift / manager fields)
  step(15, "Team page");
  await page.goto(base + "/#/team", { waitUntil: "networkidle" });
  await page.wait_for_timeout(3000);
  await shot(page, "14-team.png");

  // 16. Shifts
  step(16, "Shifts page");
  await page.goto(base + "/#/shifts", { waitUntil: "networkidle" });
  await page.wait_for_timeout(2500);
  await shot(page, "15-shifts.png");

  writeFileSync(join(outDir, "FLOW-LOG.txt"), log.join("\n") + "\n", "utf8");
  await browser.close();
  console.log("\nDone. Screenshots in", outDir);
  console.log("Session summary:", {
    status: done?.data.status,
    state: done?.data.state,
    workedMinutes: done?.data.workedMinutes,
    breakMinutes: done?.data.breakMinutes,
    lateMinutes: done?.data.lateMinutes,
    events: (done?.data.events || []).map((e) => e.type),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
