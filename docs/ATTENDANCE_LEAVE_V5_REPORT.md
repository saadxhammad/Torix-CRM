# Torix CRM — Attendance & Leave Spec v5 Work Report

**Date:** 29 October 2026  
**Production:** https://torix-crm-gamma.vercel.app  
**Scope:** Implement Attendance & Leave Management Spec v5 into the existing People modules (CRM upgrade path 1A + full v5 path 2B), then exhaustively prove every acceptance line.

---

## 1. Objective

Take the Torix Attendance & Leave Spec v5 and ship it as a working upgrade of the live CRM — not a separate product — then verify it end-to-end until acceptance criteria were proven, not assumed.

Policy defaults used (from the PDF):

| Policy | Default |
|--------|---------|
| Company timezone | Asia/Karachi |
| Grace period | 15 minutes (late reported, not auto-deducted) |
| Partial absence units | Quarter-day integers (short=1, half=2, full=4) |
| Partial threshold | 3 quarters → reconcile to 1 full day without double charge |
| Missed time | ≤2h = short; >2h = half-day |
| Leave grants | FIFO by earliest expiry; activate/expire on Karachi dates |
| Probation quota | 3 full-day equivalents for the probation window |

---

## 2. What was built

### 2.1 Event-based attendance

- Clock sequence: `clock_in` → `break_start` / `break_end` (repeatable) → `clock_out`
- Server-timestamped events; session state and worked/break minutes derived from events
- Live timer banner on Attendance (client ticks every second from saved events — no DB writes while waiting)
- Grace/late minutes stamped on clock-in; late is reported, not auto-converted to leave
- Admin **Convert late…** → `leaveledger` entry type `late_conversion`, idempotent

### 2.2 Partial absence ledger

- Continuous quarter-unit ledger across dates (no daily/monthly reset)
- Classification: present / short / half / full / exempt
- Three-quarter threshold reconciliation without double-charging
- Two half-days = one full day; full-day no-shows do not feed the partial pattern
- Admin classify path on submitted attendance

### 2.3 Leave grants, balances, FIFO

- New record kinds: `leavegrant`, `leaveledger` (legacy `allowance` retained)
- Grants: amount (days), effective date, optional expiry, reason, status (Scheduled / Active / Expired)
- Employee leave portal KPIs: available / used / pending / future / expiring
- On approve: FIFO consume earliest-expiring grant; refuse if insufficient balance
- Probation fields on Team (`probationStart` / `probationEnd`); available capped at 3 days while in probation
- Manual admin credit/debit with required reason + audit

### 2.4 Approvals and access

- No self-approve for managers (Owner exempt via `*`)
- Manager leave requires HR/Owner
- Department-scoped manager access; HR/Owner see all
- Reporting manager scope via `staff.managerId`

### 2.5 Reports, alerts, CSV

- In-app alerts: Approval, Late, Grant expiry (within 7 days)
- People CSV export: attendance, late, leave, balances, partial, grants  
  Route: `/api/people-export?type=…`

### 2.6 Key libraries / surfaces

| Area | Location |
|------|----------|
| Attendance events / timer | `lib/attendance.mjs` |
| Partial absence | `lib/partial-absence.mjs` |
| Grants / FIFO / probation | `lib/leave-balance.mjs` |
| Workspace actions | `lib/people-actions.ts`, `app/api/workspace/route.ts` |
| CSV export | `app/api/people-export/route.ts` |
| UI | `app/workspace.tsx`, modules/UI config updates |
| Unit tests | `tests/attendance-leave.test.mjs`, `tests/acceptance-v5.test.mjs` |
| Live E2E | `scripts/acceptance-v5-e2e.mjs` |

---

## 3. Bugs found and fixed during proof

These were the gaps that blocked “100% sure” until fixed and re-proven on production:

| Issue | Fix |
|-------|-----|
| Owner session always had empty `employeeId`, so live timer / leave balances never appeared for the owner account | `lib/server.ts` — Owner still has `*` caps, but `employeeId` is read from an optional `company_members` link |
| Leave grant **amount** rendered as money (e.g. Rs) | `app/workspace.tsx` `cell()` — leavegrant amounts show as `Nd` (days) |
| Live timer only showed values from last server load | Client-side 1s tick re-deriving from saved events via `deriveSession` |
| Break / clock-out could fail without `employeeId` in the request | `clockAction` resolves employee from the open attendance session |
| `liveAttendance` payload lacked `events`, so client tick had nothing to derive from when row match failed | Include `events` on `leaveBalances.liveAttendance` |

Redeployed to Vercel production after each blocking fix.

---

## 4. How it was tested

