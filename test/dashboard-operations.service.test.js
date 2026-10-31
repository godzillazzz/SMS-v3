'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:***@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOperationsToday, createDashboardOperationsService } = require('../src/services/dashboard-operations.service');

// 2026-10-31 09:30 Asia/Bangkok
const NOW = new Date('2026-10-31T02:30:00.000Z');
const DAY = new Date('2026-10-31T00:00:00.000Z');
const SITE_A = { id: 'sA', name: 'ไซต์ A' };
const SITE_B = { id: 'sB', name: 'ไซต์ B' };
const shift = (code, startTime, endTime) => ({ code, startTime, endTime });
const DAY_SHIFT = shift('D', '08:00', '20:00');
const LATE_SHIFT = shift('L', '10:00', '22:00');
const OFF = shift('OFF', null, null);

function checkIn({ at = '2026-10-31T01:05:00.000Z', support = false, state = 'ACTIVE', expectedSiteId = 'sA' } = {}) {
  return { state: 'OPEN', expectedSiteId, voidedAt: null, events: [{ eventType: 'CHECK_IN', state, voidedAt: null, effectiveEventAt: at, locationEvidence: support ? { workSiteContext: 'SUPPORT_SITE' } : { workSiteContext: 'ASSIGNED_SITE' } }] };
}
function assignment(id, employeeId, site, shiftType, sessions = []) {
  return { id, employeeId, workDate: DAY, securitySiteId: site?.id ?? null, securitySite: site, shiftType, startTime: null, endTime: null, attendanceSession: sessions };
}

test('KPI definitions: distinct people, approved leave excluded, late = past start+grace without check-in', () => {
  const result = buildOperationsToday({
    now: NOW,
    graceMinutes: 15,
    assignments: [
      assignment('a1', 'e1', SITE_A, DAY_SHIFT, [checkIn()]),
      assignment('a1-dup', 'e1', SITE_A, DAY_SHIFT, [checkIn()]),
      assignment('a2', 'e2', SITE_A, DAY_SHIFT, []),
      assignment('a3', 'e3', SITE_B, DAY_SHIFT, [checkIn({ support: true })]),
      assignment('a4', 'e4', SITE_B, LATE_SHIFT, []),
      assignment('a5', 'e5', SITE_B, DAY_SHIFT, []),
      assignment('a6', 'e6', SITE_B, OFF, []),
      assignment('a7', 'e7', SITE_A, DAY_SHIFT, [checkIn({ state: 'VOIDED' })])
    ],
    approvedLeaves: [{ employeeId: 'e5', startDate: DAY, endDate: DAY }],
    checkpoints: [{ id: 'c1', department: 'X' }, { id: 'c2', department: 'X' }, { id: 'c3', department: 'Y' }],
    scans: [{ checkpointId: 'c1', scannedAt: '2026-10-31T01:10:00.000Z' }, { checkpointId: 'c1', scannedAt: '2026-10-31T01:20:00.000Z' }, { checkpointId: 'c3', scannedAt: '2026-10-30T23:00:00.000Z' }],
    pendingLeaveCount: 2
  });
  assert.equal(result.planned, 5); // e1,e2,e3,e4,e7 (e5 leave, e6 OFF)
  assert.equal(result.checkedIn, 2); // e1,e3 (e7 voided)
  assert.equal(result.lateNotCheckedIn, 2); // e2,e7 (e4 starts 10:00)
  assert.equal(result.assistOtherSite, 1);
  assert.equal(result.onLeave, 1);
  assert.deepEqual(result.patrol, { scanned: 1, total: 3, round: 1, roundStart: '2026-10-31T00:00:00.000Z', roundEnd: '2026-10-31T03:00:00.000Z', incompleteDepartments: [{ department: 'X', missing: 1 }, { department: 'Y', missing: 1 }] });
  assert.equal(result.pendingLeave, 2);
  const siteA = result.sites.find((site) => site.id === 'sA');
  const siteB = result.sites.find((site) => site.id === 'sB');
  assert.deepEqual({ planned: siteA.planned, checkedIn: siteA.checkedIn, late: siteA.late, status: siteA.status }, { planned: 3, checkedIn: 1, late: 2, status: 'URGENT' });
  assert.deepEqual({ planned: siteB.planned, checkedIn: siteB.checkedIn, late: siteB.late, status: siteB.status }, { planned: 2, checkedIn: 1, late: 0, status: 'WATCH' });
  assert.deepEqual(result.actions.map((row) => row.type), ['LATE_NOT_CHECKED_IN', 'PATROL_INCOMPLETE', 'LEAVE_PENDING']);
  assert.equal(result.actions[0].severity, 'URGENT');
});

test('site is NORMAL when everyone due has checked in; actions empty when nothing pending', () => {
  const result = buildOperationsToday({ now: NOW, assignments: [assignment('a1', 'e1', SITE_A, DAY_SHIFT, [checkIn()])], approvedLeaves: [], checkpoints: [], scans: [], pendingLeaveCount: 0 });
  assert.equal(result.sites[0].status, 'NORMAL');
  assert.equal(result.patrol.total, 0);
  assert.deepEqual(result.actions, []);
});

test('service is restricted to ADMIN/MANAGER/SUPERVISOR and filters by site', async () => {
  const calls = [];
  const prisma = {
    shiftAssignment: { findMany: async (args) => { calls.push(args.where); return [assignment('a1', 'e1', SITE_A, DAY_SHIFT, [checkIn()])]; } },
    leaveRequest: { findMany: async () => [], count: async () => 3 },
    patrolCheckpoint: { findMany: async () => [] },
    patrolScan: { findMany: async () => [] },
    securitySite: { findMany: async () => [SITE_A, SITE_B] }
  };
  const service = createDashboardOperationsService({ prisma, clock: () => NOW });
  await assert.rejects(service.today({ actor: { role: 'VIEWER' } }), (error) => error.statusCode === 403);
  const result = await service.today({ actor: { role: 'MANAGER' }, siteId: 'sA' });
  assert.equal(calls[0].securitySiteId, 'sA');
  assert.equal(calls[0].workDate.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(result.pendingLeave, 3);
  assert.deepEqual(result.siteOptions, [{ id: 'sA', name: 'ไซต์ A' }, { id: 'sB', name: 'ไซต์ B' }]);
  assert.equal(result.date, '2026-10-31');
});

test('a failing source becomes a partial error, never a fake zero', async () => {
  const prisma = {
    shiftAssignment: { findMany: async () => [] },
    leaveRequest: { findMany: async () => [], count: async () => 0 },
    patrolCheckpoint: { findMany: async () => { throw new Error('db'); } },
    patrolScan: { findMany: async () => [] },
    securitySite: { findMany: async () => [] }
  };
  const result = await createDashboardOperationsService({ prisma, clock: () => NOW }).today({ actor: { role: 'ADMIN' } });
  assert.deepEqual(result.partialErrors, ['patrol']);
  assert.equal(result.patrol, null);
});

test('route /dashboard/operations-today is mounted behind authenticate + executive roles', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/routes/operations.routes.js'), 'utf8');
  const index = source.indexOf("router.get('/dashboard/operations-today', authorize('ADMIN', 'MANAGER', 'SUPERVISOR')");
  assert.ok(index > source.indexOf('router.use(authenticate);'));
});
