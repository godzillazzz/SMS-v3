'use strict';

const HttpError = require('../utils/http-error');
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

/** Display order is always employee code (numeric-aware), never a mutable roster position. */
function sortRoster(a, b) {
  const left = String(a.employeeCode || '');
  const right = String(b.employeeCode || '');
  const byCode = left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
  if (byCode) return byCode;
  const byDepartment = String(a.department || '').localeCompare(String(b.department || ''), 'th');
  if (byDepartment) return byDepartment;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

async function assignedEmployeeIdsForMonth(client, start, end) {
  const rows = await client.shiftAssignment.findMany({
    where: { workDate: { gte: start, lt: end } },
    select: { employeeId: true },
    distinct: ['employeeId']
  });
  return rows.map((row) => String(row.employeeId));
}

/**
 * Monthly roster is derived live from Employee master plus employees that already
 * have assignments in the selected month. ScheduleRosterSnapshot is intentionally
 * not read or written: an incomplete snapshot must never hide active employees.
 */
async function loadCalendarRoster(client, month, { department, search } = {}) {
  const start = monthStart(month);
  const end = monthEnd(start);
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
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      displayName: true,
      department: true,
      jobTitle: true,
      isActive: true,
      deletedAt: true,
      scheduleOrder: true
    },
    orderBy: [{ employeeCode: 'asc' }, { department: 'asc' }]
  });

  const resolvePersonnel = await createSchedulePersonnelResolver(client, candidates);
  const employees = candidates.map((employee) => {
    const historical = resolvePersonnel(employee.id, start) || {};
    const assigned = assignedSet.has(String(employee.id));
    return {
      ...employee,
      ...historical,
      isActive: assigned ? Boolean(historical.isActive) : Boolean(employee.isActive)
    };
  }).filter((employee) =>
    (employee.isActive || assignedSet.has(String(employee.id))) &&
    (!department || employee.department === department)
  );

  employees.sort(sortRoster);
  return { employees };
}

module.exports = {
  loadCalendarRoster,
  monthStart,
  sortRoster
};
