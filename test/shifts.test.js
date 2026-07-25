const test = require('node:test');
const assert = require('node:assert/strict');
const shiftService = require('../src/services/shift.service');

test('Shift Service Unit Tests', async (t) => {
  await t.test('list returns array of shift types', async () => {
    const shifts = await shiftService.list();
    assert.ok(Array.isArray(shifts));
  });
});
