#!/usr/bin/env node
/**
 * Professional demo dataset for Torix CRM.
 *
 * Wipes the owner's live workspace and rebuilds it through the real HTTP API, so every
 * finance rule (invoice -> earn -> collect, approvals, payroll) is enforced by the server.
 * Dates are relative to today, so dashboard KPIs and charts are always populated.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://... \
 *   TORIX_OWNER_EMAIL=... TORIX_OWNER_PASSWORD=... node scripts/seed.mjs
 *
 * Refuses to wipe a database that is not local unless SEED_ALLOW_REMOTE=1.
 */
import postgres from "postgres";

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const email = process.env.TORIX_OWNER_EMAIL || "owner@torix.test";
const password = process.env.TORIX_OWNER_PASSWORD || "torix-local-pass";
const dbUrl = process.env.DATABASE_URL || "";
const ownerId = process.env.TORIX_OWNER_ID || "torix-owner";
const wsId = `${ownerId}:live`;

if (!dbUrl) throw new Error("DATABASE_URL is required to wipe the workspace before seeding.");
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) && process.env.SEED_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to wipe a non-local database. Set SEED_ALLOW_REMOTE=1 if you really mean it.");
}

/* ---------- date helpers (Karachi calendar day) ---------- */
const karachiToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const day = (offset) => {
  const d = new Date(`${karachiToday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const monthOf = (offset) => day(offset).slice(0, 7);
const weekdays = (count) => {
  const out = [];
  for (let i = 1; out.length < count; i++) {
    const dt = day(-i), wd = new Date(`${dt}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(dt);
  }
  return out;
};

