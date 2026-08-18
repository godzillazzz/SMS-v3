'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DASHBOARD_QUERY_CONCURRENCY, settleDashboardQueries } = require('../src/services/dashboard.service');

test('dashboard query settling is bounded, concurrent, ordered, and partial-error safe', async () => {
  assert.equal(DASHBOARD_QUERY_CONCURRENCY, 4);
  let active = 0;
  let maxActive = 0;
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tasks = Array.from({ length: 7 }, (_, index) => async () => {
    active += 1;
    started += 1;
    maxActive = Math.max(maxActive, active);
    if (started === DASHBOARD_QUERY_CONCURRENCY) release();
    await gate;
    await Promise.resolve();
    active -= 1;
    if (index === 5) throw new Error('expected-partial-failure');
    return `value-${index}`;
  });

  const results = await settleDashboardQueries(tasks);

  assert.equal(maxActive, DASHBOARD_QUERY_CONCURRENCY);
  assert.ok(maxActive > 1, 'independent dashboard work must not settle strictly sequentially');
  assert.equal(results.length, 7);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value, 'value-0');
  assert.equal(results[4].value, 'value-4');
  assert.equal(results[5].status, 'rejected');
  assert.match(results[5].reason.message, /expected-partial-failure/);
  assert.equal(results[6].value, 'value-6');
});
