
'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeProposal,
  stableDigest,
  attendanceCertificationLockKey,
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

test('Attendance approval shares the monthly certification advisory-lock namespace', () => {
  assert.equal(attendanceCertificationLockKey(new Date('2026-08-27T23:59:59.000Z')), 'attendance-cert:2026-08');
  const service = read('src/services/attendance-adjustment.service.js');
  const governance = read('src/services/attendance-month-governance.service.js');
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /attendanceCertificationLockKey\(assignment\.workDate\)/);
  assert.match(governance, /attendance-cert:\$\{period\.text\}/);
});

test('Manager and Supervisor may make cross-department requests within the seven-day window', () => {
  const assignment = { workDate: '2026-08-25', employeeId: 'employee-1', departmentSnapshot: 'OTHER' };
  const clock = () => new Date('2026-08-27T04:00:00.000Z');
  assert.equal(assertMakerScope({ sub: 'm', role: 'MANAGER', department: 'OPS' }, assignment, clock), 'MANAGER');
  assert.equal(assertMakerScope({ sub: 's', role: 'SUPERVISOR' }, assignment, clock), 'SUPERVISOR');
  assert.equal(assertMakerScope({ sub: 'a', role: 'ADMIN' }, { workDate: '2026-07-01' }, clock), 'ADMIN');
  assert.throws(
    () => assertMakerScope({ sub: 'm', role: 'MANAGER' }, { ...assignment, workDate: '2026-08-17' }, clock),
    (error) => error.statusCode === 403 && error.details?.code === 'ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN'
  );
});

test('Viewer requires employee authority and can adjust only its own shift', () => {
  const clock = () => new Date('2026-08-27T04:00:00.000Z');
  const own = { workDate: '2026-08-25', employeeId: 'employee-1' };
  assert.equal(assertMakerScope({ sub: 'v', role: 'VIEWER', employeeAuthority: { id: 'employee-1' } }, own, clock), 'VIEWER');
  assert.throws(() => assertMakerScope({ sub: 'v', role: 'VIEWER' }, own, clock), (error) => error.statusCode === 403);
  assert.throws(() => assertMakerScope({ sub: 'v', role: 'VIEWER', employeeAuthority: { id: 'employee-1' } }, { ...own, employeeId: 'employee-2' }, clock), (error) => error.statusCode === 403);
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
  const correctionService = read('src/services/attendance-correction.service.js');
  const authorityMigration = read('prisma/migrations/202608270002_attendance_effective_correction_authority_v4/migration.sql');

  assert.match(index, /router\.use\('\/attendance\/adjustment-requests', attendanceAdjustmentRoutes\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/approve', authorize\('ADMIN'\)/);
  // OWNER policy (18 Oct 2026): every stage may return for correction, so the route allows the
  // reviewer roles; approve/reject stay ADMIN-only and the service enforces the stage.
  assert.match(adjustmentRoute, /router\.post\('\/:id\/review', authorize\('ADMIN', 'MANAGER', 'SUPERVISOR'\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/return', authorize\('ADMIN', 'MANAGER', 'SUPERVISOR'\)/);
  assert.match(adjustmentRoute, /router\.post\('\/:id\/reject', authorize\('ADMIN'\)/);
  assert.match(legacyGovernanceRoute, /router\.post\('\/assignments\/:id\/corrections'[\s\S]*new HttpError\(404, 'Not found\.'\)/);
  // OWNER policy (18 Oct 2026): submissions route to the first reviewer above the maker.
  assert.match(service, /const nextStatus = nextStageForMaker\(request\.makerRoleSnapshot\)/);
  assert.match(service, /SET status = \$\{nextStatus\}/);
  assert.match(service, /INSERT INTO attendance_corrections/);
  assert.match(service, /STALE_ATTENDANCE_BASE/);
  assert.match(service, /source_adjustment_request_id/);
  assert.match(correctionService, /ATTENDANCE_CORRECTION_DIRECT_WRITE_DISABLED/);
  assert.match(correctionService, /source_adjustment_request_id IS NOT NULL/);
  assert.match(correctionService, /approved_by_user_id IS NOT NULL/);
  assert.match(correctionService, /approved_at IS NOT NULL/);
  assert.match(authorityMigration, /attendance_corrections_current_requires_approval/);
  assert.match(authorityMigration, /"is_current" = FALSE/);
  assert.match(authorityMigration, /"source_adjustment_request_id" IS NOT NULL/);
  assert.match(authorityMigration, /"source_adjustment_revision" IS NOT NULL/);
  assert.match(authorityMigration, /"approved_by_user_id" IS NOT NULL/);
  assert.match(authorityMigration, /"approved_at" IS NOT NULL/);
});
