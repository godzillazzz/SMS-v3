const test = require('node:test');
const assert = require('node:assert/strict');
const scheduleService = require('../src/services/schedule.service');

test('Schedule Service Unit Tests', async (t) => {
  await t.test('getMonthlyGrid returns monthly calendar grid structure', async () => {
    const grid = await scheduleService.getMonthlyGrid('2026-07');
    assert.equal(grid.yearMonth, '2026-07');
    assert.equal(grid.daysInMonth, 31);
    assert.ok(Array.isArray(grid.dates));
    assert.ok(Array.isArray(grid.employees));
    assert.ok(Array.isArray(grid.shiftTypes));
  });
});
