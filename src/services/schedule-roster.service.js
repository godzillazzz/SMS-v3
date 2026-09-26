'use strict';

const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { createSchedulePersonnelResolver } = require('./schedule-personnel-history.service');

function monthStart(value) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  const raw = String(value || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) throw new HttpError(400, 'Month must be in YYYY-MM format.');
  const [year, month] = raw.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthEnd(start) {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function displayName(employee) {
  return employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.employeeCode;
}

function orderValue(value) {
  return Number.isInteger(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function sortRoster(a, b) {
  const department = String(a.department || '').localeCompare(String(b.department || ''), 'th');
  if (department) return department;
  const order = orderValue(a.rosterOrder ?? a.scheduleOrder) - orderValue(b.rosterOrder ?? b.scheduleOrder);
  if (order) return order;
  const code = String(a.employeeCode || a.employeeCodeSnapshot || '').localeCompare(String(b.employeeCode || b.employeeCodeSnapshot || ''), 'en', { numeric: true });
  if (code) return code;
  return String(a.id || a.employeeId || '').localeCompare(String(b.id || b.employeeId || ''));
}

async function assertRosterDepartmentAuthority(client, actorUser, department) {
  if (actorUser?.role === 'ADMIN') return;
  if (!actorUser?.sub) throw new HttpError(403, 'Roster order authority is required.');
  const user = await client.user.findUnique({ where: { id: actorUser.sub }, select: { department: true, role: true, isActive: true, accountStatus: true } });
  if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || !['MANAGER', 'SUPERVISOR'].includes(user.role)) {
    throw new HttpError(403, 'Roster order authority is required.');
  }
  if (!user.department || String(user.department) !== String(department)) {
    throw new HttpError(403, 'You may manage roster order only for your own department.', { code: 'ROSTER_DEPARTMENT_SCOPE_REQUIRED' });
  }
}

async function listDepartmentRoster(client, department, actorUser = null) {
  const value = String(department || '').trim();
  if (!value) throw new HttpError(400, 'Department is required to manage roster order.');
  if (actorUser) await assertRosterDepartmentAuthority(client, actorUser, value);
  const employees = await client.employee.findMany({
    where: { department: value, isActive: true, deletedAt: null },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, scheduleOrder: true },
    orderBy: [{ scheduleOrder: 'asc' }, { employeeCode: 'asc' }]
  });
  const sorted = employees.slice().sort((a, b) => sortRoster(a, b));
  let nextOrder = sorted.reduce((max, employee) => Math.max(max, Number.isInteger(employee.scheduleOrder) ? employee.scheduleOrder : 0), 0);
  return sorted.map((employee) => {
    const rosterOrder = Number.isInteger(employee.scheduleOrder) && employee.scheduleOrder > 0
      ? employee.scheduleOrder
      : (nextOrder += 10);
    return { ...employee, displayName: displayName(employee), rosterOrder };
  });
}

async function reorderDepartmentRoster(client, { department, employeeIds, actorUser }) {
  const value = String(department || '').trim();
  const ids = Array.isArray(employeeIds) ? employeeIds.map(String) : [];
  if (!value) throw new HttpError(400, 'Department is required to manage roster order.');
  await assertRosterDepartmentAuthority(client, actorUser, value);
  const actorUserId = actorUser.sub;
  if (!ids.length || new Set(ids).size !== ids.length) throw new HttpError(400, 'Roster order must contain each active employee exactly once.');

  return client.$transaction(async (tx) => {
    const current = await tx.employee.findMany({
      where: { department: value, isActive: true, deletedAt: null },
      select: { id: true, employeeCode: true, scheduleOrder: true }
    });
    const currentIds = new Set(current.map((employee) => String(employee.id)));
    if (currentIds.size !== ids.length || ids.some((id) => !currentIds.has(id))) {
      throw new HttpError(409, 'The department roster changed. Refresh the roster before saving its order.', { code: 'ROSTER_ORDER_STALE' });
    }

    const previous = current
      .slice()
      .sort((a, b) => orderValue(a.scheduleOrder) - orderValue(b.scheduleOrder) || String(a.employeeCode).localeCompare(String(b.employeeCode), 'en', { numeric: true }))
      .map((employee) => String(employee.id));

    await tx.employee.updateMany({
      where: { department: value, OR: [{ isActive: false }, { deletedAt: { not: null } }] },
      data: { scheduleOrder: null }
    });
    for (let index = 0; index < ids.length; index += 1) {
      await tx.employee.update({ where: { id: ids[index] }, data: { scheduleOrder: (index + 1) * 10 } });
    }

    await audit.log({
      actorUserId,
      action: 'UPDATE',
      entityType: 'ScheduleRosterOrder',
      entityId: value,
      metadata: { department: value, employeeCount: ids.length, previousEmployeeIds: previous, orderedEmployeeIds: ids }
    }, tx);

    return listDepartmentRoster(tx, value);
  }, { maxWait: 10000, timeout: 30000 });
}

async function listMonthlyRosterOrder(client, department, month, actorUser = null) {
  const value = String(department || '').trim();
  if (!value) throw new HttpError(400, 'Department is required to manage roster order.');
  if (actorUser) await assertRosterDepartmentAuthority(client, actorUser, value);
  const start = monthStart(month);
  const currentMonth = monthStart(new Date());
  const rows = await client.scheduleRosterSnapshot.findMany({
    where: { month: start, departmentSnapshot: value },
    include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true, isActive: true, deletedAt: true, scheduleOrder: true } } },
    orderBy: [{ rosterOrder: 'asc' }, { employeeCodeSnapshot: 'asc' }]
  });
  if (!rows.length) {
    return {
      snapshotLocked: false,
      historical: false,
      employees: await listDepartmentRoster(client, value)
    };
  }
  const visibleRows = start >= currentMonth
    ? rows.filter((row) => row.employee?.isActive === true && row.employee?.deletedAt == null)
    : rows;
  return {
    snapshotLocked: true,
    historical: start < currentMonth,
    employees: visibleRows.map((row) => ({
      id: row.employeeId,
      employeeCode: row.employeeCodeSnapshot,
      firstName: row.employee.firstName,
      lastName: row.employee.lastName,
      displayName: row.employeeNameSnapshot,
      department: row.departmentSnapshot,
      jobTitle: row.jobTitleSnapshot,
      scheduleOrder: row.employee.scheduleOrder,
      rosterOrder: row.rosterOrder
    }))
  };
}

