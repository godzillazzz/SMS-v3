'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertProposalWindow } = require('../src/services/attendance-adjustment.service');

// OWNER policy (18 Oct 2026): the confirmed window must stay close to the planned shift.
const dayShift = { workDate: new Date('2026-10-17T00:00:00.000Z'), startTime: '08:00', endTime: '17:00' };
const nightShift = { workDate: new Date('2026-10-17T00:00:00.000Z'), startTime: '20:00', endTime: '05:00' };
const codeOf = (fn) => {
  try { fn(); return null; } catch (error) { return error.details?.code || error.code || error.message; }
};

test('a normal day shift window is accepted', () => {
  assert.equal(codeOf(() => assertProposalWindow(dayShift, {
    checkInAt: '2026-10-17T01:00:00.000Z', // 08:00 Bangkok
    checkOutAt: '2026-10-17T10:00:00.000Z' // 17:00 Bangkok
  })), null);
});

test('check-in far before the shift start is rejected', () => {
  assert.equal(codeOf(() => assertProposalWindow(dayShift, {
    checkInAt: '2026-10-16T20:00:00.000Z', // 03:00 Bangkok, five hours early
    checkOutAt: '2026-10-17T10:00:00.000Z'
  })), 'ATTENDANCE_ADJUSTMENT_WINDOW_INVALID');
});

test('checkout far after the shift end is rejected', () => {
  assert.equal(codeOf(() => assertProposalWindow(dayShift, {
    checkInAt: '2026-10-17T05:00:00.000Z', // 12:00 Bangkok
    checkOutAt: '2026-10-17T18:30:00.000Z' // 01:30 next day, 8.5h after the shift end
  })), 'ATTENDANCE_ADJUSTMENT_WINDOW_INVALID');
});

test('an impossible duration is rejected', () => {
  assert.equal(codeOf(() => assertProposalWindow(dayShift, {
    checkInAt: '2026-10-17T01:00:00.000Z',
    checkOutAt: '2026-10-18T00:00:00.000Z' // 23 hours
  })), 'ATTENDANCE_ADJUSTMENT_DURATION_INVALID');
});

test('a night shift accepts a next-day checkout inside the tolerance', () => {
  assert.equal(codeOf(() => assertProposalWindow(nightShift, {
    checkInAt: '2026-10-17T13:05:00.000Z', // 20:05 Bangkok
    checkOutAt: '2026-10-17T22:10:00.000Z' // 05:10 Bangkok next day
  })), null);
});
