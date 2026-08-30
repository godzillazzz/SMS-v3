const test = require('node:test');
const assert = require('node:assert/strict');
const { createApprovalCenterService, approvalUrgency } = require('../src/services/approval-center.service');

const now = new Date('2026-08-28T02:00:00.000Z');
const employee = (id, code, jobTitle = 'Guard') => ({
  id, employeeCode: code, firstName: code, lastName: 'Test', displayName: code + ' Test', department: 'PN', jobTitle
});
const model = (rows) => ({
  count: async () => rows.length,
  findMany: async () => rows
});

function adminPrisma() {
  return {
    employeeChangeRequest: model([{
      id: 'change-1', employeeId: 'e1', status: 'PENDING_APPROVAL', currentRevision: 2, createdAt: new Date('2026-08-27T01:00:00.000Z'),
      employee: employee('e1', 'E001'), requestOwner: { id: 'm1', displayName: 'Manager 1', role: 'MANAGER' },
      revisions: [{ revision: 2, changedFields: ['department'], submittedAt: new Date('2026-08-27T01:00:00.000Z') }]
    }]),
    employeeReferencePhoto: model([{
      id: 'photo-1', employeeId: 'e2', status: 'PENDING_APPROVAL', safeDisplayFileName: 'photo.jpg', mimeType: 'image/jpeg',
      fileSize: 1000, imageWidth: 800, imageHeight: 800, uploadedByRoleSnapshot: 'MANAGER', uploadedAt: new Date('2026-08-26T01:00:00.000Z'),
      employee: employee('e2', 'E002'), uploadedBy: { id: 'm2', displayName: 'Manager 2', role: 'MANAGER' }
    }]),
    employeeLicenseDocument: model([{
      id: 'license-doc-1', employeeId: 'e3', licenseId: 'license-1', status: 'PENDING', uploadedAt: new Date('2026-08-28T00:00:00.000Z'),
      resubmittedAt: null, proposedStartDate: new Date('2026-09-01T00:00:00.000Z'), proposedExpiryDate: new Date('2027-08-31T00:00:00.000Z'),
      proposedLicenseNumber: 'LIC-NEW', version: 2, safeDisplayFileName: 'license.pdf', employee: employee('e3', 'E003'),
      uploadedBy: { id: 'm3', displayName: 'Manager 3', role: 'MANAGER' }, license: { licenseType: 'รปภ.', licenseNumber: 'LIC-OLD' }
    }]),
    attendanceDeviceChangeRequest: model([{
      id: 'device-1', status: 'PENDING_APPROVAL', requestType: 'REPLACEMENT', reason: 'replace phone',
      createdAt: new Date('2026-08-27T22:00:00.000Z'), employee: employee('e4', 'E004'),
      requestedBy: { id: 'u4', displayName: 'Employee 4', role: 'VIEWER' },
      candidateDevice: { displayName: 'Phone', platformHint: 'Android' }
    }]),
    registrationRequest: model([{
      id: 'reg-1', submittedName: 'สมัคร ใหม่', email: 'new@example.com', departmentHint: 'PN', status: 'MATCHED', emailVerifiedAt: new Date('2026-08-27T22:50:00.000Z'),
      createdAt: new Date('2026-08-27T23:00:00.000Z'), reviewedAt: null, matchedEmployee: employee('e5', 'E005')
    }]),
    user: {
      count: async () => 1,
      findMany: async () => [{
        id: 'user-1', displayName: 'Legacy Pending', email: 'legacy@example.com', role: 'VIEWER', department: 'PN',
        accountStatus: 'PENDING', requestedAt: new Date('2026-08-27T21:00:00.000Z'), createdAt: new Date('2026-08-27T21:00:00.000Z')
      }],
      findUnique: async () => null
    },
    leaveRequest: model([{
      id: 'leave-1', employeeId: 'e6', status: 'PENDING', requestedAt: new Date('2026-08-27T18:00:00.000Z'),
      employeeNameSnapshot: 'E006 Snapshot Name', createdAt: new Date('2026-08-27T18:00:00.000Z'), leaveType: 'SICK', startDate: new Date('2026-08-30T00:00:00.000Z'),
      endDate: new Date('2026-08-30T00:00:00.000Z'), dayCount: 1, departmentSnapshot: 'PN', createdByUserId: 'u6',
      employee: employee('e6', 'E006'), createdByUser: { id: 'u6', displayName: 'E006 Test', role: 'VIEWER' }
    }])
  };
}

