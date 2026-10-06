'use strict';

const lifecycle = require('./employee-lifecycle.service');
const HttpError = require('../utils/http-error');

const NON_OPERATIONAL_SHIFT_CODES = new Set(['OFF', 'AL']);

async function employeeProjectedStateAt(client, employeeId, workDate) {
  const service = lifecycle.createEmployeeLifecycleService({ prismaClient: client });
  return service.projectedStateAt(employeeId, workDate, client);
}

async function createEmployeeProjectedStateResolver(client, rows = []) {
  const normalizedRows = (rows || [])
    .filter((row) => row?.employeeId && (row.workDate || row.date))
    .map((row) => ({ employeeId: String(row.employeeId), workDate: lifecycle.dateOnly(row.workDate || row.date) }));
  const employeeIds = [...new Set(normalizedRows.map((row) => row.employeeId))];
  if (!employeeIds.length) {
    return () => {
      throw new HttpError(404, 'Employee not found.');
    };
  }

  const maxDate = new Date(Math.max(...normalizedRows.map((row) => row.workDate.getTime())));
  const employees = await client.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true }
  });
  const events = lifecycle.hasLifecycleModel(client) && client.employeeLifecycleEvent?.findMany
    ? await client.employeeLifecycleEvent.findMany({
      where: { employeeId: { in: employeeIds }, effectiveDate: { lte: maxDate } },
      select: { employeeId: true, effectiveDate: true, sequence: true, newValue: true },
      orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'asc' }, { sequence: 'asc' }]
    })
    : [];

  const employeeById = new Map(employees.map((employee) => [String(employee.id), employee]));
  const eventsByEmployee = new Map();
  for (const event of events) {
    const key = String(event.employeeId);
    const list = eventsByEmployee.get(key) || [];
    list.push(event);
    eventsByEmployee.set(key, list);
  }

  return (employeeId, workDate) => {
    const id = String(employeeId);
    const date = lifecycle.dateOnly(workDate);
    const employee = employeeById.get(id);
    if (!employee || employee.deletedAt) throw new HttpError(404, 'Employee not found.');

    let latestEvent = null;
    for (const event of eventsByEmployee.get(id) || []) {
      if (new Date(event.effectiveDate) <= date) latestEvent = event;
      else break;
    }
    return latestEvent?.newValue?.employee
      ? lifecycle.employeeState(latestEvent.newValue.employee)
      : lifecycle.employeeState(employee);
  };
}

async function ensureEmployeeOperationalForShift(client, { employeeId, workDate, shiftCode, projectedStateResolver = null }) {
  const code = String(shiftCode || '').trim().toUpperCase();
  if (NON_OPERATIONAL_SHIFT_CODES.has(code)) return { allowed: true, nonOperational: true };
  const state = projectedStateResolver
    ? projectedStateResolver(employeeId, workDate)
    : await employeeProjectedStateAt(client, employeeId, workDate);
  if (!state.isActive) {
    throw new HttpError(409, 'Employee is not operational on the selected work date.', {
      code: 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT',
      employeeId,
      workDate: workDate instanceof Date ? workDate.toISOString().slice(0, 10) : String(workDate).slice(0, 10),
      employmentStatus: 'TERMINATED'
    });
  }
  return { allowed: true, nonOperational: false, state };
}

async function projectedScheduleConflictIds(client, shifts) {
  const operational = (shifts || []).filter((row) => !NON_OPERATIONAL_SHIFT_CODES.has(String(row.shiftType?.code || row.shiftCode || row.code || '').toUpperCase()));
  if (!operational.length) return new Set();
  const employeeIds = [...new Set(operational.map((row) => row.employeeId).filter(Boolean))];
  const maxDate = new Date(Math.max(...operational.map((row) => new Date(row.workDate || row.date).getTime())));
  const [employees, pendingEvents] = await Promise.all([
    client.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, isActive: true, deletedAt: true } }),
    client.employeeLifecycleEvent.findMany({ where: { employeeId: { in: employeeIds }, status: 'PENDING', effectiveDate: { lte: maxDate } }, select: { employeeId: true, effectiveDate: true, sequence: true, newValue: true }, orderBy: [{ effectiveDate: 'asc' }, { sequence: 'asc' }] })
  ]);
  const current = new Map(employees.map((row) => [row.id, !row.deletedAt && Boolean(row.isActive)]));
  const eventsByEmployee = new Map();
  for (const event of pendingEvents) { const rows = eventsByEmployee.get(event.employeeId) || []; rows.push(event); eventsByEmployee.set(event.employeeId, rows); }
  const conflicts = new Set();
  for (const shift of operational) {
    const date = new Date(shift.workDate || shift.date);
    let active = current.get(shift.employeeId) === true;
    for (const event of eventsByEmployee.get(shift.employeeId) || []) {
      if (new Date(event.effectiveDate) <= date && typeof event.newValue?.employee?.isActive === 'boolean') active = event.newValue.employee.isActive;
    }
    if (!active && shift.id) conflicts.add(String(shift.id));
  }
  return conflicts;
}

async function validateScheduleRowsOperational(client, rows) {
  for (const row of rows || []) {
    await ensureEmployeeOperationalForShift(client, { employeeId: row.employeeId, workDate: row.workDate || row.date, shiftCode: row.shiftCode || row.code });
  }
}

module.exports = { NON_OPERATIONAL_SHIFT_CODES, employeeProjectedStateAt, createEmployeeProjectedStateResolver, ensureEmployeeOperationalForShift, validateScheduleRowsOperational, projectedScheduleConflictIds };
