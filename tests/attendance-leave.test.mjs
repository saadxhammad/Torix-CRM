import test from 'node:test';
import assert from 'node:assert/strict';
import {appendAttendanceEvent,deriveSession,sessionState,lateMinutesFor,karachiDate} from '../lib/attendance.mjs';
import {classifyMissedMinutes,planPartialEntry,QUARTER,HALF,FULL} from '../lib/partial-absence.mjs';
import {allocateFifo,grantStatus,remainingOnGrant} from '../lib/leave-balance.mjs';
import {daysToQuarters} from '../lib/partial-absence.mjs';
import {localTimestamp} from '../lib/finance.mjs';

test('attendance event sequence and live timer', () => {
  const t0 = '2026-10-20T13:00:00.000Z';
  let s = appendAttendanceEvent({name: 'A', date: '2026-10-20', events: []}, 'clock_in', t0);
  assert.equal(sessionState(s.events), 'Working');
  s = appendAttendanceEvent(s, 'break_start', '2026-10-20T14:00:00.000Z');
  assert.equal(sessionState(s.events), 'On Break');
  s = appendAttendanceEvent(s, 'break_end', '2026-10-20T14:15:00.000Z');
  assert.equal(sessionState(s.events), 'Working');
  s = appendAttendanceEvent(s, 'clock_out', '2026-10-20T17:00:00.000Z');
  assert.equal(sessionState(s.events), 'Clocked Out');
  const d = deriveSession(s.events, Date.parse('2026-10-20T17:00:00.000Z'));
  assert.equal(d.breakMinutes, 15);
  assert.equal(d.workedMinutes, 225); // 60 + 165
  assert.throws(() => appendAttendanceEvent(s, 'clock_in', '2026-10-20T18:00:00.000Z'));
});

test('live timer continues without DB writes while on break', () => {
  const events = [
    {id: '1', type: 'clock_in', at: '2026-10-20T10:00:00.000Z'},
    {id: '2', type: 'break_start', at: '2026-10-20T12:00:00.000Z'},
  ];
  const a = deriveSession(events, Date.parse('2026-10-20T12:10:00.000Z'));
  const b = deriveSession(events, Date.parse('2026-10-20T12:40:00.000Z'));
  assert.equal(a.state, 'On Break');
  assert.equal(a.breakMinutes, 10);
  assert.equal(b.breakMinutes, 40);
  assert.equal(a.workedMinutes, 120);
  assert.equal(b.workedMinutes, 120);
});

test('15-minute grace on night office: 19:15 not late, 19:16 late', () => {
  const shift = {data: {startTime: '19:00', endTime: '04:00', graceMinutes: 15}};
  const date = '2026-10-20';
  const within = lateMinutesFor(localTimestamp(date, '19:15'), date, shift);
  const late = lateMinutesFor(localTimestamp(date, '19:16'), date, shift);
  assert.equal(within, 0);
  assert.equal(late, 1);
});

test('missed time classification thresholds vs 19:00–04:00 schedule (495m)', () => {
  const scheduled = 495; // 9h − 45m break
  assert.equal(classifyMissedMinutes(0, scheduled).units, 0);
  assert.equal(classifyMissedMinutes(120, scheduled).units, QUARTER); // ≤2h short
  assert.equal(classifyMissedMinutes(121, scheduled).units, HALF);
  assert.equal(classifyMissedMinutes(scheduled, scheduled).units, FULL);
});

test('three short absences reconcile to one full day without double charge', () => {
  const prior = [];
  const a = planPartialEntry(prior, QUARTER);
  assert.equal(a.toCharge, 1);
  prior.push({kind: 'partial', units: 1, charged: 1});
  const b = planPartialEntry(prior, QUARTER);
  assert.equal(b.toCharge, 1);
  prior.push({kind: 'partial', units: 1, charged: 1});
  const c = planPartialEntry(prior, QUARTER);
  assert.equal(c.threshold, true);
  assert.equal(c.toCharge + c.penalty, 2); // already 2 charged → need 2 more to reach 4
  assert.equal(2 + c.toCharge + c.penalty, 4);
});

test('two half-day absences equal one full day, no extra penalty', () => {
  const prior = [{kind: 'partial', units: HALF, charged: HALF}];
  const plan = planPartialEntry(prior, HALF);
  assert.equal(plan.twoHalves, true);
  assert.equal(plan.toCharge, HALF);
  assert.equal(plan.penalty, 0);
});

test('full-day no-show charges 4 and does not feed partial pattern', () => {
  const plan = planPartialEntry([], FULL);
  assert.equal(plan.fullDay, true);
  assert.equal(plan.toCharge, FULL);
  assert.equal(plan.patternUnits, 0);
});

test('FIFO grant consumption by earliest expiry', () => {
  const emp = 'e1';
  const records = [
    {id: 'g1', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 1, effectiveDate: '2026-01-01', expiryDate: '2026-06-30', status: 'Active'}},
    {id: 'g2', kind: 'leavegrant', archived: false, data: {employeeId: emp, type: 'Annual', amount: 2, effectiveDate: '2026-01-01', expiryDate: '2026-12-31', status: 'Active'}},
    {id: 'l1', kind: 'leaveledger', archived: false, data: {employeeId: emp, entryType: 'grant', grantId: 'g1', units: 4, leaveType: 'Annual'}},
    {id: 'l2', kind: 'leaveledger', archived: false, data: {employeeId: emp, entryType: 'grant', grantId: 'g2', units: 8, leaveType: 'Annual'}},
  ];
  const alloc = allocateFifo(records, emp, 'Annual', 5, '2026-03-01'); // 5 quarters = 1.25 days
  assert.equal(alloc[0].grantId, 'g1');
  assert.equal(alloc[0].units, 4);
  assert.equal(alloc[1].grantId, 'g2');
  assert.equal(alloc[1].units, 1);
});

test('grant status scheduled / active / expired by Karachi date', () => {
  assert.equal(grantStatus({data: {effectiveDate: '2026-11-01', expiryDate: '2026-12-31'}}, '2026-10-20'), 'Scheduled');
  assert.equal(grantStatus({data: {effectiveDate: '2026-01-01', expiryDate: '2026-12-31'}}, '2026-10-20'), 'Active');
  assert.equal(grantStatus({data: {effectiveDate: '2026-01-01', expiryDate: '2026-09-30'}}, '2026-10-20'), 'Expired');
});

test('remainingOnGrant subtracts usage and expiry', () => {
  const grant = {id: 'g1', data: {amount: 5}};
  const records = [
    {kind: 'leaveledger', archived: false, data: {grantId: 'g1', entryType: 'usage', units: 4, reversed: false}},
    {kind: 'leaveledger', archived: false, data: {grantId: 'g1', entryType: 'expiry', units: 8, reversed: false}},
  ];
  // 5 days = 20 quarters; used 4+8=12; remaining 8 quarters = 2 days
  assert.equal(remainingOnGrant(grant, records), 8);
  assert.equal(daysToQuarters(5), 20);
});

test('karachiDate helper is stable ISO date', () => {
  assert.match(karachiDate('2026-10-20T20:00:00.000Z'), /^\d{4}-\d{2}-\d{2}$/);
});
