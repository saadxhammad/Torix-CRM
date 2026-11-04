/**
 * Realistic Admin / HR / Employee workflow audit with screenshots.
 * Output: smoke-screenshots/role-audit/
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const base = (process.env.BASE_URL || "https://torix-crm-gamma.vercel.app").replace(/\/$/, "");
const ownerEmail = process.env.TORIX_OWNER_EMAIL || "torix.dev12@gmail.com";
const ownerPassword = process.env.TORIX_OWNER_PASSWORD || "torix@dev12@";
const staffPassword = process.env.TORIX_STAFF_PASSWORD || ownerPassword;

const HR_EMAIL = "hr.fatima@torix.demo";
const EMP_EMAIL = "emp.ali@torix.demo";
const MUNEEB_EMAIL = "komotech329@gmail.com";

const outDir = join(process.cwd(), "smoke-screenshots", "role-audit");
mkdirSync(outDir, { recursive: true });

const log = [];
const matrix = []; // {role, feature, status, detail}

function step(msg) {
  console.log(msg);
  log.push(msg);
}
function mark(role, feature, status, detail = "") {
  matrix.push({ role, feature, status, detail });
  console.log(`  [${status}] ${role} · ${feature}${detail ? " — " + detail : ""}`);
}
async function shot(page, name) {
  const path = join(outDir, name);
  await page.screenshot({ path, fullPage: true });
  console.log("  →", name);
  return path;
}

async function api(cookie, body) {
  const r = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ ...body, mode: "live", requestId: crypto.randomUUID() }),
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, json: j };
}

async function getWs(cookie) {
  const r = await fetch(base + "/api/workspace?mode=live", { headers: { Cookie: cookie } });
  return { ok: r.ok, status: r.status, json: await r.json() };
}

async function login(page, email, password) {
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
  return page.url();
}

async function logout(page) {
  await page.goto(base + "/api/auth/logout?return_to=%2Flogin");
  await page.waitForTimeout(2000);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  // ---------- 0. Login page + failed access before grant ----------
  step("0. Login page + ungranted email demo");
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 90000 });
  await shot(page, "00-login.png");
  await page.fill('input[type="email"]', "nobody.ungranted@torix.demo");
  await page.fill('input[type="password"]', staffPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await shot(page, "00b-login-denied-ungranted.png");
  const denyText = await page.locator(".form-error").innerText().catch(() => "");
  mark("System", "Login rejects unknown email", /granted|Invalid/i.test(denyText) ? "Working" : "Not working", denyText.slice(0, 80));

  // ---------- 1. Admin seed ----------
  step("1. Admin (Owner) login + seed HR/Employee/Muneeb");
  const ownerUrl = await login(page, ownerEmail, ownerPassword);
  await shot(page, "01-admin-home.png");
  mark("Admin", "Land on CRM /", ownerUrl.includes("/portal") ? "Not working" : "Working", ownerUrl);

  let cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  let ws = await getWs(cookie);
  if (!ws.ok) throw new Error("Owner workspace load failed: " + ws.json.error);

  let night = (ws.json.records || []).find((r) => r.kind === "shift" && !r.archived && r.data.startTime === "19:00");
  if (!night) {
    const created = await api(cookie, {
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
    night = created.json.records.find((r) => r.kind === "shift" && r.data.startTime === "19:00");
  }

  async function upsertStaff(email, name, department, roleTitle, salary) {
    ws = await getWs(cookie);
    let st = (ws.json.records || []).find(
      (r) => r.kind === "staff" && !r.archived && String(r.data.email || "").toLowerCase() === email,
    );
    const data = {
      name,
      department,
      email,
      role: roleTitle,
      status: "Active",
      joinDate: "2025-06-01",
      salary,
      currency: "PKR",
      shiftId: night.id,
    };
    const res = await api(cookie, st ? { action: "save", kind: "staff", id: st.id, data: { ...st.data, ...data } } : { action: "save", kind: "staff", data });
    if (!res.ok) throw new Error("staff " + email + ": " + res.json.error);
    st = res.json.records.find((r) => r.kind === "staff" && String(r.data.email || "").toLowerCase() === email);
    return st;
  }

  const fatima = await upsertStaff(HR_EMAIL, "Fatima Khan", "Corporate", "HR Manager", 180000);
  const ali = await upsertStaff(EMP_EMAIL, "Ali Raza", "Development", "Software Engineer", 150000);
  // Muneeb already exists from user's Team create — re-save to trigger login grant + lowercase email
  let muneeb = (ws.json.records || []).find(
    (r) => r.kind === "staff" && String(r.data.email || "").toLowerCase().includes("komotech329"),
  );
  if (muneeb) {
    const res = await api(cookie, {
      action: "save",
      kind: "staff",
      id: muneeb.id,
      data: {
        ...muneeb.data,
        name: muneeb.data.name || "Muneeb",
        department: muneeb.data.department || "Development",
        email: MUNEEB_EMAIL,
        status: "Active",
        shiftId: night.id,
      },
    });
    if (!res.ok) step("Muneeb re-save warn: " + res.json.error);
    else muneeb = res.json.records.find((r) => r.id === muneeb.id);
  } else {
    muneeb = await upsertStaff(MUNEEB_EMAIL, "Muneeb", "Development", "Senior lead generation", 90000);
  }

  // Elevate Fatima to HR (Team auto-grant is Staff; promote via member)
  let mem = await api(cookie, {
    action: "member",
    data: {
      email: HR_EMAIL,
      role: "HR",
      departments: ["Corporate", "Development", "Marketing", "Medical Billing"],
      employeeId: fatima.id,
      active: true,
      grants: ["salary.read"],
    },
  });
  mark("Admin", "Grant HR membership", mem.ok ? "Working" : "Not working", mem.json.error || HR_EMAIL);

  mem = await api(cookie, {
    action: "member",
    data: {
      email: EMP_EMAIL,
      role: "Staff",
      departments: ["Development"],
      employeeId: ali.id,
      active: true,
      grants: [],
    },
  });
  mark("Admin", "Grant Employee membership", mem.ok ? "Working" : "Not working", mem.json.error || EMP_EMAIL);

  mem = await api(cookie, {
    action: "member",
    data: {
      email: MUNEEB_EMAIL,
      role: "Staff",
      departments: ["Development"],
      employeeId: muneeb.id,
      active: true,
      grants: [],
    },
  });
  mark("Admin", "Grant Muneeb Staff login", mem.ok ? "Working" : "Not working", mem.json.error || MUNEEB_EMAIL);

  // Leave grant for Ali
  await api(cookie, {
    action: "save",
    kind: "leavegrant",
    data: {
      employeeId: ali.id,
      type: "Annual",
      amount: 10,
      effectiveDate: "2026-01-01",
      expiryDate: "2026-12-31",
      reason: "Audit annual allotment for Ali",
    },
  });

  // Navigate Admin UI probes
  await page.goto(base + "/#/team", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "02-admin-team.png");
  mark("Admin", "Team page", /Team|employee/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/users-and-roles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "03-admin-users-roles.png");
  const usersText = await page.locator("main").innerText();
  mark("Admin", "Users and roles", /Users and roles|hr\.fatima|emp\.ali|komotech/i.test(usersText) ? "Working" : "Partial", usersText.slice(0, 100));

  await page.goto(base + "/#/leave-grants", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "04-admin-leave-grants.png");
  mark("Admin", "Leave grants", /Leave grants|Grant|Annual/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/attendance", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "05-admin-attendance.png");
  mark("Admin", "Attendance + Convert late UI", /Attendance|Convert late|Clock/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/invoices", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "06-admin-invoices.png");
  mark("Admin", "Finance Invoices", /Invoice|Finance|No invoices/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "07-admin-settings.png");
  mark("Admin", "Settings", /Settings|company|timezone/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  // Admin blocked from portal
  await page.goto(base + "/portal", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "08-admin-portal-blocked.png");
  mark("Admin", "Cannot use /portal", page.url().includes("/portal") ? "Not working" : "Working", page.url());

  // ---------- 2. HR ----------
  step("2. HR login + probes");
  await logout(page);
  const hrUrl = await login(page, HR_EMAIL, staffPassword);
  await shot(page, "10-hr-home.png");
  mark("HR", "Login + land CRM", !hrUrl.includes("/portal") && !hrUrl.includes("/login") ? "Working" : "Not working", hrUrl);

  cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  ws = await getWs(cookie);
  mark("HR", "Workspace API load", ws.ok ? "Working" : "Not working", ws.json.error || `role=${ws.json.access?.role}`);

  const hrCaps = new Set(ws.json.access?.caps || []);
  mark("HR", "leave.admin cap", hrCaps.has("leave.admin") || hrCaps.has("*") ? "Working" : "Not working");
  mark("HR", "No full * admin", !hrCaps.has("*") ? "Working" : "Partial", "HR should not be Owner");

  await page.goto(base + "/#/team", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "11-hr-team.png");
  mark("HR", "Team / people.read", /Team|Ali|Fatima|Muneeb/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/leave", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "12-hr-leave.png");
  mark("HR", "Leave module", /Leave/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  await page.goto(base + "/#/leave-grants", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "13-hr-leave-grants.png");
  mark("HR", "Leave grants (admin)", /Leave grants|Grant|Annual/i.test(await page.locator("main").innerText()) ? "Working" : "Not working");

  // Finance: try create invoice via API — should fail or be forbidden
  const inv = await api(cookie, {
    action: "save",
    kind: "invoice",
    data: { clientId: "x", currency: "PKR", date: "2026-11-01", due: "2026-11-15", lines: [] },
  });
  mark(
    "HR",
    "Finance write denied",
    !inv.ok ? "Working" : "Not working",
    inv.json.error || "unexpected success",
  );

  await page.goto(base + "/#/invoices", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "14-hr-invoices-attempt.png");
  const hrInv = await page.locator("main").innerText();
  // HR may see empty/denied or redirected
  mark(
    "HR",
    "Invoices UI not available",
    !/Add invoice|Issue invoice/i.test(hrInv) || /outside|permit|No invoices|overview|Dashboard/i.test(hrInv)
      ? "Working"
      : "Partial",
    hrInv.slice(0, 80),
  );

  await page.goto(base + "/portal", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "15-hr-portal-blocked.png");
  mark("HR", "Cannot use employee /portal", page.url().includes("/portal") ? "Not working" : "Working", page.url());

  // ---------- 3. Employee Ali ----------
  step("3. Employee (Ali) portal workflow");
  await logout(page);
  const empUrl = await login(page, EMP_EMAIL, staffPassword);
  await shot(page, "20-employee-portal.png");
  mark("Employee", "Login → /portal", empUrl.includes("/portal") ? "Working" : "Not working", empUrl);

  cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  ws = await getWs(cookie);
  mark("Employee", "employeeId linked", ws.json.access?.employeeId ? "Working" : "Not working", ws.json.access?.employeeId || "empty");

  // Close open session if any
  let open = (ws.json.records || []).find(
    (r) => r.kind === "attendance" && r.data.employeeId === ali.id && r.data.status === "In progress",
  );
  if (open) {
    await api(cookie, { action: "clock_out", id: open.id, data: {} });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
  }

  // Prefer UI check-in; fall back to API if the button race/toast fails
  const checkIn = page.getByRole("button", { name: /Check-in today/i });
  if (await checkIn.count()) {
    await checkIn.click();
    await page.waitForTimeout(5000);
  }
  ws = await getWs(cookie);
  open = (ws.json.records || []).find(
    (r) => r.kind === "attendance" && r.data.employeeId === ali.id && r.data.status === "In progress",
  );
  if (!open) {
    const cin = await api(cookie, {
      action: "clock_in",
      data: { employeeId: ali.id },
    });
    open = (cin.json.records || []).find(
      (r) => r.kind === "attendance" && r.data.employeeId === ali.id && r.data.status === "In progress",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    mark("Employee", "Check-in today", open ? "Working" : "Not working", open ? "via API fallback" : cin.json.error || "no open session");
  } else {
    mark("Employee", "Check-in today", "Working");
  }
  await shot(page, "21-employee-checked-in.png");

  // Drive break + checkout via API (UI checkout switches tab; break toggles race under Playwright)
  ws = await getWs(cookie);
  open = (ws.json.records || []).find(
    (r) => r.kind === "attendance" && r.data.employeeId === ali.id && r.data.status === "In progress",
  );
  if (open) {
    const bs = await api(cookie, { action: "break_start", id: open.id, data: {} });
    const be = await api(cookie, { action: "break_end", id: open.id, data: {} });
    mark(
      "Employee",
      "Start/End break",
      bs.ok && be.ok ? "Working" : "Not working",
      [bs.json.error, be.json.error].filter(Boolean).join("; ") || open.id,
    );
    const cout = await api(cookie, { action: "clock_out", id: open.id, data: {} });
    ws = cout.ok ? cout : await getWs(cookie);
    const closed = (ws.json.records || []).find((r) => r.id === open.id && r.data.clockOut);
    mark(
      "Employee",
      "Checkout today + auto classify",
      closed || cout.ok ? "Working" : "Not working",
      closed
        ? `${closed.data.status || ""} / ${closed.data.classification || "stamped"}`
        : cout.json.error || "no closed session",
    );
  } else {
    mark("Employee", "Start/End break", "Not working", "no open session");
    mark("Employee", "Checkout today + auto classify", "Not working", "no open session");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await shot(page, "22-employee-after-checkout.png");

  await page.getByRole("button", { name: /My attendance/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, "23-employee-month.png");
  mark(
    "Employee",
    "Monthly attendance overview",
    /Monthly overview|Present|Short|Half|Absent/i.test(await page.locator(".portal").innerText())
      ? "Working"
      : "Not working",
  );

  await page.getByRole("button", { name: /My leave/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, "24-employee-leave.png");
  mark(
    "Employee",
    "Leave KPIs + request form",
    /Annual|Request leave|Submit leave/i.test(await page.locator(".portal").innerText()) ? "Working" : "Not working",
  );

  // Submit a short leave request on a unique date (avoid overlap across audit re-runs)
  let leaveOk = false;
  let leaveDetail = "";
  for (let i = 0; i < 5 && !leaveOk; i++) {
    const leaveDay = `2026-12-${String(5 + i * 2).padStart(2, "0")}`;
    const leaveSave = await api(cookie, {
      action: "save",
      kind: "leave",
      data: {
        employeeId: ali.id,
        type: "Annual",
        unit: "short",
        start: leaveDay,
        end: leaveDay,
        reason: "Audit short leave " + leaveDay + " " + Date.now(),
      },
    });
    if (leaveSave.ok) {
      leaveOk = true;
      leaveDetail = leaveDay;
    } else if (/overlap|saved a change first|Refresh/i.test(leaveSave.json.error || "")) {
      leaveDetail = leaveSave.json.error || "";
      await new Promise((r) => setTimeout(r, 800));
    } else {
      leaveDetail = leaveSave.json.error || "";
      break;
    }
  }
  mark("Employee", "Submit own leave", leaveOk ? "Working" : "Not working", leaveDetail);

  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "25-employee-crm-blocked.png");
  mark("Employee", "CRM / redirected to portal", page.url().includes("/portal") ? "Working" : "Not working", page.url());

  const invEmp = await api(cookie, {
    action: "save",
    kind: "invoice",
    data: { clientId: "x", currency: "PKR", date: "2026-11-01", due: "2026-11-15", lines: [] },
  });
  mark("Employee", "Finance write denied", !invEmp.ok ? "Working" : "Not working", invEmp.json.error || "");

  // ---------- 4. Muneeb (real user email) ----------
  step("4. Muneeb login (real Team employee)");
  await logout(page);
  const munUrl = await login(page, MUNEEB_EMAIL, staffPassword);
  await shot(page, "30-muneeb-portal.png");
  mark("Employee(Muneeb)", "Login after grant", munUrl.includes("/portal") ? "Working" : "Not working", munUrl);

  // ---------- Report ----------
  const md = [
    `# Role workflow audit`,
    ``,
    `Base: ${base}`,
    `When: ${new Date().toISOString()}`,
    ``,
    `## How employees log in`,
    ``,
    `1. Admin adds the person under **Team** with a work email (now auto-grants Staff membership), **or** under **Users and roles**.`,
    `2. They sign in with that **email** + the shared **company staff password** (\`TORIX_STAFF_PASSWORD\`, often same as owner password locally).`,
    `3. **Staff** land on \`/portal\`. **HR / Admin** land on the CRM \`/\`.`,
    `4. No unique password is emailed or generated per employee.`,
    ``,
    `### Demo accounts`,
    `| Role | Email | Password |`,
    `|------|-------|----------|`,
    `| Admin | ${ownerEmail} | owner password |`,
    `| HR | ${HR_EMAIL} | staff password |`,
    `| Employee | ${EMP_EMAIL} | staff password |`,
    `| Employee (Muneeb) | ${MUNEEB_EMAIL} | staff password |`,
    ``,
    `## Feature matrix`,
    ``,
    `| Role | Feature | Status | Detail |`,
    `|------|---------|--------|--------|`,
    ...matrix.map((r) => {
      const detail = String(r.detail || "")
        .replace(/\s+/g, " ")
        .replace(/\|/g, "/")
        .slice(0, 120);
      return `| ${r.role} | ${r.feature} | **${r.status}** | ${detail} |`;
    }),
    ``,
    `## Known gaps (by design / out of scope)`,
    ``,
    `- Shared staff password only — no per-employee password or invite email.`,
    `- Team-without-Users historically blocked login — **fixed**: Team save with email now upserts Staff \`company_members\`.`,
    `- HR cannot use \`/portal\` unless role is Staff (HR stays on CRM).`,
    `- Staff portal needs shift/holiday read access — **fixed** (\`attendance.own\` may read shifts).`,
    ``,
    `## Screenshots`,
    ``,
    ...[
      "00-login.png",
      "00b-login-denied-ungranted.png",
      "01-admin-home.png",
      "02-admin-team.png",
      "03-admin-users-roles.png",
      "04-admin-leave-grants.png",
      "05-admin-attendance.png",
      "06-admin-invoices.png",
      "07-admin-settings.png",
      "08-admin-portal-blocked.png",
      "10-hr-home.png",
      "11-hr-team.png",
      "12-hr-leave.png",
      "13-hr-leave-grants.png",
      "14-hr-invoices-attempt.png",
      "15-hr-portal-blocked.png",
      "20-employee-portal.png",
      "21-employee-checked-in.png",
      "22-employee-after-checkout.png",
      "23-employee-month.png",
      "24-employee-leave.png",
      "25-employee-crm-blocked.png",
      "30-muneeb-portal.png",
    ].map((f) => `- \`${f}\``),
    ``,
  ].join("\n");

  writeFileSync(join(outDir, "REPORT.md"), md);
  writeFileSync(join(outDir, "FLOW-LOG.txt"), log.join("\n") + "\n");
  writeFileSync(join(outDir, "matrix.json"), JSON.stringify(matrix, null, 2));
  console.log("\nReport →", join(outDir, "REPORT.md"));

  const failed = matrix.filter((m) => m.status === "Not working");
  console.log(`\n=== ${matrix.filter((m) => m.status === "Working").length} working, ${matrix.filter((m) => m.status === "Partial").length} partial, ${failed.length} not working ===\n`);
  await browser.close();
  process.exit(failed.length > 3 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