async function reorderMonthlyRoster(client, { department, month, employeeIds, actorUser }) {
  const value = String(department || '').trim();
  const ids = Array.isArray(employeeIds) ? employeeIds.map(String) : [];
  if (!value) throw new HttpError(400, 'Department is required to manage roster order.');
  await assertRosterDepartmentAuthority(client, actorUser, value);
  const start = monthStart(month);
  const currentMonth = monthStart(new Date());
  if (start < currentMonth) {
    throw new HttpError(409, 'Historical roster order is locked.', { code: 'ROSTER_HISTORY_LOCKED' });
  }

  const snapshotRows = await client.scheduleRosterSnapshot.findMany({
    where: { month: start, departmentSnapshot: value },
    include: { employee: { select: { id: true, isActive: true, deletedAt: true } } },
    orderBy: [{ rosterOrder: 'asc' }, { employeeCodeSnapshot: 'asc' }]
  });
  if (!snapshotRows.length) {
    const employees = await reorderDepartmentRoster(client, { department: value, employeeIds: ids, actorUser });
    return { snapshotLocked: false, historical: false, employees };
  }

  const editableRows = snapshotRows.filter((row) => row.employee?.isActive === true && row.employee?.deletedAt == null);
  const currentIds = new Set(editableRows.map((row) => String(row.employeeId)));
  if (!ids.length || new Set(ids).size !== ids.length || currentIds.size !== ids.length || ids.some((id) => !currentIds.has(id))) {
    throw new HttpError(409, 'The monthly roster changed. Refresh the roster before saving its order.', { code: 'ROSTER_ORDER_STALE' });
  }
  const previous = editableRows.map((row) => String(row.employeeId));
  const actorUserId = actorUser.sub;

  return client.$transaction(async (tx) => {
    for (let index = 0; index < ids.length; index += 1) {
      await tx.scheduleRosterSnapshot.update({
        where: { month_employeeId: { month: start, employeeId: ids[index] } },
        data: { rosterOrder: (index + 1) * 10 }
      });
    }
    await audit.log({
      actorUserId,
      action: 'UPDATE',
      entityType: 'ScheduleRosterSnapshotOrder',
      entityId: `${start.toISOString().slice(0, 7)}:${value}`,
      metadata: { month: start.toISOString().slice(0, 7), department: value, employeeCount: ids.length, previousEmployeeIds: previous, orderedEmployeeIds: ids }
    }, tx);
    return listMonthlyRosterOrder(tx, value, month);
  }, { maxWait: 10000, timeout: 30000 });
}

