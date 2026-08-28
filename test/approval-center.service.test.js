const test = require('node:test');
const assert = require('node:assert/strict');
const { createApprovalCenterService, approvalUrgency } = require('../src/services/approval-center.service');

test('approval urgency promotes pending work at 24h and 48h boundaries', () => {
  const now = new Date('2026-08-28T02:00:00.000Z');
  assert.deepEqual(approvalUrgency('2026-08-28T01:30:00.000Z', now), { ageHours: 0, urgency: 'NEW' });
  assert.deepEqual(approvalUrgency('2026-08-27T02:00:00.000Z', now), { ageHours: 24, urgency: 'DUE_SOON' });
  assert.deepEqual(approvalUrgency('2026-08-26T02:00:00.000Z', now), { ageHours: 48, urgency: 'OVERDUE' });
});

test('Approval Center aggregates Employee Master and Reference Photo pending queues for Admin', async () => {
  const prisma = {
    employeeChangeRequest: {
      count: async () => 1,
      findMany: async () => [{
        id: 'change-1', employeeId: 'employee-1', status: 'PENDING_APPROVAL', currentRevision: 2,
        createdAt: new Date('2026-08-27T01:00:00.000Z'),
        employee: { id: 'employee-1', employeeCode: 'E001', firstName: 'Somchai', lastName: 'Test', displayName: 'Somchai Test', department: 'PN', jobTitle: 'Guard' },
        requestOwner: { id: 'manager-1', displayName: 'Manager PN', role: 'MANAGER' },
        revisions: [{ revision: 2, changedFields: ['department'], submittedAt: new Date('2026-08-27T01:00:00.000Z') }]
      }]
    },
    employeeReferencePhoto: {
      count: async () => 1,
      findMany: async () => [{
        id: 'photo-1', employeeId: 'employee-2', status: 'PENDING_APPROVAL', safeDisplayFileName: 'employee.jpg',
        mimeType: 'image/jpeg', fileSize: 500000, imageWidth: 800, imageHeight: 800,
        uploadedByRoleSnapshot: 'MANAGER', uploadedAt: new Date('2026-08-26T01:00:00.000Z'),
        employee: { id: 'employee-2', employeeCode: 'E002', firstName: 'Suda', lastName: 'Test', displayName: 'Suda Test', department: 'PS', jobTitle: 'Guard' },
        uploadedBy: { id: 'manager-2', displayName: 'Manager PS', role: 'MANAGER' }
      }]
    }
  };
  const service = createApprovalCenterService({ prisma, clock: () => new Date('2026-08-28T02:00:00.000Z') });
  const result = await service.list({ actor: { role: 'ADMIN', sub: 'admin-1' }, limit: 100 });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.employeeMasterChanges, 1);
  assert.equal(result.summary.referencePhotos, 1);
  assert.equal(result.summary.overdue48h, 1);
  assert.equal(result.summary.dueSoon24h, 1);
  assert.equal(result.data[0].type, 'EMPLOYEE_REFERENCE_PHOTO');
  assert.equal(result.data[0].urgency, 'OVERDUE');
  assert.equal(result.data[1].type, 'EMPLOYEE_MASTER_CHANGE');
  assert.deepEqual(result.data[1].changedFields, ['department']);
});

test('Approval Center is Admin-only even when the route guard is bypassed', async () => {
  const service = createApprovalCenterService({ prisma: {} });
  await assert.rejects(() => service.list({ actor: { role: 'MANAGER' } }), (error) => error?.statusCode === 403 || error?.status === 403);
});
