/**
 * Spec v5 acceptance criteria — pure logic + approval/access rules.
 * Run: node --experimental-vm-modules --test tests/acceptance-v5.test.mjs tests/attendance-leave.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilities,can,recordAllowed,inDepartment} from '../lib/access.mjs';
import {appendAttendanceEvent,deriveSession,lateMinutesFor,karachiDate} from '../lib/attendance.mjs';
import {classifyMissedMinutes,planPartialEntry,QUARTER,HALF,FULL} from '../lib/partial-absence.mjs';
import {
  allocateFifo,effectiveAvailable,inProbation,grantStatus,expireGrantEntries,
  remainingOnGrant,balanceSummary,PROBATION_QUARTERS,
} from '../lib/leave-balance.mjs';
import {localTimestamp} from '../lib/finance.mjs';
import {approveLeave,convertLate,manualLeaveAdjust,saveLeaveGrant} from '../lib/people-actions.ts';

function ctx(records,access){
  return {
    ws: 'test', mode: 'live', ownerId: 'o', user: {email: access.email || 't@test.com', userId: 'u'},
    access: {...access, caps: access.caps instanceof Set ? access.caps : new Set(access.caps || [])},
    revision: 1, records: structuredClone(records), events: [], audit: [], settings: {workingDays: [1,2,3,4,5], probationLeaveDays: 3},
  };
}
function change(c){
  return {
    c: {...c, records: structuredClone(c.records), events: structuredClone(c.events)},
    rows: new Map(), detail: '',
    put(kind, data, id = crypto.randomUUID()) {
      let r = this.c.records.find((x) => x.id === id);
      if (!r) { r = {id, kind, data, archived: false}; this.c.records.push(r); }
      else r.data = data;
      this.rows.set(id, r);
      return r;
    },
  };
}

test('AC: clock/break sequence survives re-derive (refresh-safe)', () => {
  let s = {name: 'A', date: '2026-10-20', events: []};
  s = appendAttendanceEvent(s, 'clock_in', '2026-10-20T13:00:00.000Z');
  s = appendAttendanceEvent(s, 'break_start', '2026-10-20T14:00:00.000Z');
  const snapshot = structuredClone(s.events);
  const d1 = deriveSession(snapshot, Date.parse('2026-10-20T14:30:00.000Z'));
  const d2 = deriveSession(structuredClone(snapshot), Date.parse('2026-10-20T14:30:00.000Z'));
  assert.deepEqual(d1, d2);
  assert.equal(d1.state, 'On Break');
  assert.equal(d1.breakMinutes, 30);
  assert.equal(d1.workedMinutes, 60);
});

test('AC: 15m grace records late but classification leaves leave untouched', () => {
  const shift = {data: {startTime: '19:00', endTime: '04:00', graceMinutes: 15}};
  assert.equal(lateMinutesFor(localTimestamp('2026-10-20', '19:15'), '2026-10-20', shift), 0);
  assert.equal(lateMinutesFor(localTimestamp('2026-10-20', '19:16'), '2026-10-20', shift), 1);
  // Late alone does not imply leave debit — convert_late is admin-only and separate
  assert.equal(classifyMissedMinutes(0, 480).units, 0);
});

test('AC: partial accumulate across dates; 3 shorts → full without double charge', () => {
  const prior = [];
  for (const u of [QUARTER, QUARTER]) {
    const p = planPartialEntry(prior, u);
    prior.push({kind: 'partial', units: u, charged: p.toCharge});
  }
  const third = planPartialEntry(prior, QUARTER);
  assert.equal(third.threshold, true);
  const total = prior.reduce((n, e) => n + e.charged, 0) + third.toCharge + third.penalty;
  assert.equal(total, FULL);
});

test('AC: full-day no-show is FULL and not pattern partial', () => {
  const p = planPartialEntry([{kind: 'partial', units: QUARTER, charged: QUARTER}], FULL);
  assert.equal(p.fullDay, true);
  assert.equal(p.toCharge, FULL);
  assert.equal(p.patternUnits, 0);
});

test('AC: two half-days = one full day, no extra penalty', () => {
  const p = planPartialEntry([{kind: 'partial', units: HALF, charged: HALF}], HALF);
  assert.equal(p.twoHalves, true);
  assert.equal(p.toCharge + p.penalty, HALF);
  assert.equal(HALF + p.toCharge + p.penalty, FULL);
});

test('AC: grants activate/expire by Karachi date; unused expiry is auditable', () => {
  assert.equal(grantStatus({data: {effectiveDate: '2026-11-01', expiryDate: '2026-12-31'}}, '2026-10-20'), 'Scheduled');
  assert.equal(grantStatus({data: {effectiveDate: '2026-01-01', expiryDate: '2026-12-31'}}, '2026-10-20'), 'Active');
  assert.equal(grantStatus({data: {effectiveDate: '2026-01-01', expiryDate: '2026-09-30'}}, '2026-10-20'), 'Expired');
  const grant = {id: 'g1', data: {employeeId: 'e1', type: 'Annual', amount: 2, expiryDate: '2026-09-30'}};
  const records = [{kind: 'leaveledger', archived: false, data: {grantId: 'g1', entryType: 'grant', units: 8, reversed: false}}];
  const entry = expireGrantEntries(grant, records);
  assert.equal(entry.entryType, 'expiry');
  assert.equal(entry.units, 8);
  assert.equal(entry.direction, 'debit');
});

test('AC: balance summary exposes current/used/pending/future/expiring', () => {
  const emp = 'e1';
  const records = [
    {id: 'g1', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 5, effectiveDate: '2026-01-01', expiryDate: '2026-12-31', status: 'Active'}},
    {id: 'g2', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 2, effectiveDate: '2026-12-01', expiryDate: '2027-06-30', status: 'Scheduled'}},
    {id: 'l1', kind: 'leaveledger', archived: false, data: {employeeId: emp, entryType: 'grant', grantId: 'g1', units: 20, leaveType: 'Annual', reversed: false}},
    {id: 'lv', kind: 'leave', archived: false, data: {employeeId: emp, type: 'Annual', status: 'Submitted', start: '2026-10-25', units: 1, quarters: 4}},
  ];
  const b = balanceSummary(records, emp, 'Annual', '2026-10-20');
  assert.ok(b.availableDays >= 0);
  assert.ok(Array.isArray(b.future) && b.future.length === 1);
  assert.ok(Array.isArray(b.expiring));
  assert.equal(b.pendingDays, 1);
  assert.ok('usedDays' in b && 'grantedDays' in b);
});

test('AC: FIFO consumes earliest-expiring grant first', () => {
  const emp = 'e1';
  const records = [
    {id: 'g1', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 1, effectiveDate: '2026-01-01', expiryDate: '2026-06-30', status: 'Active'}},
    {id: 'g2', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 3, effectiveDate: '2026-01-01', expiryDate: '2026-12-31', status: 'Active'}},
    {id: 'l1', kind: 'leaveledger', archived: false, data: {grantId: 'g1', entryType: 'grant', units: 4, reversed: false}},
    {id: 'l2', kind: 'leaveledger', archived: false, data: {grantId: 'g2', entryType: 'grant', units: 12, reversed: false}},
  ];
  const a = allocateFifo(records, emp, 'Annual', 5, '2026-03-01');
  assert.equal(a[0].grantId, 'g1');
  assert.equal(a[0].units, 4);
  assert.equal(a[1].grantId, 'g2');
  assert.equal(a[1].units, 1);
});

test('AC: probation caps available at 3 full-day equivalents', () => {
  const staff = {id: 'e1', data: {probationStart: '2026-01-01', probationEnd: '2026-12-31'}};
  assert.equal(inProbation(staff, '2026-06-01'), true);
  assert.equal(PROBATION_QUARTERS, 12);
  const records = [
    {id: 'g1', kind: 'leavegrant', archived: false, data: {employeeId: 'e1', type: 'Annual', amount: 20, effectiveDate: '2026-01-01', expiryDate: '2026-12-31', status: 'Active'}},
    {id: 'l1', kind: 'leaveledger', archived: false, data: {grantId: 'g1', entryType: 'grant', units: 80, leaveType: 'Annual', employeeId: 'e1', reversed: false}},
  ];
  assert.equal(effectiveAvailable(records, staff, 'Annual', '2026-06-01'), 12);
});

test('AC: managers cannot self-approve leave', () => {
  const mgr = {id: 'mgr', kind: 'staff', archived: false, data: {name: 'Mgr', department: 'Development', managerId: ''}};
  const leave = {id: 'lv1', kind: 'leave', archived: false, data: {employeeId: 'mgr', type: 'Annual', status: 'Submitted', start: '2026-10-25', end: '2026-10-25', unit: 'full', quarters: 4, reason: 'x', department: 'Development'}};
  const caps = capabilities({role: 'Department head', departments: ['Development'], grants: [], employeeId: 'mgr'});
  const c = ctx([mgr, leave], {role: 'Department head', departments: ['Development'], employeeId: 'mgr', caps, email: 'mgr@t.com'});
  const ch = change(c);
  assert.throws(() => approveLeave(ch, 'lv1', 'approve'), /another approver/i);
});

test('AC: only HR/Owner can approve manager leave', () => {
  const mgr = {id: 'mgr', kind: 'staff', archived: false, data: {name: 'Mgr', department: 'Development'}};
  const report = {id: 'rep', kind: 'staff', archived: false, data: {name: 'Rep', department: 'Development', managerId: 'mgr'}};
  const leave = {id: 'lv1', kind: 'leave', archived: false, data: {employeeId: 'mgr', type: 'Unpaid', status: 'Submitted', start: '2026-10-25', end: '2026-10-25', unit: 'full', quarters: 4, reason: 'x', department: 'Development'}};
  const peerCaps = capabilities({role: 'Department head', departments: ['Development'], grants: [], employeeId: 'peer'});
  const c = ctx([mgr, report, leave], {role: 'Department head', departments: ['Development'], employeeId: 'peer', caps: peerCaps, email: 'peer@t.com'});
  assert.throws(() => approveLeave(change(c), 'lv1', 'approve'), /Only HR or Owner/i);

  const hrCaps = capabilities({role: 'HR', departments: [], grants: [], employeeId: ''});
  const hr = ctx([mgr, report, leave], {role: 'HR', departments: [], employeeId: '', caps: hrCaps, email: 'hr@t.com'});
  const ch = change(hr);
  approveLeave(ch, 'lv1', 'approve');
  assert.equal(ch.c.records.find((r) => r.id === 'lv1').data.status, 'Approved');
});

test('AC: convert_late is idempotent (no duplicate charge)', () => {
  const att = {id: 'a1', kind: 'attendance', archived: false, data: {employeeId: 'e1', department: 'Development', date: '2026-10-20', lateMinutes: 20, status: 'Submitted'}};
  const caps = capabilities({role: 'HR', departments: [], grants: [], employeeId: ''});
  const c = ctx([att], {role: 'HR', caps, email: 'hr@t.com'});
  const ch1 = change(c);
  convertLate(ch1, ['a1'], 'Reviewed late arrival');
  assert.equal(ch1.c.records.filter((r) => r.kind === 'leaveledger' && r.data.entryType === 'late_conversion').length, 1);
  assert.equal(ch1.c.records.find((r) => r.id === 'a1').data.lateConverted, true);
  // Second conversion against already-converted state must fail
  assert.throws(() => convertLate(ch1, ['a1'], 'Again'), /already converted/i);
});

test('AC: manual credit/debit requires reason and leave.admin', () => {
  const staff = {id: 'e1', kind: 'staff', archived: false, data: {name: 'E', department: 'Development'}};
  const staffCaps = capabilities({role: 'Staff', departments: ['Development'], grants: [], employeeId: 'e1'});
  assert.throws(
    () => manualLeaveAdjust(change(ctx([staff], {role: 'Staff', caps: staffCaps, employeeId: 'e1'})), {employeeId: 'e1', units: 4, reason: 'x', direction: 'credit'}),
    /HR or Owner/i,
  );
  const hrCaps = capabilities({role: 'HR', departments: [], grants: [], employeeId: ''});
  const ch = change(ctx([staff], {role: 'HR', caps: hrCaps}));
  assert.throws(() => manualLeaveAdjust(ch, {employeeId: 'e1', units: 4, direction: 'credit'}), /reason/i);
  manualLeaveAdjust(ch, {employeeId: 'e1', units: 4, reason: 'Goodwill credit', direction: 'credit', leaveType: 'Annual'});
  const led = ch.c.records.find((r) => r.kind === 'leaveledger');
  assert.equal(led.data.entryType, 'manual');
  assert.equal(led.data.direction, 'credit');
  assert.equal(led.data.units, 4);
});

test('AC: department-scoped manager cannot see unrelated department leave', () => {
  const leaveDev = {id: 'l1', kind: 'leave', archived: false, data: {employeeId: 'e1', department: 'Development', status: 'Submitted'}};
  const leaveMkt = {id: 'l2', kind: 'leave', archived: false, data: {employeeId: 'e2', department: 'Marketing', status: 'Submitted'}};
  const staff = [
    {id: 'e1', kind: 'staff', archived: false, data: {department: 'Development'}},
    {id: 'e2', kind: 'staff', archived: false, data: {department: 'Marketing'}},
  ];
  const caps = capabilities({role: 'Department head', departments: ['Development'], grants: [], employeeId: 'mgr'});
  const access = {role: 'Department head', departments: ['Development'], employeeId: 'mgr', caps};
  assert.equal(recordAllowed(access, leaveDev, staff), true);
  assert.equal(recordAllowed(access, leaveMkt, staff), false);
  assert.equal(inDepartment(access, 'Marketing'), false);
  const hrCaps = capabilities({role: 'HR', departments: [], grants: []});
  assert.equal(recordAllowed({role: 'HR', departments: [], caps: hrCaps}, leaveMkt, staff), true);
});

test('AC: ≤2h missed = short (¼); >2h = half-day', () => {
  assert.equal(classifyMissedMinutes(120, 480).units, QUARTER);
  assert.equal(classifyMissedMinutes(121, 480).units, HALF);
});

test('AC: saveLeaveGrant writes grant ledger credit when Active', () => {
  const staff = {id: 'e1', kind: 'staff', archived: false, data: {name: 'E', department: 'Development'}};
  const hrCaps = capabilities({role: 'HR', departments: [], grants: []});
  const ch = change(ctx([staff], {role: 'HR', caps: hrCaps, email: 'hr@t.com'}));
  const row = saveLeaveGrant(ch, {
    employeeId: 'e1', type: 'Annual', amount: 3,
    effectiveDate: '2026-01-01', expiryDate: '2026-12-31', reason: 'Annual allotment',
  });
  assert.equal(row.data.amount, 3);
  const led = ch.c.records.find((r) => r.kind === 'leaveledger' && r.data.entryType === 'grant');
  assert.equal(led.data.units, 12);
  assert.equal(led.data.grantId, row.id);
});

test('karachiDate helper', () => {
  assert.match(karachiDate('2026-10-20T20:00:00.000Z'), /^\d{4}-\d{2}-\d{2}$/);
});