/* ---------- API plumbing ---------- */
let cookie = "";
let state = { records: [] };
const failures = [];
const api = async (path, body) => {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(body ? { Origin: base } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
};
async function call(label, body) {
  const before = new Set(state.records.map((r) => r.id));
  try {
    const out = await api("/api/workspace", { mode: "live", requestId: crypto.randomUUID(), ...body });
    if (out.records) state = out;
    return { out, created: state.records.filter((r) => !before.has(r.id)) };
  } catch (e) {
    failures.push(`${label}: ${e.message}`);
    return { out: null, created: [] };
  }
}
/** Save a record and return its id (or null when the server rejected it). */
async function save(kind, data, label = `${kind} ${data.name || data.number || ""}`) {
  const { created } = await call(label, { action: "save", kind, data });
  return created.find((r) => r.kind === kind)?.id || null;
}
const move = (id, transition, input = {}, label = `${transition} ${id}`) =>
  id ? call(label, { action: "transition", id, transition, data: input }) : null;
const post = (kind, input, label) => call(label || `post ${kind}`, { action: "post", data: { kind, ...input } });

/* ---------- 1. sign in and wipe ---------- */
{
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}). Check TORIX_OWNER_EMAIL / TORIX_OWNER_PASSWORD.`);
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  for (const t of ["records", "finance_events", "audit_events", "operations"]) {
    await sql.unsafe(`delete from ${t} where workspace_id = $1`, [wsId]);
  }
  await sql.unsafe("update workspaces set revision = 0 where id = $1", [wsId]);
  await sql.end();
}

/* ---------- 2. company set-up ---------- */
await save("settings", {
  companyName: "Torix Solutions", currency: "PKR", timezone: "Asia/Karachi",
  departments: ["Marketing", "Medical Billing", "Development", "Corporate"],
  address: "Office 12, Clifton Block 5, Karachi, Pakistan", email: "accounts@torix.example", phone: "+92 21 3555 0100",
  invoicePrefix: "TX-INV", paymentTerms: "Payment due within 14 days of invoice date.",
  bankDetails: "Meezan Bank, Torix Solutions, A/C 0123-4567890", defaultLeaveDays: 14,
}, "settings");

const dayShift = await save("shift", { name: "Day shift", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 15 });
await save("shift", { name: "Late shift (US overlap)", startTime: "14:00", endTime: "23:00", breakMinutes: 60, graceMinutes: 10 });
for (const [name, date] of [["Iqbal Day", "2026-11-09"], ["Quaid-e-Azam Day", "2026-12-25"], ["Kashmir Solidarity Day", "2027-02-05"]]) {
  await save("holiday", { name, date });
}

const bankPkr = await save("bank", { name: "Meezan Current Account", type: "Bank", currency: "PKR", reference: "0123-4567890", status: "Active" });
await save("bank", { name: "Payoneer USD Wallet", type: "Wallet", currency: "USD", reference: "PY-884210", status: "Active" });
await save("bank", { name: "Petty Cash", type: "Cash", currency: "PKR", reference: "Office safe", status: "Active" });

/* Contract values scale so monthly revenue comfortably covers payroll and overheads. */
const K = 2.2, SALARY = 0.55;

/* ---------- 3. team ---------- */
const staffDefs = [
  ["Aisha Rahman", "Marketing", "Marketing Lead", "aisha.rahman", 320000, "2023-03-01"],
  ["Hamza Siddiqui", "Marketing", "Performance Marketer", "hamza.siddiqui", 190000, "2024-02-12"],
  ["Mehwish Ali", "Marketing", "Content Strategist", "mehwish.ali", 150000, "2024-08-05"],
  ["Bilal Ahmed", "Medical Billing", "Billing Manager", "bilal.ahmed", 260000, "2022-11-14"],
  ["Rabia Noor", "Medical Billing", "Claims Specialist", "rabia.noor", 120000, "2024-01-22"],
  ["Usman Tariq", "Medical Billing", "AR Follow-up Analyst", "usman.tariq", 110000, "2024-06-03"],
  ["Sara Hussain", "Development", "Senior Full-stack Engineer", "sara.hussain", 450000, "2022-05-16"],
  ["Daniyal Khan", "Development", "Frontend Engineer", "daniyal.khan", 280000, "2023-09-18"],
  ["Fatima Zahra", "Development", "QA Engineer", "fatima.zahra", 210000, "2024-04-01"],
  ["Imran Qureshi", "Development", "DevOps Engineer", "imran.qureshi", 340000, "2023-01-09"],
  ["Hira Baig", "Corporate", "Finance & Admin Manager", "hira.baig", 240000, "2022-08-01"],
  ["Zain Abbas", "Corporate", "Business Development Executive", "zain.abbas", 175000, "2024-10-07"],
];
const staff = {};
for (const [name, department, role, handle, salary, joinDate] of staffDefs) {
  staff[name] = await save("staff", {
    name, department, role, email: `${handle}@torix.example`, phone: "+92 3" + (10 + Math.floor(Math.random() * 40)) + " " + String(1000000 + Math.floor(Math.random() * 8999999)),
    joinDate, salary: (Math.round(salary * SALARY / 1000) * 1000).toFixed(2), currency: "PKR", salaryEffective: joinDate, shiftId: dayShift, status: "Active",
  });
}
const S = (n) => staff[n];

/* ---------- 4. clients, vendors ---------- */
const clientDefs = [
  ["Northstar Clinics", "Dr. Nadia Khan", "nadia@northstar.example", "Marketing"],
  ["Harbor Medical Group", "James Cole", "james.cole@harbormed.example", "Medical Billing"],
  ["Lumen Retail", "Sara Malik", "sara@lumenretail.example", "Development"],
  ["Crescent Dental Care", "Dr. Omar Farooq", "omar@crescentdental.example", "Marketing"],
  ["Pinecrest Family Practice", "Linda Marsh", "linda@pinecrestfp.example", "Medical Billing"],
  ["Skyline Logistics", "Tariq Mehmood", "tariq@skylinelogistics.example", "Development"],
  ["Greenleaf Pharmacy", "Ayesha Siddiq", "ayesha@greenleafrx.example", "Marketing"],
  ["Riverside Orthopedics", "Dr. Mark Ellison", "mellison@riversideortho.example", "Medical Billing"],
  ["Falcon Foods", "Kamran Shah", "kamran@falconfoods.example", "Marketing"],
  ["Meridian Health Network", "Priya Raman", "praman@meridianhn.example", "Medical Billing"],
  ["Bluewave Fintech", "Adeel Raza", "adeel@bluewave.example", "Development"],
  ["Torix Internal", "Hira Baig", "hira.baig@torix.example", "Corporate"],
];
const client = {};
for (const [name, contact, em, department] of clientDefs) {
  client[name] = await save("client", { name, contact, email: em, phone: "+92 21 3" + String(1000000 + Math.floor(Math.random() * 8999999)), department, status: "Active" });
}
const C = (n) => client[n];

const vendorDefs = [
  ["Amazon Web Services", "Cloud hosting", "billing@aws.example", "Monthly, card on file"],
  ["Google Workspace", "Email & collaboration", "billing@google-ws.example", "Monthly subscription"],
  ["Meta Ads (client media)", "Advertising platform", "ads@meta.example", "Prepaid ad credit"],
  ["PTCL Business", "Internet connectivity", "corporate@ptcl.example", "Payment within 10 days"],
  ["K-Electric", "Electricity", "bills@ke.example", "Payment within 15 days"],
  ["Clifton Business Center", "Office rent", "rent@cliftonbc.example", "Due on the 1st"],
];
const vendor = {};
for (const [name, service, em, terms] of vendorDefs) vendor[name] = await save("vendor", { name, service, email: em, terms, contact: "Accounts desk" });

/* ---------- 5. sales pipeline ---------- */
const leadDefs = [
  ["City Dental outreach", "Marketing", "Qualified", "Referral", 2500000, 5], ["Metro Clinic Karachi", "Marketing", "Proposal sent", "Website", 3200000, 3],
  ["Apex Physiotherapy", "Medical Billing", "Negotiation", "Outreach", 1800000, 2], ["Sunrise Pediatrics", "Medical Billing", "Contacted", "Ads", 1400000, 6],
  ["Orion Software House", "Development", "New", "Website", 6500000, 7], ["Zenith Textile Mills", "Development", "Qualified", "Referral", 9000000, 4],
  ["Healthy Bites Cafe", "Marketing", "New", "Social media", 650000, 8], ["Alpha Care Urgent Clinic", "Medical Billing", "Won", "Referral", 2100000, -10],
  ["Quick Mart Chain", "Marketing", "Lost", "Ads", 1500000, -20], ["Nova Telehealth", "Development", "Proposal sent", "Outreach", 7800000, 1],
  ["Prime Eye Hospital", "Medical Billing", "Qualified", "Tender", 4800000, 5], ["Lakeview Dermatology", "Medical Billing", "Contacted", "Website", 1200000, 9],
  ["Gulf Trading Co.", "Development", "Negotiation", "Referral", 5200000, 2], ["Bright Smiles Dental", "Marketing", "Proposal sent", "Social media", 900000, 4],
  ["Zameen Realty Partners", "Marketing", "New", "Ads", 1750000, 10], ["Medix Labs", "Medical Billing", "Contacted", "Outreach", 2300000, 6],
  ["EduSpark Academy", "Development", "Qualified", "Website", 3900000, 7], ["Karachi Heart Institute", "Medical Billing", "Won", "Tender", 8800000, -5],
  ["FreshCart Grocers", "Development", "Lost", "Website", 4100000, -14], ["Pearl Wellness Spa", "Marketing", "Negotiation", "Referral", 1100000, 3],
  ["Titan Auto Parts", "Marketing", "New", "Website", 800000, 12], ["Unity Medical Center", "Medical Billing", "Proposal sent", "Referral", 3600000, 2],
  ["Cloudnine Logistics", "Development", "Contacted", "Outreach", 5600000, 8], ["Radiant Skin Clinic", "Marketing", "Qualified", "Ads", 1350000, 5],
];
const owners = ["Zain Abbas", "Aisha Rahman", "Bilal Ahmed", "Zain Abbas"];
for (const [i, [name, department, stage, source, value, follow]] of leadDefs.entries()) {
  await save("lead", {
    name, contact: ["Ali Raza", "Maria Gill", "Dr. Hasan", "Nida Aslam"][i % 4], email: `contact@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
    department, salesOwner: S(owners[i % owners.length]), source, stage, value: value.toFixed(2), currency: "PKR", nextFollowup: day(follow),
    note: stage === "Lost" ? "Went with an in-house hire." : "Discovery call completed; sending next steps.",
  });
}