async function assignedEmployeeIdsForMonth(client, start, end) {
  const rows = await client.shiftAssignment.findMany({
    where: { workDate: { gte: start, lt: end } },
    select: { employeeId: true },
    distinct: ['employeeId']
  });
  return rows.map((row) => String(row.employeeId));
}

async function ensureMonthlyRosterSnapshot(client, month, { extraEmployeeIds = [], actorUserId = null, source = 'SCHEDULE_CREATE' } = {}) {
  if (!client?.scheduleRosterSnapshot?.findMany || !client?.scheduleRosterSnapshot?.createMany) return [];
  const start = monthStart(month);
  const end = monthEnd(start);
  const existing = await client.scheduleRosterSnapshot.findMany({
    where: { month: start },
    select: { employeeId: true, departmentSnapshot: true, rosterOrder: true }
  });
  const existingIds = new Set(existing.map((row) => String(row.employeeId)));
  const assignedIds = await assignedEmployeeIdsForMonth(client, start, end);
  const forcedIds = [...new Set([...assignedIds, ...(extraEmployeeIds || []).map(String)])];

  const where = existing.length
    ? { id: { in: forcedIds.filter((id) => !existingIds.has(id)) } }
    : { OR: [{ isActive: true, deletedAt: null }, ...(forcedIds.length ? [{ id: { in: forcedIds } }] : [])] };
  const candidates = await client.employee.findMany({
    where,
    select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true, scheduleOrder: true },
    orderBy: [{ department: 'asc' }, { scheduleOrder: 'asc' }, { employeeCode: 'asc' }]
  });
  if (!candidates.length) return existing;

  const resolvePersonnel = await createSchedulePersonnelResolver(client, candidates);
  const existingMaxByDepartment = new Map();
  for (const row of existing) {
    const key = String(row.departmentSnapshot || '');
    existingMaxByDepartment.set(key, Math.max(existingMaxByDepartment.get(key) || 0, Number(row.rosterOrder) || 0));
  }
  const nextByDepartment = new Map(existingMaxByDepartment);
  const rows = [];
  for (const employee of candidates) {
    if (existingIds.has(String(employee.id))) continue;
    const historical = resolvePersonnel(employee.id, start) || {};
    const forced = forcedIds.includes(String(employee.id));
    if (existing.length === 0 && !employee.isActive && !forced) continue;
    const department = historical.department ?? employee.department ?? null;
    const key = String(department || '');
    let rosterOrder = Number.isInteger(employee.scheduleOrder) && employee.scheduleOrder > 0 ? employee.scheduleOrder : null;
    if (!rosterOrder) {
      const next = (nextByDepartment.get(key) || 0) + 10;
      nextByDepartment.set(key, next);
      rosterOrder = next;
    } else {
      nextByDepartment.set(key, Math.max(nextByDepartment.get(key) || 0, rosterOrder));
    }
    rows.push({
      month: start,
      employeeId: employee.id,
      employeeCodeSnapshot: employee.employeeCode,
      employeeNameSnapshot: historical.displayName || displayName(employee),
      departmentSnapshot: department,
      jobTitleSnapshot: historical.jobTitle ?? employee.jobTitle ?? null,
      rosterOrder,
      source
    });
  }
  if (!rows.length) return existing;
  const result = await client.scheduleRosterSnapshot.createMany({ data: rows, skipDuplicates: true });
  if (actorUserId && result.count) {
    await audit.log({
      actorUserId,
      action: 'CREATE',
      entityType: 'ScheduleRosterSnapshot',
      entityId: start.toISOString().slice(0, 7),
      metadata: { month: start.toISOString().slice(0, 7), createdRows: result.count, source }
    }, client);
  }
  return client.scheduleRosterSnapshot.findMany({
    where: { month: start },
    orderBy: [{ departmentSnapshot: 'asc' }, { rosterOrder: 'asc' }, { employeeCodeSnapshot: 'asc' }]
  });
}

