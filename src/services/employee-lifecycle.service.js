'use strict';

const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { logger, errorCategory } = require('../utils/logger');

const LIFECYCLE_LOCK = 615042917;
const LIFECYCLE_TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 };
const EVENT_TYPES = [
  'DEPARTMENT_TRANSFER',
  'NAME_CHANGE',
  'POSITION_CHANGE',
  'EMPLOYMENT_TERMINATION',
  'REHIRE'
];
const CONTROLLED_FIELDS = ['firstName', 'lastName', 'displayName', 'department', 'jobTitle', 'isActive'];
const MAX_DUE_EVENTS_PER_REQUEST = 10;
let requestSyncPromise = null;
let nextRequestSyncAt = 0;

function dateOnly(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, 'วันที่มีผลไม่ถูกต้อง');
  }
  return date;
}

function bangkokToday(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function employeeState(employee) {
  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    displayName: employee.displayName || `${employee.firstName} ${employee.lastName}`.trim(),
    department: employee.department || null,
    jobTitle: employee.jobTitle || null,
    isActive: Boolean(employee.isActive),
    employmentStatus: employee.isActive ? 'ACTIVE' : 'TERMINATED'
  };
}

function userState(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    department: user.department || null,
    isActive: Boolean(user.isActive),
    accountStatus: user.accountStatus,
    employmentSuspendedAt: user.employmentSuspendedAt ? new Date(user.employmentSuspendedAt).toISOString() : null
  };
}

function lifecycleSnapshot(employee, user) {
  return { employee: employeeState(employee), user: userState(user) };
}

function sameControlledState(current, expected) {
  if (!current || !expected) return false;
  return CONTROLLED_FIELDS.every((field) => (current[field] ?? null) === (expected[field] ?? null));
}

function cleanText(value, label, max = 100) {
  const text = String(value || '').trim();
  if (!text) throw new HttpError(400, `กรุณาระบุ${label}`);
  if (text.length > max) throw new HttpError(400, `${label}ยาวเกินกำหนด`);
  return text;
}

function nextSnapshot(type, priorSnapshot, changes = {}, effectiveDate) {
  const next = JSON.parse(JSON.stringify(priorSnapshot));
  const current = next.employee;
  if (type === 'NAME_CHANGE') {
    current.firstName = cleanText(changes.firstName, 'ชื่อ');
    current.lastName = cleanText(changes.lastName, 'นามสกุล');
    current.displayName = `${current.firstName} ${current.lastName}`.trim();
    if (next.user) next.user.displayName = current.displayName;
  } else if (type === 'DEPARTMENT_TRANSFER') {
    current.department = cleanText(changes.department, 'หน่วยงาน');
    if (next.user) next.user.department = current.department;
  } else if (type === 'POSITION_CHANGE') {
    current.jobTitle = cleanText(changes.jobTitle, 'ตำแหน่ง');
  } else if (type === 'EMPLOYMENT_TERMINATION') {
    current.isActive = false;
    current.employmentStatus = 'TERMINATED';
    if (next.user) {
      next.user.isActive = false;
      next.user.accountStatus = 'SUSPENDED';
      next.user.employmentSuspendedAt = effectiveDate ? dateOnly(effectiveDate).toISOString() : next.user.employmentSuspendedAt;
    }
  } else if (type === 'REHIRE') {
    current.isActive = true;
    current.employmentStatus = 'ACTIVE';
    if (String(changes.department || '').trim()) current.department = cleanText(changes.department, 'หน่วยงาน');
    if (String(changes.jobTitle || '').trim()) current.jobTitle = cleanText(changes.jobTitle, 'ตำแหน่ง');
    if (next.user) {
      next.user.department = current.department;
      if (next.user.employmentSuspendedAt) {
        next.user.isActive = true;
        next.user.accountStatus = 'ACTIVE';
        next.user.employmentSuspendedAt = null;
      }
    }
  }
  return next;
}

