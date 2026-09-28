'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

require.cache[require.resolve('../src/config/prisma')] = { exports: {} };
const personnelMasterPath = require.resolve('../src/services/personnel-master.service');
require.cache[personnelMasterPath] = { exports: { assertActiveValue: async (_client, _kind, value) => value } };

const {
  G06_UAT_EMPLOYEE_CODE,
  G06_UAT_ASSIGNMENT_SOURCE,
  createG06UatProvisioningService
} = require('../src/services/g06-uat-provisioning.service');

const now = new Date('2026-09-28T09:17:00.000Z');
const location = { latitude: 13.7563, longitude: 100.5018, accuracyMeters: 6, capturedAt: now.toISOString() };
const employee = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeCode: G06_UAT_EMPLOYEE_CODE,
  firstName: 'G06',
  lastName: 'Preview UAT',
  displayName: 'G06 Preview UAT',
  department: 'UAT-PREVIEW',
  jobTitle: 'Officer',
  isActive: true,
  deletedAt: null,
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'uat-g06-20260911-01@example.invalid',
    displayName: 'G06 Preview UAT',
    role: 'VIEWER',
    employeeId: '11111111-1111-4111-8111-111111111111',
    isActive: true,
    accountStatus: 'ACTIVE',
    passwordResetRequired: false
  }
};
const approval = { id: '33333333-3333-4333-8333-333333333333', month: new Date('2026-09-01T00:00:00.000Z'), status: 'APPROVED', revision: 2, updatedAt: now };
const shiftType = { id: '44444444-4444-4444-8444-444444444444', code: 'D', name: 'ZZZ UAT Day', startTime: '07:00', endTime: '19:00', hours: 12, isActive: true };
const site = { id: '55555555-5555-4555-8555-555555555555', code: 'SITE-A', name: 'Test Site', latitude: 13.7563, longitude: 100.5018, geofenceRadiusMeters: 100, isActive: true };

function harness({ existingAssignment = null, sites = [site], currentApproval = approval } = {}) {
  const calls = [];
  const audits = [];
  const tx = {
    employee: { findUnique: async () => employee },
    scheduleApproval: { findFirst: async () => currentApproval },
    shiftType: { findUnique: async () => shiftType },
    securitySite: { findMany: async () => sites },
    shiftAssignment: {
      findFirst: async () => existingAssignment,
      create: async ({ data }) => {
        calls.push(['shiftAssignment.create', data]);
        return { id: '66666666-6666-4666-8666-666666666666', ...data };
      }
    }
  };
  const prismaClient = { $transaction: async (callback) => callback(tx) };
  const service = createG06UatProvisioningService({
    prismaClient,
    auditService: { log: async (entry) => audits.push(entry) },
    environment: { VERCEL_ENV: 'preview', VERCEL_URL: 'preview.vercel.app' },
    verifyDatabaseTarget: () => ({ required: true, matched: true }),
    clock: () => now
  });
  return { service, calls, audits };
}

test('prepares one locked G06-only Shift Assignment at the confidently-inside active Site without changing monthly approval', async () => {
  const { service, calls, audits } = harness();
  const result = await service.prepareAttendanceAuthority({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location });
  assert.equal(result.idempotent, false);
  assert.equal(result.shift.code, 'D');
  assert.equal(result.site.code, 'SITE-A');
  assert.equal(result.approval.status, 'APPROVED');
  assert.equal(result.approval.revision, 2);
  assert.equal(calls.length, 1);
  const data = calls[0][1];
  assert.equal(data.employeeId, employee.id);
  assert.equal(data.shiftTypeId, shiftType.id);
  assert.equal(data.securitySiteId, site.id);
  assert.equal(data.source, G06_UAT_ASSIGNMENT_SOURCE);
  assert.equal(data.locked, true);
  assert.equal(data.workDate.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.productionChanged, false);
});

test('fails closed when GPS is not confidently inside any Active Security Site', async () => {
  const farSite = { ...site, latitude: 14.5, longitude: 101.5, geofenceRadiusMeters: 100 };
  const { service, calls } = harness({ sites: [farSite] });
  await assert.rejects(
    () => service.prepareAttendanceAuthority({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location }),
    (error) => error.statusCode === 409 && error.details?.code === 'G06_UAT_SITE_NOT_CONFIDENT_INSIDE'
  );
  assert.equal(calls.length, 0);
});

test('refuses to mutate when the current monthly Schedule is not already APPROVED', async () => {
  const { service, calls } = harness({ currentApproval: { ...approval, status: 'DRAFT' } });
  await assert.rejects(
    () => service.prepareAttendanceAuthority({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location }),
    (error) => error.statusCode === 409 && error.details?.code === 'G06_UAT_SCHEDULE_APPROVAL_REQUIRED'
  );
  assert.equal(calls.length, 0);
});

test('returns idempotently for the exact existing G06 assignment and never overwrites another assignment', async () => {
  const matching = {
    id: '77777777-7777-4777-8777-777777777777',
    employeeId: employee.id,
    shiftTypeId: shiftType.id,
    securitySiteId: site.id,
    workDate: new Date('2026-09-28T00:00:00.000Z'),
    startTime: shiftType.startTime,
    endTime: shiftType.endTime,
    source: G06_UAT_ASSIGNMENT_SOURCE,
    locked: true
  };
  const exact = harness({ existingAssignment: matching });
  const result = await exact.service.prepareAttendanceAuthority({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location });
  assert.equal(result.idempotent, true);
  assert.equal(exact.calls.length, 0);

  const conflicting = harness({ existingAssignment: { ...matching, source: 'SMS_V3' } });
  await assert.rejects(
    () => conflicting.service.prepareAttendanceAuthority({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location }),
    (error) => error.statusCode === 409 && error.details?.code === 'G06_UAT_ASSIGNMENT_CONFLICT'
  );
});
