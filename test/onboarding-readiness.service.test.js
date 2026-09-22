'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnboardingReadinessService } = require('../src/services/onboarding-readiness.service');

function baseEmployee(overrides = {}) { return { id: 'employee-1', isActive: true, department: 'Operations', jobTitle: 'Officer', user: { id: 'user-1', role: 'EMPLOYEE', isActive: true, accountStatus: 'ACTIVE' }, referencePhotos: [{ id: 'photo-1' }], attendanceDevices: [{ id: 'device-1', status: 'ACTIVE', proofVerifiedAt: new Date('2026-08-31T00:00:00Z') }], ...overrides }; }
function harness({ employee = baseEmployee(), assignment = { id: 'assignment-1', employeeId: 'employee-1', workDate: new Date('2026-09-02T00:00:00Z'), shiftType: { code: 'DAY', name: 'Day' }, securitySite: null }, approval = { status: 'APPROVED' }, site = { site: { id: 'site-1', code: 'HQ', name: 'HQ' }, source: 'DEPARTMENT_DEFAULT' } } = {}) {
  const listEmployee = {
    ...employee,
    employeeCode: 'EMP001',
    firstName: 'Test',
    lastName: 'Employee',
    shiftAssignments: assignment ? [assignment] : []
  };
  const prisma = {
    employee: { findFirst: async () => employee, findMany: async () => [listEmployee] },
    shiftAssignment: { findFirst: async () => assignment },
    scheduleApproval: {
      findFirst: async () => approval,
      findMany: async () => approval ? [{ ...approval, month: new Date('2026-09-01T00:00:00Z'), revision: 1, updatedAt: new Date('2026-09-01T00:00:00Z') }] : []
    }
  };
  const siteAuthorityService = { resolve: async () => site };
  return createOnboardingReadinessService({ prisma, siteAuthorityService, clock: () => new Date('2026-09-01T10:00:00Z') });
}

test('READY requires every authoritative onboarding prerequisite', async () => { const result = await harness().getEmployeeReadiness({ employeeId: 'employee-1' }); assert.equal(result.status, 'READY'); assert.equal(result.blockers.length, 0); assert.equal(result.checks.device.ready, true); assert.equal(result.checks.site.source, 'DEPARTMENT_DEFAULT'); });
test('missing account, photo, schedule and device remain explicit blockers', async () => { const service = harness({ employee: baseEmployee({ user: null, referencePhotos: [], attendanceDevices: [] }), assignment: null, approval: null, site: null }); const result = await service.getEmployeeReadiness({ employeeId: 'employee-1' }); assert.equal(result.status, 'NOT_READY'); assert.deepEqual(new Set(result.blockers.map((x) => x.code)), new Set(['ACCOUNT_REQUIRED','REFERENCE_PHOTO_REQUIRED','SCHEDULE_REQUIRED','ATTENDANCE_DEVICE_REQUIRED'])); });
test('unapproved schedule and unresolved site fail closed', async () => { const service = harness({ approval: { status: 'PENDING' }, site: null }); service.getEmployeeReadiness; const result = await service.getEmployeeReadiness({ employeeId: 'employee-1' }); assert.equal(result.status, 'NOT_READY'); assert.ok(result.blockers.some((x) => x.code === 'SCHEDULE_NOT_APPROVED')); assert.ok(result.blockers.some((x) => x.code === 'SITE_REQUIRED')); });
test('multiple active devices are an authority conflict, never READY', async () => { const employee = baseEmployee({ attendanceDevices: [{ id: 'd1', proofVerifiedAt: new Date() }, { id: 'd2', proofVerifiedAt: new Date() }] }); const result = await harness({ employee }).getEmployeeReadiness({ employeeId: 'employee-1' }); assert.equal(result.status, 'NOT_READY'); assert.equal(result.checks.device.activeCount, 2); });

test('readiness center aggregates server-authoritative READY and blocker counts', async () => { const result = await harness().listEmployeeReadiness({ limit: 50 }); assert.equal(result.summary.total, 1); assert.equal(result.summary.ready, 1); assert.equal(result.summary.notReady, 0); assert.equal(result.data[0].status, 'READY'); });

test('readiness center batches fifty employees without per-employee DB lookups', async () => {
  const workDate = new Date('2026-09-02T00:00:00Z');
  const employees = Array.from({ length: 50 }, (_, index) => ({
    id: `employee-${index + 1}`,
    employeeCode: `EMP${String(index + 1).padStart(3, '0')}`,
    firstName: 'Test',
    lastName: `Employee ${index + 1}`,
    department: 'Operations',
    jobTitle: 'Officer',
    isActive: true,
    user: { id: `user-${index + 1}`, role: 'EMPLOYEE', isActive: true, accountStatus: 'ACTIVE' },
    referencePhotos: [{ id: `photo-${index + 1}` }],
    attendanceDevices: [{ id: `device-${index + 1}`, status: 'ACTIVE', proofVerifiedAt: new Date('2026-08-31T00:00:00Z') }],
    shiftAssignments: [{ id: `assignment-${index + 1}`, employeeId: `employee-${index + 1}`, workDate, departmentSnapshot: 'Operations', securitySiteId: null, shiftType: { code: 'DAY', name: 'Day' }, securitySite: null }]
  }));
  let employeeFindFirstCalls = 0;
  let shiftFindFirstCalls = 0;
  let approvalFindManyCalls = 0;
  let siteResolveCalls = 0;
  const prisma = {
    employee: {
      findMany: async () => employees,
      findFirst: async () => { employeeFindFirstCalls += 1; throw new Error('list must not perform per-employee lookups'); }
    },
    shiftAssignment: { findFirst: async () => { shiftFindFirstCalls += 1; throw new Error('list must not perform per-employee shift lookups'); } },
    scheduleApproval: {
      findMany: async () => { approvalFindManyCalls += 1; return [{ month: new Date('2026-09-01T00:00:00Z'), status: 'APPROVED', revision: 1, updatedAt: new Date('2026-09-01T00:00:00Z') }]; }
    }
  };
  const siteAuthorityService = { resolve: async () => { siteResolveCalls += 1; return { site: { id: 'site-1', code: 'HQ', name: 'HQ' }, source: 'DEPARTMENT_DEFAULT' }; } };
  const service = createOnboardingReadinessService({ prisma, siteAuthorityService, clock: () => new Date('2026-09-01T10:00:00Z') });
  const result = await service.listEmployeeReadiness({ limit: 50 });
  assert.equal(result.summary.total, 50);
  assert.equal(result.summary.ready, 50);
  assert.equal(employeeFindFirstCalls, 0);
  assert.equal(shiftFindFirstCalls, 0);
  assert.equal(approvalFindManyCalls, 1);
  assert.equal(siteResolveCalls, 1);
});
