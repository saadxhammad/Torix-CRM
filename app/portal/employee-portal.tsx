"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  Coffee,
  KeyRound,
  LogOut,
  Plane,
  RefreshCw,
} from "lucide-react";
import { deriveSession } from "@/lib/attendance.mjs";

type Row = { id: string; kind: string; data: any; archived?: boolean };

type State = {
  records: Row[];
  access: { role: string; employeeId: string; caps: string[] };
  leaveBalances?: any;
  settings?: any;
};

const blank: State = {
  records: [],
  access: { role: "Staff", employeeId: "", caps: [] },
  leaveBalances: {},
};

const karachiDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

function fmtTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classificationLabel(att?: Row | null, leave?: Row | null) {
  if (leave && ["Approved", "Submitted", "Pending"].includes(leave.data.status)) {
    if (leave.data.status === "Approved") return { key: "leave", text: "On leave" };
    return { key: "leave-pending", text: "Leave pending" };
  }
  if (!att) return { key: "none", text: "—" };
  const c = String(att.data.classification || "");
  if (/short/i.test(c)) return { key: "short", text: "Short (¼)" };
  if (/half/i.test(c)) return { key: "half", text: "Half (½)" };
  if (/absent/i.test(c)) return { key: "absent", text: "Absent" };
  if (/present/i.test(c) || att.data.status === "Submitted" || att.data.status === "Approved") {
    return { key: "present", text: "Present" };
  }
  if (att.data.status === "In progress") return { key: "live", text: "In progress" };
  return { key: "other", text: c || att.data.status || "—" };
}

function classifyToast(att: any) {
  const c = String(att?.classification || "");
  if (/short/i.test(c)) return "Checked out — short absence (¼ day) recorded.";
  if (/half/i.test(c)) return "Checked out — half-day absence (½ day) recorded.";
  if (/absent/i.test(c)) return "Checked out — full-day absence recorded.";
  if (/present/i.test(c) || /exempt/i.test(c)) return "Checked out — marked present.";
  if (/exception/i.test(c)) return "Checked out — needs review (exception).";
  return "Checked out for today.";
}

