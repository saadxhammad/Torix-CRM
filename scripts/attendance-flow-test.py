# -*- coding: utf-8 -*-
"""Full Attendance module UI workflow with screenshots."""
import json
import os
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

base = os.environ.get("BASE_URL", "https://torix-crm-gamma.vercel.app").rstrip("/")
email = os.environ.get("TORIX_OWNER_EMAIL", "torix.dev12@gmail.com")
password = os.environ.get("TORIX_OWNER_PASSWORD", "torix@dev12@")
out = Path(__file__).resolve().parent.parent / "smoke-screenshots" / "attendance-flow"
out.mkdir(parents=True, exist_ok=True)
log = []


def step(n, msg):
    line = f"{n}. {msg}"
    log.append(line)
    print(line, flush=True)


def api(cookie, body):
    payload = {**body, "mode": "live", "requestId": str(uuid.uuid4())}
    req = urllib.request.Request(
        base + "/api/workspace",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Cookie": cookie, "Origin": base},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{e.code} {err}") from e


def get_ws(cookie):
    req = urllib.request.Request(base + "/api/workspace?mode=live", headers={"Cookie": cookie})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 1000})
        page = context.new_page()

        step(1, "Open login page")
        page.goto(base + "/login", wait_until="networkidle", timeout=90000)
        page.screenshot(path=str(out / "01-login.png"), full_page=True)
        print("  → 01-login.png", flush=True)

        step(2, "Sign in as owner")
        page.fill('input[type="email"]', email)
        page.fill('input[type="password"]', password)
        page.click('button[type="submit"]')
        page.wait_for_timeout(8000)
        page.screenshot(path=str(out / "02-dashboard.png"), full_page=True)
        print("  → 02-dashboard.png", flush=True)

        cookie = "; ".join(f"{c['name']}={c['value']}" for c in context.cookies())

        step(3, "Ensure shift + staff profile")
        ws = get_ws(cookie)
        shift = next((r for r in ws.get("records", []) if r["kind"] == "shift" and not r.get("archived")), None)
        if not shift:
            ws = api(
                cookie,
                {
                    "action": "save",
                    "kind": "shift",
                    "data": {
                        "name": "Evening shift",
                        "startTime": "18:00",
                        "endTime": "02:00",
                        "breakMinutes": 30,
                        "graceMinutes": 15,
                        "paidBreaks": False,
                        "allowMultipleBreaks": True,
                    },
                },
            )
            shift = next(r for r in ws["records"] if r["kind"] == "shift" and r["data"].get("name") == "Evening shift")

        staff = next(
            (
                r
                for r in ws.get("records", [])
                if r["kind"] == "staff" and not r.get("archived") and r["data"].get("email") == email
            ),
            None,
        )
        if not staff:
            staff = next((r for r in ws.get("records", []) if r["kind"] == "staff" and not r.get("archived")), None)
        if not staff:
            ws = api(
                cookie,
                {
                    "action": "save",
                    "kind": "staff",
                    "data": {
                        "name": "Torix Owner",
                        "email": email,
                        "department": "Corporate",
                        "role": "Owner",
                        "status": "Active",
                        "shiftId": shift["id"],
                        "salary": "0",
                        "currency": "PKR",
                    },
                },
            )
            staff = next(r for r in ws["records"] if r["kind"] == "staff" and r["data"].get("email") == email)
        elif not staff["data"].get("shiftId"):
            ws = api(
                cookie,
                {
                    "action": "save",
                    "kind": "staff",
                    "id": staff["id"],
                    "data": {
                        **{k: v for k, v in staff["data"].items() if k not in ("salaryHistory",)},
                        "shiftId": shift["id"],
                        "name": staff["data"]["name"],
                        "department": staff["data"]["department"],
                        "status": staff["data"].get("status") or "Active",
                        "salary": staff["data"].get("salary") or 0,
                    },
                },
            )
            staff = next(r for r in ws["records"] if r["id"] == staff["id"])
        print(f"  staff={staff['id']} shift={shift['id']}", flush=True)

        for open_sess in [
            r
            for r in ws.get("records", [])
            if r["kind"] == "attendance"
            and r["data"].get("employeeId") == staff["id"]
            and r["data"].get("status") == "In progress"
        ]:
            try:
                # end break if needed then clock out
                events = open_sess["data"].get("events") or []
                last = events[-1]["type"] if events else ""
                if last == "break_start":
                    api(cookie, {"action": "break_end", "id": open_sess["id"]})
                api(cookie, {"action": "clock_out", "id": open_sess["id"]})
                print(f"  closed prior session {open_sess['id'][:8]}", flush=True)
            except Exception as e:
                print(f"  close prior note: {e}", flush=True)

        step(4, "Open Attendance page")
        page.goto(base + "/#/attendance", wait_until="networkidle")
        page.wait_for_timeout(4000)
        page.screenshot(path=str(out / "03-attendance-list.png"), full_page=True)
        print("  → 03-attendance-list.png", flush=True)

        step(5, "Clock in")
        ws = api(cookie, {"action": "clock_in", "data": {"employeeId": staff["id"], "shiftId": shift["id"]}})
        session = next(
            r
            for r in ws["records"]
            if r["kind"] == "attendance"
            and r["data"].get("employeeId") == staff["id"]
            and r["data"].get("status") == "In progress"
        )
        print(
            f"  session={session['id']} state={session['data'].get('state')} late={session['data'].get('lateMinutes')} events={session['data'].get('events')}",
            flush=True,
        )
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "04-clocked-in-working.png"), full_page=True)
        print("  → 04-clocked-in-working.png", flush=True)

        step(6, "Start break")
        api(cookie, {"action": "break_start", "id": session["id"]})
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "05-on-break.png"), full_page=True)
        print("  → 05-on-break.png", flush=True)

        step(7, "End break")
        api(cookie, {"action": "break_end", "id": session["id"]})
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "06-back-to-working.png"), full_page=True)
        print("  → 06-back-to-working.png", flush=True)

        step(8, "Clock out")
        api(cookie, {"action": "clock_out", "id": session["id"]})
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "07-clocked-out-submitted.png"), full_page=True)
        print("  → 07-clocked-out-submitted.png", flush=True)

        ws = get_ws(cookie)
        done = next(r for r in ws["records"] if r["id"] == session["id"])
        step(
            9,
            f"Verify session status={done['data'].get('status')} worked={done['data'].get('workedMinutes')}m "
            f"break={done['data'].get('breakMinutes')}m late={done['data'].get('lateMinutes')}m "
            f"class={done['data'].get('classification')} events={[e.get('type') for e in done['data'].get('events') or []]}",
        )
        page.screenshot(path=str(out / "08-attendance-history.png"), full_page=True)
        print("  → 08-attendance-history.png", flush=True)

        step(10, "Leave grants")
        grant = next(
            (r for r in ws["records"] if r["kind"] == "leavegrant" and r["data"].get("employeeId") == staff["id"]),
            None,
        )
        if not grant:
            year = time.strftime("%Y")
            api(
                cookie,
                {
                    "action": "save",
                    "kind": "leavegrant",
                    "data": {
                        "employeeId": staff["id"],
                        "type": "Annual",
                        "amount": 10,
                        "effectiveDate": f"{year}-01-01",
                        "expiryDate": f"{year}-12-31",
                        "reason": "Flow test annual grant",
                    },
                },
            )
        page.goto(base + "/#/leave-grants", wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "09-leave-grants.png"), full_page=True)
        print("  → 09-leave-grants.png", flush=True)

        step(11, "Submit leave request (half day)")
        tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
        try:
            api(
                cookie,
                {
                    "action": "save",
                    "kind": "leave",
                    "data": {
                        "employeeId": staff["id"],
                        "type": "Annual",
                        "unit": "half",
                        "start": tomorrow,
                        "end": tomorrow,
                        "halfDay": True,
                        "reason": "Attendance flow test half-day leave",
                    },
                },
            )
        except Exception as e:
            print(f"  leave note: {e}", flush=True)
        page.goto(base + "/#/leave", wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "10-leave-request.png"), full_page=True)
        print("  → 10-leave-request.png", flush=True)

        step(12, "Approvals inbox")
        page.goto(base + "/#/approvals", wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "11-approvals.png"), full_page=True)
        print("  → 11-approvals.png", flush=True)

        step(13, "Leave ledger")
        page.goto(base + "/#/leave-ledger", wait_until="networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "12-leave-ledger.png"), full_page=True)
        print("  → 12-leave-ledger.png", flush=True)

        step(14, "People CSV export")
        req = urllib.request.Request(
            base + "/api/people-export?type=attendance&mode=live", headers={"Cookie": cookie}
        )
        with urllib.request.urlopen(req, timeout=90) as r:
            csv = r.read().decode("utf-8")
        (out / "13-attendance-export.csv").write_text(csv, encoding="utf-8")
        print(f"  CSV lines={len(csv.splitlines())}", flush=True)

        step(15, "Team page")
        page.goto(base + "/#/team", wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(out / "14-team.png"), full_page=True)
        print("  → 14-team.png", flush=True)

        step(16, "Shifts page")
        page.goto(base + "/#/shifts", wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(out / "15-shifts.png"), full_page=True)
        print("  → 15-shifts.png", flush=True)

        # Late conversion if late
        if done["data"].get("lateMinutes", 0) > 0 and not done["data"].get("lateConverted"):
            step(17, "Convert late entry to short leave")
            try:
                api(
                    cookie,
                    {
                        "action": "convert_late",
                        "data": {"ids": [done["id"]], "reason": "Flow test late conversion"},
                    },
                )
                page.goto(base + "/#/attendance", wait_until="networkidle")
                page.wait_for_timeout(2500)
                page.screenshot(path=str(out / "16-late-converted.png"), full_page=True)
                print("  → 16-late-converted.png", flush=True)
            except Exception as e:
                print(f"  convert_late note: {e}", flush=True)
                step(17, f"Late conversion skipped: {e}")
        else:
            step(17, "Late conversion N/A (not late or already converted)")

        (out / "FLOW-LOG.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
        browser.close()
        print("\nDone.", out, flush=True)
        print(
            "Session:",
            {
                "status": done["data"].get("status"),
                "state": done["data"].get("state"),
                "workedMinutes": done["data"].get("workedMinutes"),
                "breakMinutes": done["data"].get("breakMinutes"),
                "lateMinutes": done["data"].get("lateMinutes"),
                "classification": done["data"].get("classification"),
                "events": [e.get("type") for e in done["data"].get("events") or []],
            },
            flush=True,
        )


if __name__ == "__main__":
    main()