const proposalDefs = [
  ["Crescent Dental - 6 month SEO & ads", "Crescent Dental Care", "Marketing", 1800000, "Draft", 14], ["Greenleaf Pharmacy - social media management", "Greenleaf Pharmacy", "Marketing", 960000, "Submitted", 10],
  ["Riverside Orthopedics - billing outsourcing", "Riverside Orthopedics", "Medical Billing", 4200000, "Accepted", -6], ["Bluewave Fintech - customer portal", "Bluewave Fintech", "Development", 12500000, "Submitted", 21],
  ["Falcon Foods - ramadan campaign", "Falcon Foods", "Marketing", 2400000, "Rejected", -12], ["Meridian Health - denial management", "Meridian Health Network", "Medical Billing", 5400000, "Submitted", 7],
];
const proposal = [];
for (const [name, cl, department, amount, status, valid] of proposalDefs) {
  const id = await save("proposal", { name, clientId: C(cl), department, scope: "Detailed scope, deliverables and timeline as discussed on the discovery call.", amount: amount.toFixed(2), currency: "PKR", validUntil: day(valid), paymentTerms: "50% advance, 50% on delivery.", status: status === "Submitted" ? "Submitted" : "Draft" });
  proposal.push(id);
  if (status === "Accepted") await move(id, "approve", { note: "Signed acceptance email received from client." });
  if (status === "Rejected") await move(id, "reject", { note: "Client confirmed budget was not approved." });
}

