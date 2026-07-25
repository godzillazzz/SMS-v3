const test = require('node:test');
const assert = require('node:assert/strict');
const leaveService = require('../src/services/leave.service');

test('Leave Service Unit Tests', async (t) => {
  await t.test('listRequests returns array', async () => {
    const list = await leaveService.listRequests();
    assert.ok(Array.isArray(list));
  });
});
