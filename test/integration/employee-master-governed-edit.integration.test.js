process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('Employee Master Governed Edit integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const audit = require('../../src/services/audit.service');
  const lifecycle = require('../../src/services/employee-lifecycle.service');
  const scheduleService = require('../../src/services/schedule.service');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { createEmployeeMasterMutationService, validateEffectiveTiming } = require('../../src/services/employee-master-mutation.service');
  const { createEmployeeChangeRequestService } = require('../../src/services/employee-change-request.service');
  const { ensureEmployeeOperationalForShift } = require('../../src/services/employee-operational-eligibility.service');
  const { commitEmployeeAutoSchedule } = require('../../src/services/auto-schedule.service');

  const clockNow = new Date('2026-08-21T02:00:00.000Z');
  const clock = () => new Date(clockNow);
  const ids = {
    admin: '93000000-0000-4000-8000-000000000001',
    manager: '93000000-0000-4000-8000-000000000002',
    manager2: '93000000-0000-4000-8000-000000000003',
    viewer: '93000000-0000-4000-8000-000000000004'
  };
  const actors = {
    admin: { sub: ids.admin, role: 'ADMIN' },
    manager: { sub: ids.manager, role: 'MANAGER' },
    manager2: { sub: ids.manager2, role: 'MANAGER' },
    viewer: { sub: ids.viewer, role: 'VIEWER' }
  };
  let serial = 0;

  const master = (auditService = audit, at = clock) => createEmployeeMasterMutationService({ prismaClient: prisma, auditService, clock: at });
  const changes = (auditService = audit, at = clock) => createEmployeeChangeRequestService({ prismaClient: prisma, auditService, clock: at });
  const lifecycleService = (at = clock, auditService = audit) => lifecycle.createEmployeeLifecycleService({ prismaClient: prisma, auditService, clock: at });

  async function cleanup() {
    const employees = await prisma.employee.findMany({ where: { employeeCode: { startsWith: 'GOV-' } }, select: { id: true } });
    const employeeIds = employees.map((row) => row.id);
    const requests = employeeIds.length ? await prisma.employeeChangeRequest.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } }) : [];
    const requestIds = requests.map((row) => row.id);
    const userRows = await prisma.user.findMany({ where: { OR: [{ id: { in: Object.values(ids) } }, { email: { endsWith: '@gov.integration.test' } }] }, select: { id: true } });
    const userIds = userRows.map((row) => row.id);
    if (employeeIds.length) {
      await prisma.leaveAttachment.deleteMany({ where: { leaveRequest: { employeeId: { in: employeeIds } } } });
      await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.leaveQuota.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.employeeLicenseDocument.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.employeeLicense.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.registrationRequest.updateMany({ where: { matchedEmployeeId: { in: employeeIds } }, data: { matchedEmployeeId: null } });
    }
    if (requestIds.length) await prisma.employeeChangeRequestEvent.deleteMany({ where: { requestId: { in: requestIds } } });
    if (employeeIds.length) await prisma.employeeLifecycleEvent.deleteMany({ where: { employeeId: { in: employeeIds } } });
    if (requestIds.length) {
      await prisma.employeeChangeRequestRevision.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.employeeChangeRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    if (userIds.length) await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scheduleApproval.deleteMany({ where: { changedByLegacyRef: { in: [ids.admin, ids.manager] } } });
    if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (employeeIds.length) await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }

  async function setupActors() {
    for (const shift of [
      { code: 'D', name: 'Governed Day Shift', startTime: '07:00', endTime: '19:00', hours: 12, color: '#2563eb' },
      { code: 'N', name: 'Night Shift', startTime: '19:00', endTime: '07:00', hours: 12, color: '#8b5cf6' },
      { code: 'OFF', name: 'Off Day', startTime: '', endTime: '', hours: 0, color: '#64748b' },
      { code: 'AL', name: 'Approved Leave', startTime: '', endTime: '', hours: 0, color: '#ef4444' }
    ]) await prisma.shiftType.upsert({ where: { code: shift.code }, update: {}, create: shift });
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'admin@gov.integration.test', passwordHash: 'unused', displayName: 'Governed Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'manager@gov.integration.test', passwordHash: 'unused', displayName: 'Governed Manager', role: 'MANAGER', isActive: true },
      { id: ids.manager2, email: 'manager2@gov.integration.test', passwordHash: 'unused', displayName: 'Governed Manager 2', role: 'MANAGER', isActive: true },
      { id: ids.viewer, email: 'viewer@gov.integration.test', passwordHash: 'unused', displayName: 'Governed Viewer', role: 'VIEWER', isActive: true }
    ] });
  }

  async function newEmployee(label = 'EMP', overrides = {}) {
    serial += 1;
    const safe = String(label).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'EMP';
    return prisma.employee.create({ data: {
      employeeCode: `GOV-${serial}-${safe}`,
      firstName: `Gov${serial}`,
      lastName: 'Employee',
      displayName: `Gov${serial} Employee`,
      department: 'Operations',
      jobTitle: 'Officer',
      isActive: true,
      ...overrides
    } });
  }

  async function linkedUser(employee, overrides = {}) {
    const id = randomUUID();
    return prisma.user.create({ data: {
      id,
      email: `linked-${serial}-${id.slice(0, 6)}@gov.integration.test`,
      passwordHash: 'unused',
      displayName: employee.displayName || `${employee.firstName} ${employee.lastName}`,
      role: 'VIEWER',
      isActive: true,
      accountStatus: 'ACTIVE',
      employeeId: employee.id,
      department: employee.department,
      ...overrides
    } });
  }

  async function tokenFor(id) { return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } })); }

  async function submitRequest(employee, proposal = { department: 'Safety' }, options = {}) {
    const service = changes();
    const draft = await service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal, effectiveMode: options.effectiveMode || 'IMMEDIATE', effectiveDate: options.effectiveDate || null, reason: options.reason || null, idempotencyKey: randomUUID() });
    const submitted = await service.submit({ id: draft.id, actor: actors.manager, idempotencyKey: randomUUID() });
    return { service, draft, submitted: submitted.request };
  }

  async function adminEdit(employee, proposed, options = {}) {
    const service = master();
    const analysis = await service.preflight({ employeeId: employee.id, actorRole: 'ADMIN', fieldScope: 'ADMIN', changes: proposed, effectiveMode: options.effectiveMode || 'IMMEDIATE', effectiveDate: options.effectiveDate || null, reason: options.reason || null });
    const result = await service.mutate({ employeeId: employee.id, actorUserId: ids.admin, actorRole: 'ADMIN', fieldScope: 'ADMIN', changes: proposed, effectiveMode: options.effectiveMode || 'IMMEDIATE', effectiveDate: options.effectiveDate || null, reason: options.reason || null, expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: analysis.latestLifecycleSequence, idempotencyKey: options.idempotencyKey || randomUUID(), acknowledgeWarnings: true });
    return { analysis, result };
  }

  async function validLicense(employee) {
    return prisma.employeeLicense.create({ data: { legacyLicenseId: `GOV-LIC-${serial}-${randomUUID().slice(0, 6)}`, employeeId: employee.id, licenseType: 'Security', licenseNumber: `LIC-${serial}`, issueDate: new Date('2026-01-01T00:00:00Z'), expiryDate: new Date('2027-12-31T00:00:00Z'), status: 'Active' } });
  }

  async function shiftType(code) { return prisma.shiftType.findUniqueOrThrow({ where: { code } }); }

  async function rawShift(employee, dateText, code = 'D', overrides = {}) {
    const type = await shiftType(code);
    return prisma.shiftAssignment.create({ data: { employeeId: employee.id, shiftTypeId: type.id, workDate: new Date(`${dateText}T00:00:00Z`), employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, startTime: type.startTime, endTime: type.endTime, hours: type.hours, source: 'GOV_TEST', locked: false, licenseStatus: code === 'OFF' || code === 'AL' ? 'NOT_REQUIRED' : 'VALID', ...overrides } });
  }

  test.beforeEach(async () => { await cleanup(); await setupActors(); });
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('01 ADMIN direct immediate edit applies exactly once with lifecycle and audit history', async () => {
    const employee = await newEmployee('admin-now');
    const key = randomUUID();
    const first = await adminEdit(employee, { phone: '0800000001' }, { idempotencyKey: key });
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    assert.equal(stored.phone, '0800000001');
    assert.equal(first.result.applied, true);
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { employeeId: employee.id, type: 'MASTER_EDIT' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'Employee', entityId: employee.id, action: 'UPDATE' } }), 1);
  });

  test('02 ADMIN stale expectedEmployeeUpdatedAt is rejected before mutation', async () => {
    const employee = await newEmployee('admin-stale');
    const service = master();
    const analysis = await service.preflight({ employeeId: employee.id, actorRole: 'ADMIN', changes: { phone: '0800000002' } });
    await prisma.employee.update({ where: { id: employee.id }, data: { jobTitle: 'Changed elsewhere' } });
    await assert.rejects(() => service.mutate({ employeeId: employee.id, actorUserId: ids.admin, actorRole: 'ADMIN', changes: { phone: '0800000002' }, expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: analysis.latestLifecycleSequence, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_STATE_CONFLICT');
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).phone, null);
  });

  test('03 MANAGER explicitly creates DRAFT and activeEmployeeId is reserved', async () => {
    const employee = await newEmployee('draft');
    const draft = await changes().createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { department: 'Safety' }, idempotencyKey: randomUUID() });
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.activeEmployeeId, employee.id);
    assert.equal(draft.requestOwnerUserId, ids.manager);
  });

  test('04 reading/opening governed editor data does not create DRAFT', async () => {
    const employee = await newEmployee('open');
    const token = await tokenFor(ids.manager);
    const before = await prisma.employeeChangeRequest.count({ where: { employeeId: employee.id } });
    const response = await request(app).get(`/api/v1/employees/${employee.id}/change-requests`).set('Authorization', `Bearer ${token}`);
    const after = await prisma.employeeChangeRequest.count({ where: { employeeId: employee.id } });
    assert.equal(response.status, 200);
    assert.equal(before, 0);
    assert.equal(after, 0);
  });

  test('05 Manager submit creates immutable Revision 1', async () => {
    const employee = await newEmployee('rev1');
    const { submitted } = await submitRequest(employee);
    const revisions = await prisma.employeeChangeRequestRevision.findMany({ where: { requestId: submitted.id } });
    assert.equal(submitted.currentRevision, 1);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].revision, 1);
  });

  test('06 Manager submit does not mutate authoritative Employee', async () => {
    const employee = await newEmployee('submit-no-mut');
    await submitRequest(employee, { department: 'Safety' });
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
  });

  test('07 one active request is enforced by database-backed activeEmployeeId uniqueness', async () => {
    const employee = await newEmployee('one-active');
    const service = changes();
    await service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { department: 'Safety' }, idempotencyKey: randomUUID() });
    await assert.rejects(() => service.createDraft({ employeeId: employee.id, actor: actors.manager2, proposal: { jobTitle: 'Supervisor' }, idempotencyKey: randomUUID() }), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_CHANGE_ACTIVE_REQUEST_EXISTS');
    assert.equal(await prisma.employeeChangeRequest.count({ where: { employeeId: employee.id, activeEmployeeId: employee.id } }), 1);
  });

  test('08 concurrent active request creation has exactly one winner', async () => {
    const employee = await newEmployee('concurrent');
    const service = changes();
    const results = await Promise.allSettled([
      service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { department: 'Safety' }, idempotencyKey: randomUUID() }),
      service.createDraft({ employeeId: employee.id, actor: actors.manager2, proposal: { jobTitle: 'Supervisor' }, idempotencyKey: randomUUID() })
    ]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(results.filter((row) => row.status === 'rejected').length, 1);
    assert.equal(await prisma.employeeChangeRequest.count({ where: { employeeId: employee.id, activeEmployeeId: employee.id } }), 1);
  });

  test('09 Admin approve applies Manager revision exactly once', async () => {
    const employee = await newEmployee('approve');
    const { service, submitted } = await submitRequest(employee);
    const approved = await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    assert.equal(approved.request.status, 'APPROVED');
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Safety');
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { sourceChangeRequestId: submitted.id } }), 1);
  });

  test('10 duplicate Admin approve retry does not double apply/event/audit', async () => {
    const employee = await newEmployee('approve-retry');
    const { service, submitted } = await submitRequest(employee);
    const key = randomUUID();
    await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: key, acknowledgeWarnings: true });
    const duplicate = await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: key, acknowledgeWarnings: true });
    assert.equal(duplicate.idempotent, true);
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { sourceChangeRequestId: submitted.id } }), 1);
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'APPROVE' } }), 1);
  });

  test('11 Admin Return leaves Employee unchanged and request recoverable', async () => {
    const employee = await newEmployee('return');
    const { service, submitted } = await submitRequest(employee);
    const returned = await service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: 'Please verify department', idempotencyKey: randomUUID() });
    assert.equal(returned.status, 'RETURNED_FOR_CORRECTION');
    assert.equal(returned.activeEmployeeId, employee.id);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
  });

  test('12 Return requires reviewer comment', async () => {
    const employee = await newEmployee('return-comment');
    const { service, submitted } = await submitRequest(employee);
    await assert.rejects(() => service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: '', idempotencyKey: randomUUID() }), (error) => error.details?.code === 'EMPLOYEE_CHANGE_RETURN_COMMENT_REQUIRED');
  });

  test('13 Manager edits returned working draft', async () => {
    const employee = await newEmployee('edit-returned');
    const { service, submitted } = await submitRequest(employee);
    await service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: 'Please correct', idempotencyKey: randomUUID() });
    const edited = await service.saveDraft({ id: submitted.id, actor: actors.manager, proposal: { department: 'Security' }, reason: 'Corrected department', idempotencyKey: randomUUID() });
    assert.equal(edited.status, 'RETURNED_FOR_CORRECTION');
    assert.equal(edited.draftProposal.department, 'Security');
  });

  test('14 Revision 1 remains immutable after returned draft edit', async () => {
    const employee = await newEmployee('immutable');
    const { service, submitted } = await submitRequest(employee, { department: 'Safety' });
    const before = await prisma.employeeChangeRequestRevision.findUniqueOrThrow({ where: { requestId_revision: { requestId: submitted.id, revision: 1 } } });
    await service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: 'Please correct', idempotencyKey: randomUUID() });
    await service.saveDraft({ id: submitted.id, actor: actors.manager, proposal: { department: 'Security' }, idempotencyKey: randomUUID() });
    const after = await prisma.employeeChangeRequestRevision.findUniqueOrThrow({ where: { requestId_revision: { requestId: submitted.id, revision: 1 } } });
    assert.deepEqual(after.afterSnapshot, before.afterSnapshot);
    assert.equal(after.proposalHash, before.proposalHash);
  });

  test('15 Resubmit creates Revision 2 and preserves Revision 1', async () => {
    const employee = await newEmployee('rev2');
    const { service, submitted } = await submitRequest(employee, { department: 'Safety' });
    await service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: 'Use correct department', idempotencyKey: randomUUID() });
    await service.saveDraft({ id: submitted.id, actor: actors.manager, proposal: { department: 'Security' }, idempotencyKey: randomUUID() });
    const resubmitted = await service.resubmit({ id: submitted.id, actor: actors.manager, idempotencyKey: randomUUID() });
    const revisions = await prisma.employeeChangeRequestRevision.findMany({ where: { requestId: submitted.id }, orderBy: { revision: 'asc' } });
    assert.equal(resubmitted.request.currentRevision, 2);
    assert.deepEqual(revisions.map((row) => row.revision), [1, 2]);
    assert.equal(revisions[0].afterSnapshot.department, 'Safety');
    assert.equal(revisions[1].afterSnapshot.department, 'Security');
  });

  test('16 Reject is terminal and mutates no Employee data', async () => {
    const employee = await newEmployee('reject');
    const { service, submitted } = await submitRequest(employee);
    const rejected = await service.reject({ id: submitted.id, actor: actors.admin, reason: 'Business rule not satisfied', idempotencyKey: randomUUID() });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.activeEmployeeId, null);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
  });

  test('17 Rejection reason is required', async () => {
    const employee = await newEmployee('reject-reason');
    const { service, submitted } = await submitRequest(employee);
    await assert.rejects(() => service.reject({ id: submitted.id, actor: actors.admin, reason: '', idempotencyKey: randomUUID() }), (error) => error.details?.code === 'EMPLOYEE_CHANGE_REJECTION_REASON_REQUIRED');
  });

  test('18 request owner can cancel DRAFT', async () => {
    const employee = await newEmployee('cancel-draft');
    const service = changes();
    const draft = await service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { department: 'Safety' }, idempotencyKey: randomUUID() });
    const cancelled = await service.cancel({ id: draft.id, actor: actors.manager, idempotencyKey: randomUUID() });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.activeEmployeeId, null);
  });

  test('19 request owner can cancel PENDING_APPROVAL', async () => {
    const employee = await newEmployee('cancel-pending');
    const { service, submitted } = await submitRequest(employee);
    const cancelled = await service.cancel({ id: submitted.id, actor: actors.manager, idempotencyKey: randomUUID() });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
  });

  test('20 request owner can cancel RETURNED_FOR_CORRECTION', async () => {
    const employee = await newEmployee('cancel-returned');
    const { service, submitted } = await submitRequest(employee);
    await service.returnForCorrection({ id: submitted.id, actor: actors.admin, comment: 'Please correct', idempotencyKey: randomUUID() });
    const cancelled = await service.cancel({ id: submitted.id, actor: actors.manager, idempotencyKey: randomUUID() });
    assert.equal(cancelled.status, 'CANCELLED');
  });

  test('21 non-owner Manager cannot cancel request', async () => {
    const employee = await newEmployee('cancel-owner');
    const service = changes();
    const draft = await service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { department: 'Safety' }, idempotencyKey: randomUUID() });
    await assert.rejects(() => service.cancel({ id: draft.id, actor: actors.manager2, idempotencyKey: randomUUID() }), (error) => error.statusCode === 403 && error.details?.code === 'EMPLOYEE_CHANGE_NOT_REQUEST_OWNER');
  });

  test('22 Manager cannot approve', async () => {
    const employee = await newEmployee('mgr-approve');
    const { service, submitted } = await submitRequest(employee);
    await assert.rejects(() => service.approve({ id: submitted.id, actor: actors.manager, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 403 && error.details?.code === 'EMPLOYEE_CHANGE_ADMIN_REVIEW_REQUIRED');
  });

  test('23 Manager cannot return request for correction', async () => {
    const employee = await newEmployee('mgr-return');
    const { service, submitted } = await submitRequest(employee);
    await assert.rejects(() => service.returnForCorrection({ id: submitted.id, actor: actors.manager, comment: 'No authority', idempotencyKey: randomUUID() }), (error) => error.statusCode === 403 && error.details?.code === 'EMPLOYEE_CHANGE_ADMIN_REVIEW_REQUIRED');
  });

  test('24 Manager cannot reject', async () => {
    const employee = await newEmployee('mgr-reject');
    const { service, submitted } = await submitRequest(employee);
    await assert.rejects(() => service.reject({ id: submitted.id, actor: actors.manager, reason: 'No authority', idempotencyKey: randomUUID() }), (error) => error.statusCode === 403 && error.details?.code === 'EMPLOYEE_CHANGE_ADMIN_REVIEW_REQUIRED');
  });

  test('25 Viewer workflow mutation is blocked by HTTP RBAC', async () => {
    const employee = await newEmployee('viewer');
    const token = await tokenFor(ids.viewer);
    const response = await request(app).post(`/api/v1/employees/${employee.id}/change-requests`).set('Authorization', `Bearer ${token}`).send({ proposal: { department: 'Safety' }, effectiveMode: 'IMMEDIATE', idempotencyKey: randomUUID() });
    assert.equal(response.status, 403);
    assert.equal(await prisma.employeeChangeRequest.count({ where: { employeeId: employee.id } }), 0);
  });

  test('26 Manager old PUT direct-edit bypass is blocked with EMPLOYEE_CHANGE_REQUEST_REQUIRED', async () => {
    const employee = await newEmployee('put-bypass');
    const token = await tokenFor(ids.manager);
    const response = await request(app).put(`/api/v1/employees/${employee.id}`).set('Authorization', `Bearer ${token}`).send({ changes: { department: 'Safety' }, effectiveMode: 'IMMEDIATE', expectedEmployeeUpdatedAt: employee.updatedAt.toISOString(), expectedLifecycleSequence: 0, idempotencyKey: randomUUID() });
    assert.equal(response.status, 403);
    assert.equal(response.body.details?.code, 'EMPLOYEE_CHANGE_REQUEST_REQUIRED');
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
  });

  test('27 stale Employee after Admin direct edit yields EMPLOYEE_CHANGE_STALE_MASTER and zero proposal mutation', async () => {
    const employee = await newEmployee('stale-master');
    const { service, submitted } = await submitRequest(employee, { department: 'Safety' });
    await adminEdit(employee, { firstName: 'AdminChanged' });
    await assert.rejects(() => service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_CHANGE_STALE_MASTER');
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    const requestRow = await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    assert.equal(stored.firstName, 'AdminChanged');
    assert.equal(stored.department, 'Operations');
    assert.equal(requestRow.status, 'PENDING_APPROVAL');
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'STALE_CONFLICT' } }), 1);
  });

  test('28 stale lifecycle sequence is blocked even when Employee.updatedAt is unchanged', async () => {
    const employee = await newEmployee('stale-seq');
    const { service, submitted } = await submitRequest(employee, { department: 'Safety' });
    const fresh = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    const snapshot = lifecycle.employeeMasterState(fresh);
    await prisma.employeeLifecycleEvent.create({ data: { employeeId: employee.id, sequence: 1, type: 'MASTER_EDIT', status: 'PENDING', effectiveDate: new Date('2026-08-21T00:00:00Z'), oldValue: { employee: snapshot, user: null }, newValue: { employee: snapshot, user: null }, reason: 'Sequence-only conflict fixture', changedByUserId: ids.admin, idempotencyKey: randomUUID(), expectedEmployeeUpdatedAt: fresh.updatedAt } });
    await assert.rejects(() => service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_CHANGE_STALE_MASTER');
    assert.equal((await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status, 'PENDING_APPROVAL');
  });

  test('29 stale unrelated change is not field-level auto-merged', async () => {
    const employee = await newEmployee('no-merge');
    const { service, submitted } = await submitRequest(employee, { department: 'Safety' });
    await adminEdit(employee, { jobTitle: 'Admin Override' });
    await assert.rejects(() => service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.details?.code === 'EMPLOYEE_CHANGE_STALE_MASTER');
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    assert.equal(stored.jobTitle, 'Admin Override');
    assert.equal(stored.department, 'Operations');
  });

  test('30 governed transition persists queryable Event and AuditLog atomically', async () => {
    const employee = await newEmployee('event-audit');
    const { service, submitted } = await submitRequest(employee);
    await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'APPROVE' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'EmployeeChangeRequest', entityId: submitted.id, action: 'UPDATE' } }), 1);
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { sourceChangeRequestId: submitted.id } }), 1);
  });

  test('31 required audit failure rolls back Employee/lifecycle/request business transaction', async () => {
    const employee = await newEmployee('audit-rollback');
    const { submitted } = await submitRequest(employee);
    const failingAudit = { log: async () => { throw new Error('forced governed audit failure'); } };
    const failing = changes(failingAudit);
    await assert.rejects(() => failing.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), /forced governed audit failure/);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).department, 'Operations');
    assert.equal((await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status, 'PENDING_APPROVAL');
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { sourceChangeRequestId: submitted.id } }), 0);
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'APPROVE' } }), 0);
  });

  test('32 terminal state releases activeEmployeeId and permits a new governed request', async () => {
    const employee = await newEmployee('release-slot');
    const { service, submitted } = await submitRequest(employee);
    await service.reject({ id: submitted.id, actor: actors.admin, reason: 'Terminal fixture', idempotencyKey: randomUUID() });
    assert.equal((await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).activeEmployeeId, null);
    const next = await service.createDraft({ employeeId: employee.id, actor: actors.manager, proposal: { jobTitle: 'Supervisor' }, idempotencyKey: randomUUID() });
    assert.equal(next.activeEmployeeId, employee.id);
  });

  test('33 immediate Manager revision applies at Admin approval time', async () => {
    const employee = await newEmployee('immediate');
    const { service, submitted } = await submitRequest(employee, { jobTitle: 'Supervisor' });
    const result = await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    assert.equal(result.mutation.applied, true);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).jobTitle, 'Supervisor');
    assert.ok((await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).appliedAt);
  });

  test('34 future-effective approval does not mutate Employee at approval time', async () => {
    const employee = await newEmployee('future');
    const { service, submitted } = await submitRequest(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Future termination' });
    const result = await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    const requestRow = await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    assert.equal(result.mutation.applied, false);
    assert.equal(stored.isActive, true);
    assert.equal(requestRow.status, 'APPROVED');
    assert.equal(requestRow.appliedAt, null);
  });

  test('35 due future-effective MASTER_EDIT applies exactly once', async () => {
    const employee = await newEmployee('future-apply');
    const { service, submitted } = await submitRequest(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Future termination' });
    await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    const futureLifecycle = lifecycleService(() => new Date('2026-09-16T02:00:00Z'));
    const first = await futureLifecycle.synchronizeDueEvents({ employeeId: employee.id, limit: 10 });
    const second = await futureLifecycle.synchronizeDueEvents({ employeeId: employee.id, limit: 10 });
    assert.equal(first.applied, 1);
    assert.equal(second.applied, 0);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).isActive, false);
  });

  test('36 request.appliedAt and APPLY_EFFECTIVE request event are set once', async () => {
    const employee = await newEmployee('applied-once');
    const { service, submitted } = await submitRequest(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Future termination' });
    await service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true });
    const futureLifecycle = lifecycleService(() => new Date('2026-09-16T02:00:00Z'));
    await futureLifecycle.synchronizeDueEvents({ employeeId: employee.id, limit: 10 });
    const firstAppliedAt = (await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).appliedAt;
    await futureLifecycle.synchronizeDueEvents({ employeeId: employee.id, limit: 10 });
    const secondAppliedAt = (await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } })).appliedAt;
    assert.ok(firstAppliedAt);
    assert.equal(secondAppliedAt.getTime(), firstAppliedAt.getTime());
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'APPLY_EFFECTIVE' } }), 1);
  });

  test('37 mixed immediate/future effective timing is rejected fail-closed', () => {
    assert.throws(() => validateEffectiveTiming({ phone: '0800000000', isActive: false }, 'FUTURE_EFFECTIVE', '2026-09-15', clock()), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING');
  });

  test('38 effective termination preserves linked User/session security semantics', async () => {
    const employee = await newEmployee('termination');
    const user = await linkedUser(employee);
    const session = await prisma.refreshSession.create({ data: { userId: user.id, refreshTokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64), tokenVersion: 0, expiresAt: new Date('2027-01-01T00:00:00Z') } });
    await adminEdit(employee, { isActive: false }, { reason: 'Employment terminated' });
    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const storedSession = await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).isActive, false);
    assert.equal(storedUser.isActive, false);
    assert.equal(storedUser.accountStatus, 'SUSPENDED');
    assert.ok(storedUser.employmentSuspendedAt);
    assert.equal(storedUser.tokenVersion, 1);
    assert.ok(storedSession.revokedAt);
  });

  test('39 Rehire does not undo unrelated manual/Admin suspension', async () => {
    const employee = await newEmployee('rehire-safe', { isActive: false });
    const user = await linkedUser(employee, { isActive: false, accountStatus: 'SUSPENDED', employmentSuspendedAt: null });
    await adminEdit(employee, { isActive: true }, { reason: 'Employment rehire' });
    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).isActive, true);
    assert.equal(storedUser.isActive, false);
    assert.equal(storedUser.accountStatus, 'SUSPENDED');
    assert.equal(storedUser.employmentSuspendedAt, null);
  });

  test('40 Employee contact email edit never mutates User login email', async () => {
    const employee = await newEmployee('email');
    const user = await linkedUser(employee, { email: `login-${serial}@gov.integration.test` });
    const loginEmail = user.email;
    await adminEdit(employee, { email: `employee-contact-${serial}@gov.integration.test` });
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).email, `employee-contact-${serial}@gov.integration.test`);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, loginEmail);
  });

  test('41 historical ShiftAssignment is preserved by termination', async () => {
    const employee = await newEmployee('history-shift');
    await rawShift(employee, '2026-08-01', 'D');
    await adminEdit(employee, { isActive: false }, { reason: 'Termination preserving history' });
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: employee.id, workDate: new Date('2026-08-01T00:00:00Z') } }), 1);
  });

  test('42 historical LeaveRequest is preserved by termination', async () => {
    const employee = await newEmployee('history-leave');
    await prisma.leaveRequest.create({ data: { sourceFingerprint: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64), employeeId: employee.id, requestedAt: new Date('2026-07-01T00:00:00Z'), employeeNameSnapshot: employee.displayName, departmentSnapshot: employee.department, leaveType: 'SICK', startDate: new Date('2026-07-02T00:00:00Z'), endDate: new Date('2026-07-02T00:00:00Z'), dayCount: 1, status: 'APPROVED' } });
    await adminEdit(employee, { isActive: false }, { reason: 'Termination preserving leave history' });
    assert.equal(await prisma.leaveRequest.count({ where: { employeeId: employee.id } }), 1);
  });

  test('43 historical EmployeeLicense is preserved by termination', async () => {
    const employee = await newEmployee('history-license');
    await validLicense(employee);
    await adminEdit(employee, { isActive: false }, { reason: 'Termination preserving license history' });
    assert.equal(await prisma.employeeLicense.count({ where: { employeeId: employee.id } }), 1);
  });

  test('44 future termination preflight reports future Schedule impact count', async () => {
    const employee = await newEmployee('impact');
    await rawShift(employee, '2026-09-20', 'D');
    const analysis = await master().preflight({ employeeId: employee.id, actorRole: 'ADMIN', changes: { isActive: false }, effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Future termination impact' });
    assert.equal(analysis.impacts.futureShiftAssignments, 1);
  });

  test('45 projected inactive Employee rejects new operational assignment at workDate', async () => {
    const employee = await newEmployee('projected');
    await adminEdit(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Projected termination' });
    await assert.rejects(() => ensureEmployeeOperationalForShift(prisma, { employeeId: employee.id, workDate: new Date('2026-09-20T00:00:00Z'), shiftCode: 'D' }), (error) => error.statusCode === 409 && error.details?.code === 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT');
  });

  test('46 direct shift CREATE rejects projected inactive workDate before insert', async () => {
    const employee = await newEmployee('direct-create');
    await validLicense(employee);
    await adminEdit(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Projected termination' });
    const d = await shiftType('D');
    const response = await request(app).post('/api/v1/shifts').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`).send({ employeeId: employee.id, shiftTypeId: d.id, workDate: '2026-09-20' });
    assert.equal(response.status, 409);
    assert.equal(response.body.details?.code, 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT');
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: employee.id } }), 0);
  });

  test('47 direct shift UPDATE rejects reassignment into projected inactive workDate and preserves existing row', async () => {
    const employee = await newEmployee('direct-update');
    await validLicense(employee);
    const original = await rawShift(employee, '2026-09-01', 'D', { remark: 'preserve-me' });
    await adminEdit(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Projected termination' });
    const response = await request(app).put(`/api/v1/shifts/${original.id}`).set('Authorization', `Bearer ${await tokenFor(ids.admin)}`).send({ workDate: '2026-09-20' });
    assert.equal(response.status, 409);
    assert.equal(response.body.details?.code, 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT');
    const stored = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(stored.workDate.toISOString().slice(0, 10), '2026-09-01');
    assert.equal(stored.remark, 'preserve-me');
  });

  test('48 batch schedule rejects projected inactive row with zero partial upsert', async () => {
    const employee = await newEmployee('batch');
    await validLicense(employee);
    await adminEdit(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Projected termination' });
    const d = await shiftType('D');
    await assert.rejects(() => scheduleService.saveBatchAssignments([
      { employeeId: employee.id, shiftTypeId: d.id, workDate: '2026-09-10', remark: 'would-be-first' },
      { employeeId: employee.id, shiftTypeId: d.id, workDate: '2026-09-20', remark: 'must-fail' }
    ], ids.admin, 'ADMIN'), (error) => error.statusCode === 409 && error.details?.code === 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT');
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: employee.id } }), 0);
  });

  test('49 auto-schedule validates projected state before destructive replacement and preserves pre-existing assignment', async () => {
    const employee = await newEmployee('auto');
    await validLicense(employee);
    const existing = await rawShift(employee, '2026-09-05', 'D', { remark: 'must-survive-auto-failure', locked: false });
    await adminEdit(employee, { isActive: false }, { effectiveMode: 'FUTURE_EFFECTIVE', effectiveDate: '2026-09-15', reason: 'Projected termination' });
    await assert.rejects(() => commitEmployeeAutoSchedule(prisma, '2026-09', employee.id, ids.admin, 'D1', 'AUTO'), (error) => error.statusCode === 409 && error.details?.code === 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT');
    const stored = await prisma.shiftAssignment.findUnique({ where: { id: existing.id } });
    assert.ok(stored);
    assert.equal(stored.remark, 'must-survive-auto-failure');
    const source = fs.readFileSync(path.join(__dirname, '../../src/services/auto-schedule.service.js'), 'utf8');
    const employeeCommit = source.slice(source.indexOf('async function commitEmployeeAutoSchedule'));
    const validationIndex = employeeCommit.indexOf('await validateScheduleRowsOperational(tx, generated.map');
    const deleteIndex = employeeCommit.indexOf('const deleted = await tx.shiftAssignment.deleteMany');
    assert.ok(validationIndex >= 0 && deleteIndex >= 0 && validationIndex < deleteIndex);
  });

  test('50 OFF and AL non-working markers are not falsely rejected for terminated Employee', async () => {
    const employee = await newEmployee('off-al');
    await adminEdit(employee, { isActive: false }, { reason: 'Immediate termination' });
    await assert.doesNotReject(() => ensureEmployeeOperationalForShift(prisma, { employeeId: employee.id, workDate: new Date('2026-09-20T00:00:00Z'), shiftCode: 'OFF' }));
    await assert.doesNotReject(() => ensureEmployeeOperationalForShift(prisma, { employeeId: employee.id, workDate: new Date('2026-09-20T00:00:00Z'), shiftCode: 'AL' }));
  });
  test('51 stale conflict diagnostic audit failure preserves authoritative stale 409 and zero proposal mutation', async () => {
    const employee = await newEmployee('stale-diagnostic');
    const { submitted } = await submitRequest(employee, { department: 'Safety' });
    await adminEdit(employee, { firstName: 'ChangedBeforeApprove' });
    const failingAudit = { log: async () => { throw new Error('forced stale diagnostic audit failure'); } };
    const service = changes(failingAudit);
    await assert.rejects(() => service.approve({ id: submitted.id, actor: actors.admin, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details?.code === 'EMPLOYEE_CHANGE_STALE_MASTER');
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    const requestRow = await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    assert.equal(stored.firstName, 'ChangedBeforeApprove');
    assert.equal(stored.department, 'Operations');
    assert.equal(requestRow.status, 'PENDING_APPROVAL');
    assert.equal(await prisma.employeeChangeRequestEvent.count({ where: { requestId: submitted.id, action: 'STALE_CONFLICT' } }), 0);
  });

}