const tenderDefs = [
  ["Provincial Health Dept - claims processing", "Sindh Health Department", "Medical Billing", 18500000, "Preparing", 18], ["Karachi Port Trust - asset portal", "Karachi Port Trust", "Development", 22000000, "Review", 30],
  ["NADRA e-forms revamp", "Government e-services", "Development", 9800000, "Submitted", 5], ["Aga Khan Univ. - digital campaign", "Healthcare institution", "Marketing", 6400000, "Evaluation", -3],
  ["PIA clinics - AR cleanup", "Aviation health unit", "Medical Billing", 7200000, "Won", -25],
];
for (const [name, organization, department, amount, status, dl] of tenderDefs) {
  await save("tender", { name, organization, department, deadline: day(dl), amount: amount.toFixed(2), currency: "PKR", assignee: S("Zain Abbas"), checklist: "Company profile\nTax certificates\nTechnical proposal\nFinancial bid", eligibility: "Registered with FBR and SECP; 3 similar projects.", status, note: "" });
}

/* ---------- 6. orders, contracts, delivery ---------- */
const orderDefs = [
  ["Northstar growth retainer", "Northstar Clinics", "Marketing", 450000, "Monthly retainer", -60, 120, "Active"],
  ["Harbor AR recovery", "Harbor Medical Group", "Medical Billing", 12000, "Fixed project", -45, 45, "Active", "USD"],
  ["Lumen booking portal", "Lumen Retail", "Development", 850000, "Milestone based", -75, 40, "Active"],
  ["Pinecrest claims outsourcing", "Pinecrest Family Practice", "Medical Billing", 600000, "Monthly retainer", -90, 90, "Active"],
  ["Skyline fleet dashboard", "Skyline Logistics", "Development", 1100000, "Milestone based", -30, 90, "Active"],
  ["Greenleaf social campaign", "Greenleaf Pharmacy", "Marketing", 240000, "Fixed project", -20, 40, "Active"],
  ["Riverside billing outsourcing", "Riverside Orthopedics", "Medical Billing", 420000, "Monthly retainer", -5, 360, "Active"],
  ["Bluewave KYC module", "Bluewave Fintech", "Development", 780000, "Fixed project", -120, -10, "Completed"],
  ["Falcon Foods brand refresh", "Falcon Foods", "Marketing", 310000, "Fixed project", -100, -30, "Completed"],
  ["Meridian denial analytics", "Meridian Health Network", "Medical Billing", 520000, "Fixed project", 3, 75, "Draft"],
];
const order = {};
for (const [name, cl, department, amount, model, start, end, status, currency = "PKR"] of orderDefs) {
  order[name] = await save("order", {
    name, clientId: C(cl), department, amount: (amount * K).toFixed(2), currency, model, date: day(start), due: day(end),
    scope: `Agreed deliverables for ${name}, including reporting and a named owner.`, paymentTerms: "Net 14 days from invoice.", acceptance: "Written client sign-off.", status,
  });
}
const O = (n) => order[n];