### 4.1 Unit / acceptance logic — **28/28 PASS**

`npx tsx --test tests/attendance-leave.test.mjs tests/acceptance-v5.test.mjs`

Covers:

- Event sequence + refresh-safe re-derive  
- Grace boundary (18:15 not late, 18:16 late)  
- Partial threshold, two halves, full-day isolation  
- FIFO grant consume, grant status by Karachi date  
- Probation cap (12 quarters)  
- Manager cannot self-approve; only HR/Owner approve manager leave  
- Department scope deny for unrelated dept  
- `convert_late` idempotency  
- Manual adjust requires `leave.admin` + reason  
- Grant save writes ledger credit when Active  

### 4.2 Live production E2E — **43/43 PASS**

`BASE_URL=https://torix-crm-gamma.vercel.app node scripts/acceptance-v5-e2e.mjs`

Run completed: **2026-10-29T16:39:46Z**  
Artifacts: `smoke-screenshots/acceptance-v5/`

| Artifact | Purpose |
|----------|---------|
| `REPORT.md` / `results.json` | Pass/fail matrix |
| `01-logged-in.png` … `04-leave-portal.png` | UI screenshots |
| `export-*.csv` | Live CSV export samples |

Highlights proven live:

- Full clock → break → refresh persistence → break end → clock out  
- Live banner **On Break**; client timer advanced **0m → 1m** with no API write  
- Owner linked to staff profile; leave balances + live attendance populated  
- Late recorded; not auto-deducted; admin convert + duplicate rejected  
- Grants (active + future), leave submit/approve, usage ledger, manual adjust  
- Probation fields, all six CSV types, settings defaults (15 / 3 / 3)  
- Grant UI shows days, not money  

Manager approval rules for a second human login were proven in the unit suite with synthetic HR / Department head / Staff contexts (this environment only has Owner credentials).

---

## 5. Spec §13 acceptance mapping

| Spec acceptance line | Proof |
|----------------------|-------|
| Clock-in/out and breaks correct after refresh | Live E2E `ac.refresh_persists`, full clock flow |
| 15-minute grace records late; no auto leave deduct | Unit grace boundary + live `lateMinutes` + `late_not_auto_deducted` |
| Partial absences accumulate; threshold without double charge | Unit threshold / two-halves / full-day tests |
| Full-day no-shows not double-counted as partial | Unit |
| Two half-days = one full day | Unit |
| Grants immediate/future + auditable expiry | Live grant create/future; unit expiry ledger |
| Portal shows current / used / pending / future / expiring | Live balance portal + Leave KPI UI |
| Managers have quota; only admins approve manager leave / change balance | Unit approval + access tests |
| Admins credit/debit with reason + audit | Live manual adjust + unit |
| Managers cannot access unrelated departments | Unit `recordAllowed` dept scope |
| Late convertible by admin; no duplicate charge | Live convert + idempotent reject |

---

## 6. Deployment

- Hosting: Vercel project **hammad-zubairy/torix-crm**  
- Alias: **torix-crm-gamma.vercel.app**  
- Data: Supabase-backed workspace (polymorphic records)  
- Multiple production deploys during the proof loop; final verified deploy exercised by the 43/43 E2E run above  

---

## 7. How to re-run proof

```bash
cd torix-app

# Logic + access rules
npx tsx --test tests/attendance-leave.test.mjs tests/acceptance-v5.test.mjs

# Live production acceptance (Owner credentials)
BASE_URL=https://torix-crm-gamma.vercel.app \
TORIX_OWNER_EMAIL='…' \
TORIX_OWNER_PASSWORD='…' \
node scripts/acceptance-v5-e2e.mjs
```

---

## 8. Outcome

Attendance & Leave Spec v5 is implemented in the live Torix CRM People modules and verified:

- **28/28** automated logic/acceptance tests  
- **43/43** live production E2E checks  
- Blocking UI/session bugs found during proof were fixed and redeployed before sign-off  

**Verdict:** Spec v5 acceptance criteria are met and evidenced on production as of the run above.

---

## 9. Employee portal + role route protection (follow-on)

| Role | Landing |
|------|---------|
| Staff (Employee) | `/portal` — Check-in / Checkout today, month grid, leave requests |
| HR / Owner (Admin) / others | `/` — existing CRM workspace |

- Middleware (`middleware.ts`) requires session for app/API routes; Staff cannot open `/`; non-Staff cannot open `/portal`.
- Session cookie now carries `role`; login returns `redirectTo`.
- Checkout still runs Spec v5 `classifyAndCharge` (¼ / ½ / full) and the portal surfaces the result.
- Prerequisite: Staff email must be linked to a `staff` profile in Users and roles.
