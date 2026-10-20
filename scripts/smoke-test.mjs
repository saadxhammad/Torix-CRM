#!/usr/bin/env node
/**
 * End-to-end smoke test against a running Torix app (local or Vercel).
 *
 * Usage:
 *   BASE_URL=https://torix-crm-gamma.vercel.app \
 *   TORIX_OWNER_EMAIL=you@company.com \
 *   TORIX_OWNER_PASSWORD='your-password' \
 *   node scripts/smoke-test.mjs
 */
const base = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const email = process.env.TORIX_OWNER_EMAIL || "";
const password = process.env.TORIX_OWNER_PASSWORD || "";

const results = [];
function ok(name, detail = "") {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, pass: false, detail });
  console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
}

async function req(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (method === "POST" && cookie) headers.Origin = base;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  const setCookie = res.headers.getSetCookie?.() || [];
  return { res, text, json, setCookie };
}

function cookieJar(setCookie) {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`Smoke testing ${base}\n`);

  // Public
  {
    const { res } = await req("/login");
    res.status === 200 ? ok("GET /login", String(res.status)) : fail("GET /login", String(res.status));
  }
  {
    const { res, json } = await req("/api/workspace");
    res.status === 401 && json?.error
      ? ok("GET /api/workspace requires auth", json.error)
      : fail("GET /api/workspace requires auth", `${res.status} ${JSON.stringify(json)}`);
  }
  {
    const { res, json } = await req("/api/auth/login", { method: "POST", body: {} });
    res.status >= 400
      ? ok("POST /api/auth/login validates body", json?.error || String(res.status))
      : fail("POST /api/auth/login validates body", String(res.status));
  }

  if (!email || !password) {
    console.log("\nSkipped authenticated checks — set TORIX_OWNER_EMAIL and TORIX_OWNER_PASSWORD.\n");
    summarize();
    process.exit(results.some((r) => !r.pass) ? 1 : 0);
  }

  // Login
  let cookie = "";
  {
    const { res, json, setCookie } = await req("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    cookie = cookieJar(setCookie);
    if (res.ok && cookie.includes("torix_session")) ok("Owner login", email);
    else fail("Owner login", `${res.status} ${JSON.stringify(json)} cookie=${cookie.slice(0, 40)}`);
  }
  if (!cookie) {
    summarize();
    process.exit(1);
  }

  // Workspace load (may auto-seed)
  let workspace;
  {
    const { res, json } = await req("/api/workspace?mode=live&month=" + new Date().toISOString().slice(0, 7), {
      cookie,
    });
    if (res.ok && Array.isArray(json?.records)) {
      workspace = json;
      ok(
        "GET workspace",
        `${json.records.length} records, role=${json.access?.role}, financial=${json.financial}`,
      );
    } else fail("GET workspace", `${res.status} ${JSON.stringify(json)?.slice(0, 200)}`);
  }

  // Ensure seed data
  {
    const hasClients = workspace?.records?.some((r) => r.kind === "client" && !r.archived);
    if (!hasClients) {
      const { res, json } = await req("/api/workspace", {
        method: "POST",
        cookie,
        body: { action: "seed", mode: "live", requestId: crypto.randomUUID() },
      });
      if (res.ok && json?.records?.some((r) => r.kind === "client")) {
        workspace = json;
        ok("Seed sample data", `${json.records.filter((r) => r.kind === "client").length} clients`);
      } else fail("Seed sample data", `${res.status} ${JSON.stringify(json)?.slice(0, 300)}`);
    } else {
      ok("Seed sample data already present", `${workspace.records.filter((r) => r.kind === "client").length} clients`);
    }
  }

  const kinds = ["client", "staff", "order", "task", "lead", "invoice"];
  for (const kind of kinds) {
    const n = workspace?.records?.filter((r) => r.kind === kind && !r.archived).length || 0;
    n > 0 ? ok(`Has ${kind} records`, String(n)) : fail(`Has ${kind} records`, "0");
  }

  // Create a lead
  {
    const { res, json } = await req("/api/workspace", {
      method: "POST",
      cookie,
      body: {
        action: "save",
        kind: "lead",
        mode: "live",
        requestId: crypto.randomUUID(),
        data: {
          name: "Smoke Test Lead",
          contact: "Smoke Bot",
          email: "smoke@example.com",
          department: "Marketing",
          stage: "New",
          value: 1000000,
          currency: "PKR",
          nextFollowup: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          note: "Created by smoke-test.mjs",
        },
      },
    });
    const found = json?.records?.some((r) => r.kind === "lead" && r.data?.name === "Smoke Test Lead");
    res.ok && found ? ok("Create lead") : fail("Create lead", `${res.status} ${JSON.stringify(json)?.slice(0, 250)}`);
    if (res.ok) workspace = json;
  }

  // Reports
  {
    const month = new Date().toISOString().slice(0, 7);
    const { res, json } = await req(`/api/reports?mode=live&month=${month}&department=${encodeURIComponent("All departments")}`, {
      cookie,
    });
    res.ok && json?.totals
      ? ok("GET reports", `revenue=${json.totals.revenue}`)
      : fail("GET reports", `${res.status} ${JSON.stringify(json)?.slice(0, 200)}`);
  }

  // Print PDF invoice if any
  {
    const inv = workspace?.records?.find((r) => r.kind === "invoice" && !r.archived);
    if (inv) {
      const { res } = await req(`/api/print?type=invoice&mode=live&id=${inv.id}`, { cookie });
      const ct = res.headers.get("content-type") || "";
      res.ok && ct.includes("pdf")
        ? ok("PDF invoice print", ct)
        : fail("PDF invoice print", `${res.status} ${ct}`);
    } else fail("PDF invoice print", "no invoice");
  }

  // Home page authenticated redirect target
  {
    const { res } = await req("/", { cookie });
    [200, 307, 302].includes(res.status)
      ? ok("GET / with session", String(res.status))
      : fail("GET / with session", String(res.status));
  }

  summarize();
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

function summarize() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