await save("contract", { name: "Northstar monthly retainer", orderId: O("Northstar growth retainer"), frequency: "Monthly", amount: (150000 * K).toFixed(2), currency: "PKR", nextDate: day(5), dueDays: 14, tasks: "Monthly performance report\nContent calendar\nAd optimisation", feeBasis: "Fixed fee", status: "Draft" });
await save("contract", { name: "Pinecrest claims retainer", orderId: O("Pinecrest claims outsourcing"), frequency: "Monthly", amount: (200000 * K).toFixed(2), currency: "PKR", nextDate: day(12), dueDays: 14, tasks: "Weekly claims submission\nDenial follow-up", feeBasis: "Fixed fee", status: "Draft" });
await save("contract", { name: "Riverside billing retainer", orderId: O("Riverside billing outsourcing"), frequency: "Monthly", amount: (140000 * K).toFixed(2), currency: "PKR", nextDate: day(25), dueDays: 14, tasks: "Charge entry\nPayment posting", feeBasis: "Fixed fee", status: "Draft" });
await save("amendment", { name: "Skyline - add driver mobile app", orderId: O("Skyline fleet dashboard"), amount: (1400000 * K).toFixed(2), scope: "Original dashboard plus Android driver app.", reason: "Client request by email on " + day(-4) });

const taskDefs = [
  ["Ship October campaign report", "Northstar growth retainer", "Aisha Rahman", 4, "High", "In progress"], ["Refresh landing page creatives", "Northstar growth retainer", "Mehwish Ali", 6, "Normal", "To do"],
  ["Optimise Meta lead-gen ad sets", "Northstar growth retainer", "Hamza Siddiqui", 2, "Urgent", "In progress"], ["Clear aged denials batch", "Harbor AR recovery", "Bilal Ahmed", 0, "Urgent", "In review"],
  ["Resubmit 90+ day claims", "Harbor AR recovery", "Rabia Noor", 3, "High", "In progress"], ["Payer follow-up calls (week 44)", "Harbor AR recovery", "Usman Tariq", 5, "Normal", "To do"],
  ["Finish booking calendar API", "Lumen booking portal", "Sara Hussain", 5, "High", "In progress"], ["Booking UI - mobile layout", "Lumen booking portal", "Daniyal Khan", 8, "Normal", "In progress"],
  ["Regression pass for checkout", "Lumen booking portal", "Fatima Zahra", 9, "Normal", "To do"], ["Set up staging pipeline", "Lumen booking portal", "Imran Qureshi", -2, "High", "Done"],
  ["Monthly claims audit", "Pinecrest claims outsourcing", "Rabia Noor", 7, "Normal", "To do"], ["Eligibility verification backlog", "Pinecrest claims outsourcing", "Usman Tariq", 1, "High", "Waiting"],
  ["Telemetry ingestion service", "Skyline fleet dashboard", "Sara Hussain", 14, "High", "In progress"], ["Dashboard map widgets", "Skyline fleet dashboard", "Daniyal Khan", 12, "Normal", "To do"],
  ["Load test fleet API", "Skyline fleet dashboard", "Fatima Zahra", 16, "Normal", "To do"], ["Infra cost review", "Skyline fleet dashboard", "Imran Qureshi", 10, "Normal", "To do"],
  ["Pharmacy promo reels (x6)", "Greenleaf social campaign", "Mehwish Ali", 3, "High", "In progress"], ["Schedule posts for November", "Greenleaf social campaign", "Hamza Siddiqui", 8, "Normal", "To do"],
  ["Onboard Riverside billing systems", "Riverside billing outsourcing", "Bilal Ahmed", 6, "High", "In progress"], ["Import Riverside fee schedules", "Riverside billing outsourcing", "Rabia Noor", 4, "Normal", "In progress"],
  ["KYC module handover docs", "Bluewave KYC module", "Sara Hussain", -12, "Normal", "Done"], ["Production deploy sign-off", "Bluewave KYC module", "Imran Qureshi", -10, "High", "Done"],
  ["Brand guideline PDF", "Falcon Foods brand refresh", "Aisha Rahman", -32, "Normal", "Done"], ["Packaging mock-ups", "Falcon Foods brand refresh", "Mehwish Ali", -35, "Normal", "Done"],
  ["Denial analytics data model", "Meridian denial analytics", "Bilal Ahmed", 14, "Normal", "To do"], ["Kick-off workshop agenda", "Meridian denial analytics", "Zain Abbas", 4, "Normal", "To do"],
  ["Weekly leadership report", "Northstar growth retainer", "Hira Baig", 3, "Normal", "In progress"], ["Q4 vendor renewal review", "Pinecrest claims outsourcing", "Hira Baig", 11, "Normal", "To do"],
  ["Website accessibility audit", "Lumen booking portal", "Fatima Zahra", -3, "High", "In review"], ["Weekly KPI sync notes", "Northstar growth retainer", "Aisha Rahman", -1, "Normal", "Done"],
];
for (const [name, ord, who, due, priority, status] of taskDefs) {
  await save("task", { name, orderId: O(ord), assignee: S(who), due: day(due), priority, status });
}