function actionValidation(type, prior, next) {
  const blockingIssues = [];
  const add = (code, message) => blockingIssues.push({ code, message });
  if (!EVENT_TYPES.includes(type)) add('UNSUPPORTED_EVENT_TYPE', 'ประเภทการเปลี่ยนแปลงไม่ถูกต้อง');
  if (type === 'NAME_CHANGE' && prior.employee.displayName === next.employee.displayName) add('NO_STATE_CHANGE', 'ชื่อใหม่ต้องแตกต่างจากชื่อปัจจุบัน');
  if (type === 'DEPARTMENT_TRANSFER' && prior.employee.department === next.employee.department) add('NO_STATE_CHANGE', 'หน่วยงานใหม่ต้องแตกต่างจากหน่วยงานปัจจุบัน');
  if (type === 'POSITION_CHANGE' && prior.employee.jobTitle === next.employee.jobTitle) add('NO_STATE_CHANGE', 'ตำแหน่งใหม่ต้องแตกต่างจากตำแหน่งปัจจุบัน');
  if (type === 'EMPLOYMENT_TERMINATION' && !prior.employee.isActive) add('EMPLOYEE_NOT_ACTIVE', 'พนักงานไม่ได้อยู่ในสถานะปฏิบัติงาน');
  if (type === 'REHIRE' && prior.employee.isActive) add('EMPLOYEE_ALREADY_ACTIVE', 'พนักงานอยู่ในสถานะปฏิบัติงานอยู่แล้ว');
  return blockingIssues;
}

function warning(code, message, count = null) {
  return { code, message, ...(count !== null && { count }) };
}

function hasLifecycleModel(client) {
  return Boolean(client && Reflect.has(client, 'employeeLifecycleEvent'));
}