test('approval urgency promotes pending work at 24h and 48h boundaries', () => {
  assert.deepEqual(approvalUrgency('2026-08-28T01:30:00.000Z', now), { ageHours: 0, urgency: 'NEW' });
  assert.deepEqual(approvalUrgency('2026-08-27T02:00:00.000Z', now), { ageHours: 24, urgency: 'DUE_SOON' });
  assert.deepEqual(approvalUrgency('2026-08-26T02:00:00.000Z', now), { ageHours: 48, urgency: 'OVERDUE' });
});

test('Approval Center aggregates every actionable Admin queue without changing source workflow authority', async () => {
  const service = createApprovalCenterService({
    prisma: adminPrisma(),
    clock: () => now,
    attendanceAdjustmentList: async () => ({
      data: [{
        id: 'adjust-1', status: 'PENDING_APPROVAL', employeeId: 'e7', employeeCode: 'E007', employeeName: 'E007 Test',
        department: 'PN', makerUserId: 'm7', makerDisplayName: 'Manager 7', makerRoleSnapshot: 'MANAGER',
        requestType: 'ADJUST_WORK_TIME', currentRevision: 1, workDate: '2026-08-27', reason: 'correct time',
        createdAt: new Date('2026-08-27T20:00:00.000Z'), updatedAt: new Date('2026-08-27T20:00:00.000Z')
      }],
      meta: { total: 1 }
    })
  });
  const result = await service.list({ actor: { role: 'ADMIN', sub: 'admin-1' }, limit: 100 });

  assert.equal(result.summary.total, 8);
  assert.deepEqual(new Set(result.data.map((item) => item.type)), new Set([
    'EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT',
    'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'REGISTRATION_REQUEST', 'USER_ACCESS', 'LEAVE_REQUEST'
  ]));
  assert.equal(result.summary.byType.LEAVE_REQUEST, 1);
  assert.equal(result.summary.byType.ATTENDANCE_ADJUSTMENT_REQUEST, 1);
  assert.equal(result.summary.scheduleApprovals, 0);
  assert.equal(result.summary.byType.SCHEDULE_APPROVAL, 0);
  assert.equal(result.data.find((item) => item.type === 'LICENSE_DOCUMENT').sourcePage, 'licenses');
  const registration = result.data.find((item) => item.type === 'REGISTRATION_REQUEST');
  assert.equal(registration.requestedBy.displayName, 'สมัคร ใหม่');
  assert.equal(registration.metadata.matchedEmployeeCode, 'E005');
  assert.equal(registration.metadata.matchedEmployeeName, 'E005 Test');
  const leave = result.data.find((item) => item.type === 'LEAVE_REQUEST');
  assert.equal(leave.employee.displayName, 'E006 Snapshot Name');
  assert.equal(leave.employee.department, 'PN');
});

