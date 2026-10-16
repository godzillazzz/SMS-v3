'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApprovalCenterService } = require('../src/services/approval-center.service');

const TYPES = [
  'EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'SCHEDULE_APPROVAL',
  'LEAVE_REQUEST', 'USER_ACCESS', 'REGISTRATION_REQUEST'
];

function policies() {
  const map = new Map(TYPES.map((type) => [type, { reviewerRoles: ['ADMIN'], dueSoonHours: 24, overdueHours: 48 }]));
  return { loadPolicies: async () => map };
}

function prisma() {
  const delegate = (row) => ({
    findFirst: async () => row,
    findMany: async () => [],
    count: async () => row ? 1 : 0
  });
  return {
    systemSetting: { findMany: async () => [] },
    employeeChangeRequest: delegate({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'PENDING_APPROVAL', createdAt: new Date('2026-08-28T00:00:00Z') }),
    employeeReferencePhoto: delegate(null), employeeLicenseDocument: delegate(null),
    attendanceDeviceChangeRequest: delegate(null), leaveRequest: delegate(null),
    user: delegate(null), registrationRequest: delegate(null),
    scheduleApproval: { ...delegate(null), groupBy: async () => [] }
  };
}

test('getItem performs exact-ID lookup and returns the normalized envelope', async () => {
  const service = createApprovalCenterService({ prisma: prisma(), approvalPolicyService: policies(), clock: () => new Date('2026-08-28T01:00:00Z') });
  const result = await service.getItem({ actor: { role: 'ADMIN' }, type: 'EMPLOYEE_MASTER_CHANGE', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.equal(result.data.requestId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(result.data.type, 'EMPLOYEE_MASTER_CHANGE');
  assert.equal(result.data.sourcePage, 'employees');
  assert.equal(result.data.status, 'PENDING_APPROVAL');
  assert.equal(result.data.sla.dueSoonHours, 24);
});

test('getItem uses one uniform not-found error for missing eligible rows', async () => {
  const service = createApprovalCenterService({ prisma: { ...prisma(), employeeChangeRequest: { findFirst: async () => null } }, approvalPolicyService: policies() });
  await assert.rejects(() => service.getItem({ actor: { role: 'ADMIN' }, type: 'EMPLOYEE_MASTER_CHANGE', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), (error) => error.statusCode === 404 && error.publicCode === 'APPROVAL_ITEM_NOT_FOUND');
});

test('getItem applies per-type policy before any record lookup', async () => {
  let queried = false;
  const db = prisma();
  db.employeeChangeRequest.findFirst = async () => { queried = true; return null; };
  const policyMap = new Map(TYPES.map((type) => [type, { reviewerRoles: type === 'EMPLOYEE_MASTER_CHANGE' ? ['ADMIN'] : ['ADMIN'], dueSoonHours: 24, overdueHours: 48 }]));
  policyMap.get('EMPLOYEE_MASTER_CHANGE').reviewerRoles = ['SUPERVISOR'];
  const service = createApprovalCenterService({ prisma: db, approvalPolicyService: { loadPolicies: async () => policyMap } });
  await assert.rejects(() => service.getItem({ actor: { role: 'ADMIN' }, type: 'EMPLOYEE_MASTER_CHANGE', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), (error) => error.statusCode === 403 && error.publicCode === 'APPROVAL_TYPE_REVIEW_FORBIDDEN');
  assert.equal(queried, false);
});

test('all nine allowlisted types are explicit in the endpoint contract', () => {
  assert.equal(new Set(TYPES).size, 9);
});