function createEmployeeLifecycleService({ prismaClient = prisma, auditService = audit, clock = () => new Date() } = {}) {
  async function authoritativeMutationState({ employeeId, type, effectiveDate, changes = {} }, client = prismaClient) {
    const effective = dateOnly(effectiveDate);
    const employee = await client.employee.findFirst({ where: { id: employeeId, deletedAt: null }, include: { user: true } });
    if (!employee) throw new HttpError(404, 'ไม่พบข้อมูลพนักงาน');

    const latestEvent = hasLifecycleModel(client)
      ? await client.employeeLifecycleEvent.findFirst({ where: { employeeId }, orderBy: [{ effectiveDate: 'desc' }, { sequence: 'desc' }] })
      : null;
    const prior = latestEvent?.newValue || lifecycleSnapshot(employee, employee.user);
    const next = nextSnapshot(type, prior, changes, effective);
    const blockingIssues = actionValidation(type, prior, next);
    if (latestEvent && new Date(latestEvent.effectiveDate) > effective) {
      blockingIssues.push({ code: 'LIFECYCLE_EVENT_ORDER_CONFLICT', message: 'วันที่มีผลต้องไม่ก่อนเหตุการณ์ล่าสุดในประวัติพนักงาน' });
    }
    return { effective, employee, latestEvent, prior, next, blockingIssues, latestLifecycleSequence: latestEvent?.sequence || 0 };
  }

  async function preflight({ employeeId, type, effectiveDate, changes = {} }, client = prismaClient) {
    const state = await authoritativeMutationState({ employeeId, type, effectiveDate, changes }, client);
    const { effective, employee, latestEvent, prior, next, blockingIssues } = state;

    const impacts = {
      futureShiftAssignments: await client.shiftAssignment.count({ where: { employeeId, workDate: { gte: effective } } }),
      pendingLeaveRequests: await client.leaveRequest.count({ where: { employeeId, status: 'PENDING', endDate: { gte: effective } } }),
      approvedFutureLeaveRequests: await client.leaveRequest.count({ where: { employeeId, status: 'APPROVED', endDate: { gte: effective } } }),
      leaveQuotaRecords: await client.leaveQuota.count({ where: { employeeId } }),
      activeLicenses: await client.employeeLicense.count({ where: { employeeId, status: 'Active', OR: [{ expiryDate: null }, { expiryDate: { gte: effective } }] } }),
      licenseDocuments: await client.employeeLicenseDocument.count({ where: { employeeId } }),
      linkedUser: employee.user ? { present: true, accountStatus: employee.user.accountStatus, isActive: employee.user.isActive } : { present: false }
    };

    const warnings = [];
    if (effective > bangkokToday(clock())) warnings.push(warning('FUTURE_EFFECTIVE_DATE', 'รายการนี้จะรอจนถึงวันที่มีผลก่อนปรับข้อมูลปัจจุบัน'));
    if (['DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION'].includes(type) && impacts.futureShiftAssignments > 0) warnings.push(warning('FUTURE_SHIFT_ASSIGNMENTS', 'พบรายการจัดเวรตั้งแต่วันที่มีผล โปรดตรวจสอบก่อนยืนยัน', impacts.futureShiftAssignments));
    if (['DEPARTMENT_TRANSFER', 'EMPLOYMENT_TERMINATION'].includes(type) && impacts.pendingLeaveRequests > 0) warnings.push(warning('PENDING_LEAVE_REQUESTS', 'พบคำขอลาที่รอพิจารณา', impacts.pendingLeaveRequests));
    if (type === 'EMPLOYMENT_TERMINATION' && impacts.approvedFutureLeaveRequests > 0) warnings.push(warning('APPROVED_FUTURE_LEAVE', 'พบคำขอลาที่อนุมัติแล้วหลังวันที่มีผล', impacts.approvedFutureLeaveRequests));
    if (type === 'EMPLOYMENT_TERMINATION' && impacts.activeLicenses > 0) warnings.push(warning('ACTIVE_LICENSES', 'พบใบอนุญาตที่ยังมีผลและจะถูกเก็บเป็นประวัติ', impacts.activeLicenses));
    if (['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'EMPLOYMENT_TERMINATION', 'REHIRE'].includes(type) && !employee.user) warnings.push(warning('LINKED_USER_MISSING', 'ไม่พบบัญชีผู้ใช้ที่เชื่อมด้วย employeeId ระบบจะไม่คาดเดาจากชื่อ'));
    if (type === 'REHIRE' && employee.user && !employee.user.employmentSuspendedAt) warnings.push(warning('USER_NOT_EMPLOYMENT_SUSPENDED', 'บัญชีผู้ใช้ไม่ได้ถูกระงับโดยเหตุการณ์ลาออก ระบบจะไม่เปิดบัญชีโดยอัตโนมัติ'));

    return {
      employee: { id: employee.id, employeeCode: employee.employeeCode, ...employeeState(employee), updatedAt: employee.updatedAt },
      type,
      effectiveDate: effective.toISOString().slice(0, 10),
      currentState: prior.employee,
      proposedState: next.employee,
      linkedUserState: { current: prior.user, proposed: next.user },
      blockingIssues,
      warnings,
      impacts,
      expectedEmployeeUpdatedAt: new Date(employee.updatedAt).toISOString(),
      latestLifecycleSequence: latestEvent?.sequence || 0
    };
  }

  async function updateMasterFromSnapshot(tx, employee, type, snapshot, effectiveDate) {
    const state = snapshot.employee;
    const after = await tx.employee.update({
      where: { id: employee.id },
      data: {
        firstName: state.firstName,
        lastName: state.lastName,
        displayName: state.displayName,
        department: state.department,
        jobTitle: state.jobTitle,
        isActive: state.isActive
      }
    });

    const linkedUser = await tx.user.findUnique({ where: { employeeId: employee.id } });
    let synchronizedUser = linkedUser;
    if (linkedUser && type === 'NAME_CHANGE') synchronizedUser = await tx.user.update({ where: { id: linkedUser.id }, data: { displayName: state.displayName } });
    if (linkedUser && ['DEPARTMENT_TRANSFER', 'REHIRE'].includes(type)) synchronizedUser = await tx.user.update({ where: { id: linkedUser.id }, data: { department: state.department } });
    if (linkedUser && type === 'EMPLOYMENT_TERMINATION') {
      synchronizedUser = await tx.user.update({ where: { id: linkedUser.id }, data: { isActive: false, accountStatus: 'SUSPENDED', employmentSuspendedAt: effectiveDate, tokenVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: linkedUser.id, revokedAt: null }, data: { revokedAt: clock() } });
    }
    if (linkedUser && type === 'REHIRE' && linkedUser.employmentSuspendedAt) {
      synchronizedUser = await tx.user.update({ where: { id: linkedUser.id }, data: { isActive: true, accountStatus: 'ACTIVE', employmentSuspendedAt: null, tokenVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: linkedUser.id, revokedAt: null }, data: { revokedAt: clock() } });
    }
    return { employee: after, user: synchronizedUser };
  }

  async function createEvent({ employeeId, actorUserId, type, effectiveDate, reason, changes = {}, expectedEmployeeUpdatedAt, expectedLifecycleSequence, idempotencyKey, acknowledgeWarnings = false }) {
    const effective = dateOnly(effectiveDate);
    const safeReason = cleanText(reason, 'เหตุผล', 1000);

    // Preserve idempotent retries without opening an interactive transaction.
    // The duplicate is checked again after the advisory lock to close races.
    const existing = await prismaClient.employeeLifecycleEvent.findUnique({ where: { idempotencyKey }, include: { changedBy: { select: { displayName: true, role: true } } } });
    if (existing) {
      if (existing.employeeId !== employeeId || existing.type !== type) throw new HttpError(409, 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว');
      return { event: existing, idempotent: true };
    }

    // Impact analysis is intentionally outside the interactive transaction.
    // Authoritative state is revalidated under the lock before any write.
    const analysis = await preflight({ employeeId, type, effectiveDate: effective, changes }, prismaClient);
    if (analysis.blockingIssues.length) throw new HttpError(409, 'ไม่สามารถดำเนินการเปลี่ยนแปลงนี้ได้', { code: 'LIFECYCLE_PREFLIGHT_BLOCKED', preflight: analysis });
    if (analysis.warnings.length && !acknowledgeWarnings) throw new HttpError(409, 'กรุณาตรวจสอบและยืนยันคำเตือนก่อนดำเนินการ', { code: 'LIFECYCLE_WARNINGS_REQUIRE_CONFIRMATION', preflight: analysis });
    if (new Date(expectedEmployeeUpdatedAt).getTime() !== new Date(analysis.expectedEmployeeUpdatedAt).getTime()) throw new HttpError(409, 'ข้อมูลพนักงานมีการเปลี่ยนแปลง กรุณารีเฟรชและลองใหม่', { code: 'EMPLOYEE_STATE_CONFLICT' });
    if (Number(expectedLifecycleSequence) !== analysis.latestLifecycleSequence) throw new HttpError(409, 'ประวัติวงจรพนักงานมีการเปลี่ยนแปลง กรุณาตรวจสอบใหม่', { code: 'LIFECYCLE_STATE_CONFLICT' });

    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LIFECYCLE_LOCK})`;
      const duplicate = await tx.employeeLifecycleEvent.findUnique({ where: { idempotencyKey }, include: { changedBy: { select: { displayName: true, role: true } } } });
      if (duplicate) {
        if (duplicate.employeeId !== employeeId || duplicate.type !== type) throw new HttpError(409, 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว');
        return { event: duplicate, idempotent: true };
      }

      const authoritative = await authoritativeMutationState({ employeeId, type, effectiveDate: effective, changes }, tx);
      if (authoritative.blockingIssues.length) throw new HttpError(409, 'ไม่สามารถดำเนินการเปลี่ยนแปลงนี้ได้', { code: 'LIFECYCLE_PREFLIGHT_BLOCKED' });
      if (new Date(expectedEmployeeUpdatedAt).getTime() !== new Date(authoritative.employee.updatedAt).getTime()) throw new HttpError(409, 'ข้อมูลพนักงานมีการเปลี่ยนแปลง กรุณารีเฟรชและลองใหม่', { code: 'EMPLOYEE_STATE_CONFLICT' });
      if (Number(expectedLifecycleSequence) !== authoritative.latestLifecycleSequence) throw new HttpError(409, 'ประวัติวงจรพนักงานมีการเปลี่ยนแปลง กรุณาตรวจสอบใหม่', { code: 'LIFECYCLE_STATE_CONFLICT' });

      const employee = authoritative.employee;
      const oldValue = { employee: authoritative.prior.employee, user: authoritative.prior.user };
      const newValue = authoritative.next;
      const appliesNow = effective <= bangkokToday(clock());
      const event = await tx.employeeLifecycleEvent.create({
        data: {
          employeeId,
          sequence: authoritative.latestLifecycleSequence + 1,
          type,
          status: appliesNow ? 'APPLIED' : 'PENDING',
          effectiveDate: effective,
          oldValue,
          newValue,
          reason: safeReason,
          changedByUserId: actorUserId,
          idempotencyKey,
          expectedEmployeeUpdatedAt: new Date(expectedEmployeeUpdatedAt),
          appliedAt: appliesNow ? clock() : null
        }
      });

      let currentEmployee = employee;
      if (appliesNow) {
        const synchronized = await updateMasterFromSnapshot(tx, employee, type, newValue, effective);
        currentEmployee = synchronized.employee;
        await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'Employee', entityId: employeeId, metadata: { lifecycleEventId: event.id, type, effectiveDate: effective, before: oldValue.employee, after: employeeState(currentEmployee) } }, tx);
      }
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'EmployeeLifecycleEvent', entityId: event.id, metadata: { employeeId, type, status: event.status, effectiveDate: effective, reason: safeReason, impacts: analysis.impacts } }, tx);
      return { event: { ...event, changedBy: { id: actorUserId } }, employee: currentEmployee, preflight: analysis, idempotent: false };
    }, LIFECYCLE_TRANSACTION_OPTIONS);
  }

  async function applyPendingEvent(eventId) {
    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LIFECYCLE_LOCK})`;
      const event = await tx.employeeLifecycleEvent.findUnique({ where: { id: eventId } });
      if (!event || event.status !== 'PENDING' || new Date(event.effectiveDate) > bangkokToday(clock())) return null;
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: event.employeeId } });
      if (!sameControlledState(employeeState(employee), event.oldValue.employee)) throw new HttpError(409, 'สถานะปัจจุบันไม่ตรงกับข้อมูลก่อนเหตุการณ์', { code: 'EMPLOYEE_STATE_CONFLICT' });
      const synchronized = await updateMasterFromSnapshot(tx, employee, event.type, event.newValue, event.effectiveDate);
      const applied = await tx.employeeLifecycleEvent.update({ where: { id: event.id }, data: { status: 'APPLIED', appliedAt: clock() } });
      await auditService.log({ actorUserId: event.changedByUserId, action: 'UPDATE', entityType: 'Employee', entityId: event.employeeId, metadata: { lifecycleEventId: event.id, type: event.type, effectiveDate: event.effectiveDate, appliedBy: 'SYSTEM_DUE_EVENT', before: event.oldValue.employee, after: employeeState(synchronized.employee) } }, tx);
      return applied;
    }, { isolationLevel: 'Serializable' });
  }

  async function synchronizeDueEvents({ limit = MAX_DUE_EVENTS_PER_REQUEST, employeeId, failClosedOnTermination = false } = {}) {
    if (!hasLifecycleModel(prismaClient)) return { scanned: 0, applied: 0, failed: 0 };
    const due = await prismaClient.employeeLifecycleEvent.findMany({ where: { status: 'PENDING', effectiveDate: { lte: bangkokToday(clock()) }, ...(employeeId && { employeeId }) }, select: { id: true, type: true }, orderBy: [{ effectiveDate: 'asc' }, { sequence: 'asc' }], take: limit });
    let applied = 0;
    let failed = 0;
    for (const row of due) {
      try {
        if (await applyPendingEvent(row.id)) applied += 1;
      } catch (error) {
        failed += 1;
        logger.error('employee_lifecycle_due_event_failure', { eventId: row.id, errorCategory: errorCategory(error) });
        if (failClosedOnTermination && row.type === 'EMPLOYMENT_TERMINATION') {
          throw new HttpError(503, 'ไม่สามารถตรวจสอบสถานะการจ้างงานได้ กรุณาลองใหม่อีกครั้ง', { code: 'EMPLOYMENT_STATUS_SYNC_FAILED' });
        }
      }
    }
    return { scanned: due.length, applied, failed };
  }

  async function history(employeeId, { page = 1, pageSize = 25 } = {}) {
    const employee = await prismaClient.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new HttpError(404, 'ไม่พบข้อมูลพนักงาน');
    const where = { employeeId };
    const [total, rows] = await prismaClient.$transaction([
      prismaClient.employeeLifecycleEvent.count({ where }),
      prismaClient.employeeLifecycleEvent.findMany({ where, include: { changedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: [{ effectiveDate: 'desc' }, { sequence: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    return { data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async function statesAt(employeeIds, asOfDate, client = prismaClient, employeeRecords) {
    const ids = [...new Set(employeeIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const date = dateOnly(asOfDate);
    const employees = employeeRecords || await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true } });
    if (!hasLifecycleModel(client)) return new Map(employees.map((employee) => [employee.id, employeeState(employee)]));
    const latest = await client.employeeLifecycleEvent.findMany({ where: { employeeId: { in: ids }, status: 'APPLIED', effectiveDate: { lte: date } }, orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'desc' }, { sequence: 'desc' }], distinct: ['employeeId'] });
    const earliestAfter = await client.employeeLifecycleEvent.findMany({ where: { employeeId: { in: ids }, status: 'APPLIED', effectiveDate: { gt: date } }, orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'asc' }, { sequence: 'asc' }], distinct: ['employeeId'] });
    const latestByEmployee = new Map(latest.map((event) => [event.employeeId, event.newValue.employee]));
    const earliestByEmployee = new Map(earliestAfter.map((event) => [event.employeeId, event.oldValue.employee]));
    return new Map(employees.map((employee) => [employee.id, latestByEmployee.get(employee.id) || earliestByEmployee.get(employee.id) || employeeState(employee)]));
  }

  async function stateAt(employeeId, asOfDate) {
    const states = await statesAt([employeeId], asOfDate);
    const state = states.get(employeeId);
    if (!state) throw new HttpError(404, 'ไม่พบข้อมูลพนักงาน');
    return state;
  }

  return { preflight, createEvent, applyPendingEvent, synchronizeDueEvents, history, statesAt, stateAt };
}

const defaultService = createEmployeeLifecycleService();

async function synchronizeDueLifecycleEventsForRequest() {
  const now = Date.now();
  if (now < nextRequestSyncAt) return { skipped: true, reason: 'THROTTLED' };
  if (requestSyncPromise) return requestSyncPromise;
  requestSyncPromise = defaultService.synchronizeDueEvents()
    .then((result) => {
      nextRequestSyncAt = Date.now() + 15000;
      return result;
    })
    .finally(() => { requestSyncPromise = null; });
  return requestSyncPromise;
}

async function synchronizeDueLifecycleEventsForEmployee(employeeId) {
  if (!employeeId) return { scanned: 0, applied: 0, failed: 0 };
  return defaultService.synchronizeDueEvents({ employeeId, failClosedOnTermination: true });
}

module.exports = {
  EVENT_TYPES,
  MAX_DUE_EVENTS_PER_REQUEST,
  bangkokToday,
  dateOnly,
  employeeState,
  hasLifecycleModel,
  lifecycleSnapshot,
  nextSnapshot,
  createEmployeeLifecycleService,
  preflightEmployeeLifecycleAction: defaultService.preflight,
  createEmployeeLifecycleEvent: defaultService.createEvent,
  synchronizeDueLifecycleEvents: defaultService.synchronizeDueEvents,
  synchronizeDueLifecycleEventsForRequest,
  synchronizeDueLifecycleEventsForEmployee,
  getEmployeeLifecycleHistory: defaultService.history,
  getEmployeeStatesAt: defaultService.statesAt,
  getEmployeeStateAt: defaultService.stateAt
};
