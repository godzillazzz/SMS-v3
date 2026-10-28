'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:***@127.0.0.1:5433/sms_v3_test';
process.env.JWT_SECRET ||= 'test-only-jwt-secret-value-012345678901234567890123456789';
const { createApprovalCenterService } = require('../src/services/approval-center.service');
const { REQUEST_TYPE_DEFINITIONS, defaultPolicyFor } = require('../src/services/approval-policy.service');

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = { role: 'ADMIN', sub: 'admin-1' };
const NOW = new Date('2026-10-28T13:00:00.000Z');

function policies() {
  return { loadPolicies: async () => new Map(REQUEST_TYPE_DEFINITIONS.map((definition) => [definition.type, defaultPolicyFor(definition)])) };
}

function emptyModel() {
  return { count: async () => 0, findMany: async () => [], findFirst: async () => null, groupBy: async () => [] };
}

test('approval queue maps attendance before/proposed times into reviewer metadata without an extra detail query', async () => {
  let listCalls = 0;
  const adjustment = {
    id: ID, status: 'PENDING_ADMIN', employeeId: 'employee-1', employeeCode: 'EMP001', employeeName: 'พนักงาน ทดสอบ', department: 'WCS',
    makerUserId: 'maker-1', makerDisplayName: 'ผู้ส่ง', makerRoleSnapshot: 'MANAGER', currentRevision: 2,
    requestType: 'ADJUST_WORK_TIME', workDate: '2026-10-26', reason: 'แก้ไขเวลาตามหลักฐาน', createdAt: NOW, updatedAt: NOW,
    beforeSnapshot: { effective: { checkInAt: '2026-10-26T00:01:00.000Z', checkOutAt: '2026-10-26T10:02:00.000Z' } },
    currentProposal: { checkInAt: '2026-10-26T00:30:00.000Z', checkOutAt: '2026-10-26T10:30:00.000Z' }
  };
  const model = emptyModel();
  const prisma = {
    employeeChangeRequest: model, employeeReferencePhoto: model, employeeLicenseDocument: model,
    attendanceDeviceChangeRequest: model, registrationRequest: model, user: { ...model, findUnique: async () => null },
    leaveRequest: model, scheduleApproval: model, systemSetting: { findMany: async () => [] }
  };
  const service = createApprovalCenterService({
    prisma, approvalPolicyService: policies(), clock: () => NOW,
    attendanceAdjustmentList: async () => { listCalls += 1; return { data: [adjustment], meta: { total: 1 } }; }
  });
  const result = await service.list({ actor: ACTOR, onlyType: 'ATTENDANCE_ADJUSTMENT_REQUEST', limit: 100 });
  assert.equal(listCalls, 1);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0].metadata, {
    requestType: 'ADJUST_WORK_TIME', workDate: '2026-10-26', revision: 2, reason: 'แก้ไขเวลาตามหลักฐาน',
    originalCheckInAt: '2026-10-26T00:01:00.000Z', originalCheckOutAt: '2026-10-26T10:02:00.000Z',
    proposedCheckInAt: '2026-10-26T00:30:00.000Z', proposedCheckOutAt: '2026-10-26T10:30:00.000Z'
  });
});