export default function EmployeePortal({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const [state, setState] = useState<State>(blank);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"today" | "attendance" | "leave" | "password">("today");
  const [month, setMonth] = useState(karachiDate().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(karachiDate());
  const [tick, setTick] = useState(Date.now());
  const [leaveForm, setLeaveForm] = useState({
    type: "Annual",
    unit: "full",
    start: karachiDate(),
    end: karachiDate(),
    reason: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const load = useCallback(async () => {
    const r = await fetch("/api/workspace?mode=live", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not load.");
    setState({
      records: data.records || [],
      access: data.access || blank.access,
      leaveBalances: data.leaveBalances || {},
      settings: data.settings,
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((e) => active && setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const employeeId = state.access.employeeId;
  const employee = state.records.find((r) => r.kind === "staff" && r.id === employeeId);
  const personName = employee?.data?.name || displayName;
  const today = karachiDate();

  const myAttendance = useMemo(
    () =>
      state.records.filter(
        (r) => r.kind === "attendance" && !r.archived && r.data.employeeId === employeeId,
      ),
    [state.records, employeeId],
  );

  const myLeave = useMemo(
    () =>
      state.records.filter(
        (r) => r.kind === "leave" && !r.archived && r.data.employeeId === employeeId,
      ),
    [state.records, employeeId],
  );

  const open = myAttendance.find((r) => r.data.status === "In progress");
  const live = state.leaveBalances?.liveAttendance;
  const events = open?.data?.events || live?.events || [];
  const derived = events.length ? deriveSession(events, tick) : null;
  const sessionState =
    derived?.state || live?.state || (open ? "Working" : "Not clocked in");
  const worked = derived?.workedMinutes ?? live?.workedMinutes ?? 0;
  const brk = derived?.breakMinutes ?? live?.breakMinutes ?? 0;

  const todayAtt = myAttendance.find((r) => r.data.date === today);
  const todayLeave = myLeave.find(
    (r) =>
      r.data.start <= today &&
      r.data.end >= today &&
      !["Rejected", "Cancelled", "Withdrawn"].includes(r.data.status),
  );

  async function api(body: any) {
    const r = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, mode: "live", requestId: crypto.randomUUID() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function run(body: any, okMsg?: string) {
    setBusy(true);
    setError("");
    try {
      const data = await api(body);
      setState({
        records: data.records || [],
        access: data.access || state.access,
        leaveBalances: data.leaveBalances || {},
        settings: data.settings || state.settings,
      });
      if (okMsg) setToast(okMsg);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function checkIn() {
    if (!employeeId) {
      setError("Ask HR to link your account to an employee profile first.");
      return;
    }
    const shiftId =
      employee?.data?.shiftId ||
      state.records.find((r) => r.kind === "shift" && !r.archived)?.id ||
      undefined;
    await run(
      { action: "clock_in", data: { employeeId, ...(shiftId ? { shiftId } : {}) } },
      "Checked in for today. Have a good shift.",
    );
  }

  async function checkout() {
    if (!open) return;
    let data: any;
    if (sessionState === "On Break") {
      data = await run({ action: "break_end", id: open.id }, undefined);
      const still = (data.records || []).find((r: Row) => r.id === open.id);
      if (still?.data?.status === "In progress") {
        data = await run({ action: "clock_out", id: open.id }, undefined);
      }
    } else {
      data = await run({ action: "clock_out", id: open.id }, undefined);
    }
    const att = (data.records || []).find((r: Row) => r.id === open.id);
    setToast(classifyToast(att?.data));
    setSelectedDay(today);
    setTab("attendance");
  }

  async function startBreak() {
    if (!open) return;
    await run({ action: "break_start", id: open.id }, "Break started.");
  }

  async function endBreak() {
    if (!open) return;
    await run({ action: "break_end", id: open.id }, "Break ended.");
  }

  async function submitLeave() {
    if (!employeeId) {
      setError("Ask HR to link your employee profile first.");
      return;
    }
    if (!leaveForm.reason.trim()) {
      setError("Add a leave reason.");
      return;
    }
    await run(
      {
        action: "save",
        kind: "leave",
        data: {
          employeeId,
          type: leaveForm.type,
          unit: leaveForm.unit,
          start: leaveForm.start,
          end: leaveForm.unit === "full" ? leaveForm.end : leaveForm.start,
          reason: leaveForm.reason,
        },
      },
      "Leave request submitted.",
    );
    setLeaveForm((f) => ({ ...f, reason: "" }));
  }

  async function withdrawLeave(id: string) {
    await run(
      { action: "transition", id, transition: "withdraw", data: {} },
      "Leave withdrawn.",
    );
  }

  async function changePassword() {
    if (passwordForm.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          mode: "live",
          requestId: crypto.randomUUID(),
          data: passwordForm,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not update password.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setToast("Password updated. Use it the next time you sign in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  const monthDays = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = new Date(`${month}-01T12:00:00+05:00`).getDay();
    const cells: { date: string | null }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: `${month}-${String(d).padStart(2, "0")}` });
    }
    return cells;
  }, [month]);

  const dayAtt = (date: string) => myAttendance.find((r) => r.data.date === date);
  const dayLeave = (date: string) =>
    myLeave.find(
      (r) =>
        r.data.start <= date &&
        r.data.end >= date &&
        !["Rejected", "Cancelled", "Withdrawn"].includes(r.data.status),
    );

  const selectedAtt = dayAtt(selectedDay);
  const selectedLeave = dayLeave(selectedDay);
  const selectedMeta = classificationLabel(selectedAtt, selectedLeave);

  const balances = state.leaveBalances || {};

  if (loading) {
    return (
      <div className="portal">
        <div className="portal-loading">Loading your portal…</div>
      </div>
    );
  }

  return (
    <div className="portal">
      <header className="portal-top">
        <div>
          <div className="portal-eyebrow">TORIX · EMPLOYEE PORTAL</div>
          <h1>{personName}</h1>
          <p>{email} · Staff</p>
        </div>
        <div className="portal-top-actions">
          <button className="btn secondary" type="button" disabled={busy} onClick={() => load().catch(() => {})}>
            <RefreshCw size={15} /> Refresh
          </button>
          <a className="btn secondary" href="/api/auth/logout?return_to=%2Flogin">
            <LogOut size={15} /> Sign out
          </a>
        </div>
      </header>

      <nav className="portal-tabs" aria-label="Portal sections">
        {(
          [
            ["today", "Today"],
            ["attendance", "My attendance"],
            ["leave", "My leave"],
            ["password", "Password"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      ) : null}

      {!employeeId ? (
        <section className="portal-card portal-warn">
          <h2>Profile not linked</h2>
          <p>
            Ask HR or Admin to link your email to an employee profile under Users and roles. Check-in
            stays locked until then.
          </p>
        </section>
      ) : null}

      {tab === "today" && (
        <section className="portal-card portal-today">
          <div className="portal-status">
            <Clock3 size={22} />
            <div>
              <strong>{sessionState}</strong>
              <span>
                {today} · worked {worked}m · break {brk}m
                {(open?.data?.lateMinutes ?? 0) > 0 ? ` · late ${open?.data?.lateMinutes}m` : ""}
              </span>
            </div>
          </div>

          <div className="portal-cta-row">
            {!open ? (
              <button
                className="btn primary portal-cta"
                type="button"
                disabled={busy || !employeeId}
                onClick={() => void checkIn().catch(() => {})}
              >
                Check-in today
              </button>
            ) : (
              <>
                {sessionState === "Working" && (
                  <button
                    className="btn secondary portal-cta"
                    type="button"
                    disabled={busy}
                    onClick={() => void startBreak().catch(() => {})}
                  >
                    <Coffee size={16} /> Start break
                  </button>
                )}
                {sessionState === "On Break" && (
                  <button
                    className="btn secondary portal-cta"
                    type="button"
                    disabled={busy}
                    onClick={() => void endBreak().catch(() => {})}
                  >
                    End break
                  </button>
                )}
                <button
                  className="btn primary portal-cta"
                  type="button"
                  disabled={busy}
                  onClick={() => void checkout().catch(() => {})}
                >
                  Checkout today
                </button>
              </>
            )}
          </div>

          <p className="portal-hint">
            Office hours are 7:00 PM – 4:00 AM (Karachi). Checkout stamps worked time; missing up to
            2 hours is short leave (¼ day), more than 2 hours is half-day (½ day).
          </p>

          {todayAtt && todayAtt.data.status !== "In progress" && (
            <div className="portal-day-summary">
              <span>Today&apos;s result</span>
              <strong>{classificationLabel(todayAtt, todayLeave).text}</strong>
              <small>
                In {fmtTime(todayAtt.data.clockIn)} · Out {fmtTime(todayAtt.data.clockOut)} ·{" "}
                {todayAtt.data.workedMinutes ?? 0}m worked
              </small>
            </div>
          )}
        </section>
      )}

      {tab === "attendance" && (
        <section className="portal-card">
          <div className="portal-month-head">
            <h2>
              <CalendarDays size={18} /> Monthly overview
            </h2>
            <input
              type="month"
              aria-label="Select month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="portal-cal-dow">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="portal-cal">
            {monthDays.map((cell, i) => {
              if (!cell.date) return <div key={`e${i}`} className="portal-cal-cell is-empty" />;
              const att = dayAtt(cell.date);
              const lv = dayLeave(cell.date);
              const meta = classificationLabel(att, lv);
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={
                    "portal-cal-cell" +
                    (cell.date === selectedDay ? " is-selected" : "") +
                    (cell.date === today ? " is-today" : "") +
                    ` is-${meta.key}`
                  }
                  onClick={() => setSelectedDay(cell.date!)}
                >
                  <strong>{Number(cell.date.slice(8))}</strong>
                  <small>{meta.text}</small>
                </button>
              );
            })}
          </div>

          <div className="portal-day-detail">
            <h3>{selectedDay}</h3>
            <p>
              Status: <strong>{selectedMeta.text}</strong>
            </p>
            {selectedAtt ? (
              <ul>
                <li>Clock in: {fmtTime(selectedAtt.data.clockIn)}</li>
                <li>Clock out: {fmtTime(selectedAtt.data.clockOut)}</li>
                <li>Worked: {selectedAtt.data.workedMinutes ?? 0} minutes</li>
                <li>Break: {selectedAtt.data.breakMinutes ?? 0} minutes</li>
                <li>Late: {selectedAtt.data.lateMinutes ?? 0} minutes</li>
                <li>Classification: {selectedAtt.data.classification || "—"}</li>
              </ul>
            ) : (
              <p className="portal-muted">No attendance record for this day.</p>
            )}
            {selectedLeave ? (
              <p>
                Leave: {selectedLeave.data.type} · {selectedLeave.data.unit || "full"} ·{" "}
                {selectedLeave.data.status}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {tab === "leave" && (
        <>
          <section className="portal-kpi-grid">
            {["Annual", "Sick", "Casual"].map((t) => {
              const b = balances[t];
              return (
                <article key={t} className="portal-kpi">
                  <div>{t}</div>
                  <strong>{b?.availableDays ?? 0}d</strong>
                  <small>
                    Used {b?.usedDays ?? 0}d · pending {b?.pendingDays ?? 0}d
                  </small>
                </article>
              );
            })}
          </section>

          <section className="portal-card">
            <h2>
              <Plane size={18} /> Request leave
            </h2>
            <div className="portal-form-grid">
              <label>
                Type
                <select
                  value={leaveForm.type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })}
                >
                  {["Annual", "Sick", "Casual", "Unpaid"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Unit
                <select
                  value={leaveForm.unit}
                  onChange={(e) => setLeaveForm({ ...leaveForm, unit: e.target.value })}
                >
                  <option value="full">Full day</option>
                  <option value="half">Half day</option>
                  <option value="short">Short (¼)</option>
                </select>
              </label>
              <label>
                Start
                <input
                  type="date"
                  value={leaveForm.start}
                  onChange={(e) => setLeaveForm({ ...leaveForm, start: e.target.value })}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={leaveForm.end}
                  disabled={leaveForm.unit !== "full"}
                  onChange={(e) => setLeaveForm({ ...leaveForm, end: e.target.value })}
                />
              </label>
              <label className="portal-span">
                Reason
                <textarea
                  rows={3}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  required
                />
              </label>
            </div>
            <button
              className="btn primary"
              type="button"
              disabled={busy || !employeeId}
              onClick={() => void submitLeave().catch(() => {})}
            >
              Submit leave request
            </button>
          </section>

          <section className="portal-card">
            <h2>My leave requests</h2>
            {myLeave.length === 0 ? (
              <p className="portal-muted">No leave requests yet.</p>
            ) : (
              <ul className="portal-list">
                {[...myLeave]
                  .sort((a, b) => String(b.data.start).localeCompare(String(a.data.start)))
                  .map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>
                          {r.data.type} · {r.data.start}
                          {r.data.end !== r.data.start ? ` → ${r.data.end}` : ""}
                        </strong>
                        <small>
                          {r.data.unit || "full"} · {r.data.status} · {r.data.reason}
                        </small>
                      </div>
                      {["Submitted", "Pending"].includes(r.data.status) && (
                        <button
                          className="text-link"
                          type="button"
                          disabled={busy}
                          onClick={() => void withdrawLeave(r.id).catch(() => {})}
                        >
                          Withdraw
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "password" && (
        <section className="portal-card">
          <h2>
            <KeyRound size={18} /> Change password
          </h2>
          <p className="portal-hint" style={{ marginBottom: 14 }}>
            Enter your current password, then choose a new one (at least 8 characters). Admin/HR can
            also reset it from Team or Users and roles.
          </p>
          <div className="portal-form-grid">
            <label className="portal-span">
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                }
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                }
              />
            </label>
          </div>
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void changePassword()}
            style={{ marginTop: 14 }}
          >
            Update password
          </button>
        </section>
      )}
    </div>
  );
}