test('Approval Center summary uses count-only queries for Admin badge polling', async () => {
  const prisma = adminPrisma();
  for (const key of ['employeeChangeRequest', 'employeeReferencePhoto', 'employeeLicenseDocument', 'attendanceDeviceChangeRequest', 'registrationRequest', 'leaveRequest']) {
    prisma[key].findMany = async () => { throw new Error('summary must not load detailed rows'); };
  }
  prisma.user.findMany = async () => { throw new Error('summary must not load detailed users'); };
  const service = createApprovalCenterService({
    prisma,
    clock: () => now,
    attendanceAdjustmentList: async ({ pageSize }) => {
      assert.equal(pageSize, 1);
      return { data: [], meta: { total: 1 } };
    }
  });

  const result = await service.summary({ actor: { role: 'ADMIN', sub: 'admin-1' } });
  assert.equal(result.summary.total, 8);
  assert.equal(result.summary.byType.ATTENDANCE_ADJUSTMENT_REQUEST, 1);
  assert.equal(result.summary.byType.LEAVE_REQUEST, 1);
});

test('Approval Center summary preserves Manager leave authority while using only minimal leave rows', async () => {
  const prisma = adminPrisma();
  prisma.user.findUnique = async () => ({ id: 'manager-1', employeeId: 'self-e', employee: { jobTitle: 'Guard Manager' } });
  prisma.registrationRequest.count = async () => 0;
  prisma.user.count = async () => 0;
  let leaveSelect;
  prisma.leaveRequest = {
    count: async () => { throw new Error('Manager summary must not use a raw leave count that ignores approval authority'); },
    findMany: async (args) => {
      leaveSelect = args.select;
      return [
        { employeeId: 'sup-e', startDate: now, employee: { jobTitle: 'Supervisor' } },
        { employeeId: 'guard-e', startDate: now, employee: { jobTitle: 'Guard' } }
      ];
    }
  };
  const service = createApprovalCenterService({ prisma, clock: () => now });
  const result = await service.summary({ actor: { role: 'MANAGER', sub: 'manager-1' } });
  assert.equal(result.summary.byType.LEAVE_REQUEST, 1);
  assert.deepEqual(leaveSelect, { employeeId: true, startDate: true, employee: { select: { jobTitle: true } } });
});

test('Approval Center excludes unverified registrations by using the source workflow reviewable predicate', async () => {
  const prisma = adminPrisma();
  let countWhere;
  let listWhere;
  prisma.registrationRequest = {
    count: async (args) => { countWhere = args.where; return 0; },
    findMany: async (args) => { listWhere = args.where; return []; }
  };
  prisma.user.count = async () => 0;
  prisma.user.findMany = async () => [];
  prisma.leaveRequest = model([]);
  prisma.employeeChangeRequest = model([]);
  prisma.employeeReferencePhoto = model([]);
  prisma.employeeLicenseDocument = model([]);
  prisma.attendanceDeviceChangeRequest = model([]);
  const service = createApprovalCenterService({ prisma, clock: () => now, attendanceAdjustmentList: async () => ({ data: [], meta: { total: 0 } }) });

  const result = await service.list({ actor: { role: 'ADMIN', sub: 'admin-1' } });

  assert.equal(countWhere, undefined, 'small queues should not pay for a redundant count query');
  assert.deepEqual(listWhere, { status: { in: ['PENDING', 'MATCHED'] }, emailVerifiedAt: { not: null } });
  assert.equal(result.summary.byType.REGISTRATION_REQUEST, 0);
  assert.equal(result.data.some((item) => item.type === 'REGISTRATION_REQUEST'), false);
});

test('Manager Approval Center contains only workflows Manager can act on', async () => {
  const prisma = adminPrisma();
  prisma.user.findUnique = async () => ({ id: 'manager-1', employeeId: 'manager-employee', employee: { jobTitle: 'Manager' } });
  const service = createApprovalCenterService({
    prisma,
    clock: () => now,
    attendanceAdjustmentList: async () => { throw new Error('Manager must not load Admin-only attendance adjustments'); }
  });
  const result = await service.list({ actor: { role: 'MANAGER', sub: 'manager-1' }, limit: 100 });

  assert.equal(result.summary.total, 3);
  assert.deepEqual(new Set(result.data.map((item) => item.type)), new Set(['REGISTRATION_REQUEST', 'USER_ACCESS', 'LEAVE_REQUEST']));
  assert.equal(result.summary.byType.EMPLOYEE_MASTER_CHANGE, 0);
  assert.equal(result.summary.byType.EMPLOYEE_REFERENCE_PHOTO, 0);
  assert.equal(result.summary.byType.LICENSE_DOCUMENT, 0);
  assert.equal(result.summary.byType.SCHEDULE_APPROVAL, 0);
  assert.equal(result.summary.byType.ATTENDANCE_DEVICE_REQUEST, 0);
  assert.equal(result.summary.byType.ATTENDANCE_ADJUSTMENT_REQUEST, 0);
});