const msDefs = [
  ["Discovery & wireframes", "Lumen booking portal", "Sara Hussain", -50, 200000, "Accepted"], ["Booking engine alpha", "Lumen booking portal", "Sara Hussain", -15, 250000, "Accepted"],
  ["Payments & launch", "Lumen booking portal", "Daniyal Khan", 30, 400000, "In progress"], ["Telemetry MVP", "Skyline fleet dashboard", "Sara Hussain", 20, 350000, "In progress"],
  ["Dashboard beta", "Skyline fleet dashboard", "Daniyal Khan", 50, 450000, "Planned"], ["Go-live", "Skyline fleet dashboard", "Imran Qureshi", 85, 300000, "Planned"],
];
for (const [name, ord, who, due, amt, status] of msDefs) {
  const id = await save("milestone", { name, orderId: O(ord), assignee: S(who), due: day(due), amount: (amt * K).toFixed(2), criteria: "Demonstrated to client and signed off in writing.", status: status === "Accepted" ? "Submitted" : status });
  if (status === "Accepted") await move(id, "accept", { note: "Client sign-off email on file." });
}

const workDays = weekdays(8);
const logWho = ["Sara Hussain", "Daniyal Khan", "Rabia Noor", "Usman Tariq", "Aisha Rahman", "Hamza Siddiqui"];
const logOrd = ["Lumen booking portal", "Lumen booking portal", "Harbor AR recovery", "Pinecrest claims outsourcing", "Northstar growth retainer", "Northstar growth retainer"];
for (const [i, dt] of workDays.entries()) {
  for (const k of [i % 6, (i + 2) % 6]) {
    await save("worklog", { name: "Delivery work", employeeId: S(logWho[k]), orderId: O(logOrd[k]), date: dt, minutes: 360 + ((i * 30 + k * 15) % 120), status: "Submitted" });
  }
}

/* ---------- 7. attendance, leave ---------- */
const attendees = ["Aisha Rahman", "Bilal Ahmed", "Sara Hussain", "Daniyal Khan", "Rabia Noor", "Hira Baig"];
for (const dt of weekdays(10)) {
  for (const [i, n] of attendees.entries()) {
    const late = (dt.charCodeAt(9) + i) % 5 === 0 ? 20 : 0;
    const inMin = 9 * 60 + 3 + late + (i % 3) * 4;
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    await save("attendance", { employeeId: S(n), shiftId: dayShift, date: dt, clockIn: `${dt}T${hh(inMin)}`, clockOut: `${dt}T${hh(18 * 60 + 5 + i * 3)}`, breakMinutes: 60, status: "Draft" });
  }
}
for (const n of Object.keys(staff)) {
  await save("allowance", { employeeId: S(n), type: "Annual", year: karachiToday.slice(0, 4), days: 14, note: "Standard annual entitlement" });
  await save("allowance", { employeeId: S(n), type: "Sick", year: karachiToday.slice(0, 4), days: 8, note: "Standard sick entitlement" });
}
const leaveDefs = [
  ["Aisha Rahman", "Annual", 10, 12, "Family wedding", "Submitted"], ["Rabia Noor", "Sick", -4, -3, "Flu, doctor's note attached", "Approved"],
  ["Daniyal Khan", "Casual", 3, 3, "Passport renewal", "Submitted"], ["Mehwish Ali", "Annual", 20, 26, "Umrah trip", "Submitted"],
  ["Imran Qureshi", "Annual", -15, -12, "Family trip", "Approved"], ["Usman Tariq", "Unpaid", 6, 7, "Personal matter", "Draft"],
];
for (const [n, type, from, to, reason, status] of leaveDefs) {
  const id = await save("leave", { employeeId: S(n), type, start: day(from), end: day(to), reason });
  if (status === "Approved") await move(id, "approve");
}