async function loadCalendarRoster(client, month, { department, search } = {}) {
  const start = monthStart(month);
  const end = monthEnd(start);
  const snapshotCount = client?.scheduleRosterSnapshot?.count ? await client.scheduleRosterSnapshot.count({ where: { month: start } }) : 0;
  if (snapshotCount > 0) {
    const where = {
      month: start,
      ...(department ? { departmentSnapshot: department } : {}),
      ...(search ? { OR: [
        { employeeCodeSnapshot: { contains: search, mode: 'insensitive' } },
        { employeeNameSnapshot: { contains: search, mode: 'insensitive' } }
      ] } : {})
    };
    const rows = await client.scheduleRosterSnapshot.findMany({
      where,
      include: { employee: { select: { id: true, firstName: true, lastName: true, displayName: true, isActive: true, deletedAt: true, scheduleOrder: true } } },
      orderBy: [{ departmentSnapshot: 'asc' }, { rosterOrder: 'asc' }, { employeeCodeSnapshot: 'asc' }]
    });
    const currentMonth = monthStart(new Date());
    const visibleRows = start >= currentMonth
      ? rows.filter((row) => row.employee?.isActive === true && row.employee?.deletedAt == null)
      : rows;
    return {
      snapshotLocked: true,
      employees: visibleRows.map((row) => ({
        id: row.employeeId,
        employeeCode: row.employeeCodeSnapshot,
        firstName: row.employee.firstName,
        lastName: row.employee.lastName,
        displayName: row.employeeNameSnapshot,
        department: row.departmentSnapshot,
        jobTitle: row.jobTitleSnapshot,
        isActive: row.employee.isActive,
        deletedAt: row.employee.deletedAt,
        scheduleOrder: row.employee.scheduleOrder,
        rosterOrder: row.rosterOrder
      }))
    };
  }

  const assignedIds = await assignedEmployeeIdsForMonth(client, start, end);
  const assignedSet = new Set(assignedIds);
  const candidates = await client.employee.findMany({
    where: {
      OR: [{ isActive: true, deletedAt: null }, ...(assignedIds.length ? [{ id: { in: assignedIds } }] : [])],
      ...(search ? { AND: [{ OR: [
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } }
      ] }] } : {})
    },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true, scheduleOrder: true },
    orderBy: [{ department: 'asc' }, { scheduleOrder: 'asc' }, { employeeCode: 'asc' }]
  });
  const resolvePersonnel = await createSchedulePersonnelResolver(client, candidates);
  const employees = candidates.map((employee) => {
    const historical = resolvePersonnel(employee.id, start) || {};
    const assigned = assignedSet.has(String(employee.id));
    return {
      ...employee,
      ...historical,
      isActive: assigned ? Boolean(historical.isActive) : Boolean(employee.isActive),
      scheduleOrder: employee.scheduleOrder,
      rosterOrder: employee.scheduleOrder
    };
  }).filter((employee) => (employee.isActive || assignedSet.has(String(employee.id))) && (!department || employee.department === department));
  employees.sort(sortRoster);
  return { snapshotLocked: false, employees };
}

module.exports = {
  assertRosterDepartmentAuthority,
  ensureMonthlyRosterSnapshot,
  listDepartmentRoster,
  listMonthlyRosterOrder,
  loadCalendarRoster,
  monthStart,
  reorderDepartmentRoster,
  reorderMonthlyRoster,
  sortRoster
};