test('Manager queue includes retroactive Supervisor leave because source authority permits Manager review', async () => {
  const prisma = adminPrisma();
  prisma.user.findUnique = async () => ({ id: 'manager-1', employeeId: 'self-e', employee: { jobTitle: 'Guard Manager' } });
  prisma.leaveRequest.count = async () => 1;
  prisma.leaveRequest.findMany = async () => [{
    id: 'retro-supervisor-leave', employeeId: 'sup-e', status: 'PENDING',
    requestedAt: new Date('2026-08-27T18:00:00.000Z'), createdAt: new Date('2026-08-27T18:00:00.000Z'),
    leaveType: 'SICK', startDate: new Date('2026-08-26T00:00:00.000Z'), endDate: new Date('2026-08-26T00:00:00.000Z'),
    dayCount: 1, employee: employee('sup-e', 'SUP', 'Supervisor'), createdByUser: null
  }];
  prisma.registrationRequest = model([]);
  prisma.user.count = async () => 0;
  prisma.user.findMany = async () => [];

  const service = createApprovalCenterService({ prisma, clock: () => now });
  const result = await service.list({ actor: { role: 'MANAGER', sub: 'manager-1' } });
  assert.equal(result.summary.byType.LEAVE_REQUEST, 1);
  assert.equal(result.data.find((item) => item.type === 'LEAVE_REQUEST').employee.employeeCode, 'SUP');
});

test('Manager queue excludes leave requests that require Admin authority or self approval', async () => {
  const prisma = adminPrisma();
  prisma.user.findUnique = async () => ({ id: 'manager-1', employeeId: 'self-e', employee: { jobTitle: 'Guard Manager' } });
  prisma.leaveRequest.count = async () => 2;
  prisma.leaveRequest.findMany = async () => [
    { id: 'supervisor-leave', employeeId: 'sup-e', status: 'PENDING', requestedAt: now, createdAt: now, leaveType: 'SICK', startDate: now, endDate: now, dayCount: 1, employee: employee('sup-e', 'SUP', 'Supervisor'), createdByUser: null },
    { id: 'guard-leave', employeeId: 'guard-e', status: 'PENDING', requestedAt: now, createdAt: now, leaveType: 'SICK', startDate: now, endDate: now, dayCount: 1, employee: employee('guard-e', 'GUARD', 'Guard'), createdByUser: null }
  ];
  prisma.registrationRequest = model([]);
  prisma.user.count = async () => 0;
  prisma.user.findMany = async () => [];

  const service = createApprovalCenterService({ prisma, clock: () => now });
  const result = await service.list({ actor: { role: 'MANAGER', sub: 'manager-1' } });
  assert.equal(result.summary.byType.LEAVE_REQUEST, 1);
  assert.equal(result.data.filter((item) => item.type === 'LEAVE_REQUEST').length, 1);
  assert.equal(result.data.find((item) => item.type === 'LEAVE_REQUEST').employee.employeeCode, 'GUARD');
});

test('Approval Center rejects Viewer even when the route guard is bypassed', async () => {
  const service = createApprovalCenterService({ prisma: {} });
  await assert.rejects(() => service.list({ actor: { role: 'VIEWER' } }), (error) => error?.statusCode === 403 || error?.status === 403);
});