/* ---------- 8. finance ---------- */
await post("capital", { amount: "5000000.00", date: day(-110), accountId: bankPkr, person: "Owner", department: "Corporate", note: "Opening owner capital" }, "owner capital");

const invDefs = [
  // client, order, net, issue offset, status path, collect fraction
  ["Northstar Clinics", "Northstar growth retainer", 150000, -62, "paid"], ["Northstar Clinics", "Northstar growth retainer", 150000, -32, "paid"], ["Northstar Clinics", "Northstar growth retainer", 150000, -3, "issued"],
  ["Pinecrest Family Practice", "Pinecrest claims outsourcing", 200000, -61, "paid"], ["Pinecrest Family Practice", "Pinecrest claims outsourcing", 200000, -31, "partial"], ["Pinecrest Family Practice", "Pinecrest claims outsourcing", 200000, -2, "issued"],
  ["Lumen Retail", "Lumen booking portal", 200000, -50, "paid"], ["Lumen Retail", "Lumen booking portal", 250000, -15, "overdue"],
  ["Greenleaf Pharmacy", "Greenleaf social campaign", 120000, -18, "partial"], ["Skyline Logistics", "Skyline fleet dashboard", 350000, -25, "overdue"],
  ["Bluewave Fintech", "Bluewave KYC module", 780000, -100, "paid"], ["Falcon Foods", "Falcon Foods brand refresh", 310000, -95, "paid"],
  ["Riverside Orthopedics", "Riverside billing outsourcing", 140000, -4, "approved"], ["Greenleaf Pharmacy", "Greenleaf social campaign", 120000, 0, "draft"],
];
for (const [cl, ord, net, off, path] of invDefs) {
  const id = await save("invoice", {
    clientId: C(cl), currency: "PKR", rate: 1, date: day(off), due: day(off + 14),
    lines: [{ orderId: O(ord), description: `${ord} - service invoice`, net: (net * K).toFixed(2), taxPercent: 0 }],
  }, `invoice ${cl}`);
  if (path === "draft") continue;
  await move(id, "submit"); await move(id, "approve");
  if (path === "approved") continue;
  await move(id, "issue");
  if (path === "issued" || path === "overdue") { await move(id, "earn", { lineId: state.records.find((r) => r.id === id)?.data.lines?.[0]?.id, orderId: O(ord), amount: (net * K).toFixed(2), date: day(off + 1) }); continue; }
  await move(id, "earn", { lineId: state.records.find((r) => r.id === id)?.data.lines?.[0]?.id, orderId: O(ord), amount: (net * K).toFixed(2), date: day(off + 1) });
  const amount = path === "partial" ? (net * K * 0.5).toFixed(2) : (net * K).toFixed(2);
  await move(id, "receive", { amount, date: day(off + 10), accountId: bankPkr }, `collect ${cl}`);
}
// some client advances and an advertising deposit for realism
await post("client_advance", { clientId: C("Falcon Foods"), amount: "150000.00", date: day(-9), accountId: bankPkr, note: "Advance for Q1 campaign" }, "client advance");

const expDefs = [
  ["AWS hosting - monthly", "Development", 142000, -20, "Software", "Amazon Web Services", "Company"], ["Google Workspace seats", "Corporate", 38000, -18, "Software", "Google Workspace", "Company"],
  ["Office rent - this month", "Corporate", 280000, -26, "Rent", "Clifton Business Center", "Company"], ["Electricity bill", "Corporate", 64000, -15, "Utilities", "K-Electric", "Company"],
  ["Internet - PTCL fibre", "Corporate", 22000, -14, "Utilities", "PTCL Business", "Company"], ["Client lunch - Harbor review", "Medical Billing", 9500, -11, "Travel", null, "Owner"],
  ["Meta ad credit (Northstar)", "Marketing", 180000, -9, "Other", "Meta Ads (client media)", "Company"], ["Team offsite transport", "Corporate", 18000, -7, "Travel", null, "Owner"],
  ["Outsourced video editor", "Marketing", 45000, -6, "Outsourcing", null, "Company"], ["Conference registration", "Development", 52000, -5, "Other", null, "Company"],
];
for (const [name, department, amount, off, category, vend, paidBy] of expDefs) {
  const id = await save("expense", { name, department, amount: amount.toFixed(2), currency: "PKR", date: day(off), category, vendorId: vend ? vendor[vend] : undefined, paidBy, person: paidBy === "Owner" ? "Owner" : undefined, accountId: paidBy === "Company" ? bankPkr : undefined, treatment: "Expense", note: `Receipt ref EXP-${Math.abs(off)}${name.length}` });
  await move(id, "submit"); await move(id, "approve"); await move(id, "post");
}

