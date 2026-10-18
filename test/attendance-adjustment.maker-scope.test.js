'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertMakerScope } = require('../src/services/attendance-adjustment.service');

// OWNER policy (18 Oct 2026): SUPERVISOR/MANAGER/ADMIN are cross-department executives,
// SUPERVISOR and MANAGER may key up to 3 days back (admin must verify work evidence),
// ADMIN has no limit, and a linked VIEWER (employee account) may key only its own shift.
const clock = () => new Date('2026-10-18T05:00:00.000Z'); // 12:00 Asia/Bangkok
const daysAgo = (days) => {
  const d = new Date('2026-10-18T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
};
const assignment = (overrides = {}) => ({
  employeeId: 'employee-1',
  workDate: daysAgo(3),
  ...overrides
});
const actor = (role, extra = {}) => ({ sub: `${role.toLowerCase()}-1`, role, ...extra });
const codeOf = (fn) => {
  try { fn(); return null; } catch (error) { return error.details?.code || error.code || error.message; }
};

test('ADMIN may key without any time limit', () => {
  assert.equal(assertMakerScope(actor('ADMIN'), assignment({ workDate: daysAgo(30) }), clock), 'ADMIN');
});

test('MANAGER may key up to 3 days back only', () => {
  assert.equal(assertMakerScope(actor('MANAGER'), assignment({ workDate: daysAgo(1) }), clock), 'MANAGER');
  assert.equal(assertMakerScope(actor('MANAGER'), assignment({ workDate: daysAgo(3) }), clock), 'MANAGER');
  assert.equal(
    codeOf(() => assertMakerScope(actor('MANAGER'), assignment({ workDate: daysAgo(4) }), clock)),
    'ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN'
  );
});

test('SUPERVISOR may key confirmations for staff (cross-department) up to 3 days back', () => {
  const staffShift = assignment({ employeeId: 'employee-999', workDate: daysAgo(2) });
  assert.equal(assertMakerScope(actor('SUPERVISOR'), staffShift, clock), 'SUPERVISOR');
  assert.equal(
    codeOf(() => assertMakerScope(actor('SUPERVISOR'), assignment({ workDate: daysAgo(4) }), clock)),
    'ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN'
  );
});

test('VIEWER (linked employee) may key only its own shift', () => {
  const employee = actor('VIEWER', { employeeAuthority: { id: 'employee-1' } });
  assert.equal(assertMakerScope(employee, assignment({ employeeId: 'employee-1', workDate: daysAgo(1) }), clock), 'VIEWER');
  assert.equal(
    codeOf(() => assertMakerScope(employee, assignment({ employeeId: 'employee-2' }), clock)),
    'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN'
  );
});

test('VIEWER without a linked employee and unknown roles are denied', () => {
  assert.equal(
    codeOf(() => assertMakerScope(actor('VIEWER'), assignment(), clock)),
    'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN'
  );
  assert.equal(
    codeOf(() => assertMakerScope(actor('GUEST'), assignment(), clock)),
    'ATTENDANCE_ADJUSTMENT_FORBIDDEN'
  );
  assert.equal(
    codeOf(() => assertMakerScope({ role: 'ADMIN' }, assignment(), clock)),
    'ATTENDANCE_ADJUSTMENT_ACTOR_REQUIRED'
  );
});
