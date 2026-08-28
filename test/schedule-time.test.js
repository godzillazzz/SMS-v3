'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScheduleTime } = require('../src/utils/schedule-time');

test('schedule time canonicalizer preserves HH:mm and normalizes legacy variants', () => {
  assert.equal(normalizeScheduleTime('07:00'), '07:00');
  assert.equal(normalizeScheduleTime('7:00'), '07:00');
  assert.equal(normalizeScheduleTime('07.00'), '07:00');
  assert.equal(normalizeScheduleTime('7.00'), '07:00');
  assert.equal(normalizeScheduleTime('19.00'), '19:00');
});

test('schedule time canonicalizer rejects ambiguous or out-of-range values', () => {
  for (const value of ['7:0', '24:00', '19:60', '0700', 'abc']) {
    assert.equal(normalizeScheduleTime(value), null, value);
  }
  assert.equal(normalizeScheduleTime(null), null);
  assert.equal(normalizeScheduleTime(''), null);
});
