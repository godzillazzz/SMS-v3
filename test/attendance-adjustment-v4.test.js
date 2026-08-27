
'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeProposal,
  stableDigest,
  assertMakerScope,
  assertAdmin
} = require('../src/services/attendance-adjustment.service');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Attendance adjustment proposal validates governed request types and time order', () => {
  assert.deepEqual(
    normalizeProposal('ADJUST_WORK_TIME', { checkInAt: '2026-08-27T00:05:00.000Z' }),
    {
      type: 'ADJUST_WORK_TIME',
      proposal: { checkInAt: '2026-08-27T00:05:00.000Z', checkOutAt: null }
    }
  );

  assert.throws(
    () => normalizeProposal('CONFIRM_WORK_PERFORMED', { checkInAt: '2026-08-27T00:05:00.000Z' }),
    (error) => error.details?.code === 'ATTENDANCE_ADJUSTMENT_CONFIRM_TIMES_REQUIRED'
  );
  assert.throws(
    () => normalizeProposal('ADJUST_WORK_TIME', {
      checkInAt: '2026-08-27T02:00:00.000Z',
      checkOutAt: '2026-08-27T01:00:00.000Z'
    }),
    (error) => error.details?.code === 'ATTENDANCE_ADJUSTMENT_TIME_ORDER_INVALID'
  );
});

test('Attendance authority digest is stable and changes when effective authority changes', () => {
  const before = {
    assignmentId: 'a',
    effective: { checkInAt: '2026-08-27T00:00:00.000Z', checkOutAt: null },
    correctionIds: []
  };
  assert.equal(stableDigest(before), stableDigest({ ...before }));
  assert.notEqual(
    stableDigest(before),
    stableDigest({ ...before, effective: { ...before.effective, checkOutAt: '2026-08-27T12:00:00.000Z' } })
  );
});

test('Manager may make requests only inside own Department while Admin may make requests', () => {
  const assignment = { departmentSnapshot: 'OPS', employee: { department: 'OPS' } };
  assert.equal(assertMakerScope({ sub: 'm', role: 'MANAGER', department: 'OPS' }, assignment), 'MANAGER');
  assert.equal(assertMakerScope({ sub: 'a', role: 'ADMIN' }, assignment), 'ADMIN');
  assert.throws(
    () => assertMakerScope({ sub: 'm', role: 'MANAGER', department: 'OTHER' }, assignment),
    (error) => error.statusCode === 403 && error.details?.code === 'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN'
  );
});

test('Only ADMIN may execute approval decisions', () => {
  assert.doesNotThrow(() => assertAdmin({ sub: 'a', role: 'ADMIN' }));
  assert.throws(
    () => assertAdmin({ sub: 'm', role: 'MANAGER' }),
    (error) => error.statusCode === 403 && error.details?.code === 'ATTENDANCE_ADJUSTMENT_ADMIN_REQUIRED'
  );
});

test('Governed adjustment API keeps public direct correction fail-closed', () => {
  const adjustmentRoute = read('src/routes/attendance-adjustment.routes.js');
  const legacyGovernanceRoute = read('src/routes/attendance-governance.routes.js');
  const index = read('src/routes/index.js');
  const service = read('src/services/attendance-adjustment.service.js');

  assert.match(index, /router\.use\('\/attendance\/adjustment-requests', attendanceAdjustmentRoutes\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/approve', authorize\('ADMIN'\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/return', authorize\('ADMIN'\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/reject', authorize\('ADMIN'\)/);
  assert.match(legacyGovernanceRoute, /router\.post\('\/assignments\/:id\/corrections'[\s\S]*new HttpError\(404, 'Not found\.'\)/);
  assert.match(service, /status = 'PENDING_APPROVAL'/);
  assert.match(service, /INSERT INTO attendance_corrections/);
  assert.match(service, /STALE_ATTENDANCE_BASE/);
  assert.match(service, /source_adjustment_request_id/);
});