const billDefs = [
  ["AWS invoice (October)", "Amazon Web Services", "Development", 150000, -12, 14], ["PTCL leased line", "PTCL Business", "Corporate", 48000, -8, 6],
  ["Clifton Business Center - parking & maintenance", "Clifton Business Center", "Corporate", 35000, -3, 12], ["Google Workspace - annual add-on", "Google Workspace", "Corporate", 96000, -1, 20],
];
for (const [name, vend, department, amount, off, dueIn] of billDefs) {
  const id = await save("bill", { name, vendorId: vendor[vend], department, amount: amount.toFixed(2), currency: "PKR", date: day(off), due: day(off + dueIn), treatment: "Expense", note: `Vendor ref ${name.slice(0, 3).toUpperCase()}-${Math.abs(off)}01` });
  await move(id, "submit"); await move(id, "approve"); await move(id, "post");
  if (off < -5) await move(id, "pay", { amount: amount.toFixed(2), date: day(off + 4), accountId: bankPkr }, `pay bill ${name}`);
}

await save("subscription", { name: "Google Workspace (12 seats)", vendorId: vendor["Google Workspace"], department: "Corporate", amount: "38000.00", currency: "PKR", frequency: "Monthly", nextDate: day(9), remindDays: 7, status: "Active" });
await save("subscription", { name: "AWS Business Support", vendorId: vendor["Amazon Web Services"], department: "Development", amount: "29000.00", currency: "PKR", frequency: "Monthly", nextDate: day(16), remindDays: 7, status: "Active" });
await save("subscription", { name: "Figma Organisation", vendorId: vendor["Google Workspace"], department: "Marketing", amount: "21000.00", currency: "PKR", frequency: "Monthly", nextDate: day(4), remindDays: 5, status: "Active" });
await save("subscription", { name: "Domain portfolio (annual)", vendorId: vendor["Amazon Web Services"], department: "Corporate", amount: "42000.00", currency: "PKR", frequency: "Annual", nextDate: day(70), remindDays: 30, status: "Active" });

const assetDefs = [
  ["MacBook Pro 14\" M3", "TX-LAP-001", "Sara Hussain", 620000, "Good"], ["MacBook Air 13\"", "TX-LAP-002", "Daniyal Khan", 380000, "Good"], ["Dell Latitude 7440", "TX-LAP-003", "Bilal Ahmed", 310000, "Good"],
  ["Dell Latitude 5440", "TX-LAP-004", "Rabia Noor", 240000, "New"], ["Dell 27\" monitor x2", "TX-MON-005", "Hamza Siddiqui", 85000, "Good"], ["Canon EOS R7 camera kit", "TX-CAM-006", "Mehwish Ali", 410000, "Good"],
];
for (const [name, serial, who, amt, condition] of assetDefs) {
  await save("asset", { name, serial, employeeId: S(who), department: staffDefs.find((s) => s[0] === who)[1], amount: amt.toFixed(2), currency: "PKR", purchaseDate: day(-200), handover: day(-195), condition, warranty: day(520), note: "Purchased via Corporate account" });
}

/* ---------- 9. payroll (previous month) ---------- */
{
  const m = monthOf(-30);
  const { created } = await call("payroll", { action: "save", kind: "payroll", data: { month: m } });
  const p = created.find((r) => r.kind === "payroll");
  if (p) { await move(p.id, "submit"); await move(p.id, "approve"); await move(p.id, "post"); }
}

/* ---------- report ---------- */
const kinds = {};
for (const r of state.records) if (!r.archived) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
console.log("Seeded records:", JSON.stringify(kinds));
console.log(`Finance events: ${state.events?.length ?? 0}`);
if (failures.length) {
  console.log(`\n${failures.length} step(s) rejected by the server:`);
  for (const f of failures) console.log(" -", f);
  process.exitCode = process.env.SEED_STRICT ? 1 : 0;
}
