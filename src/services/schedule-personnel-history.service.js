'use strict';

const { employeeState, hasLifecycleModel } = require('./employee-lifecycle.service');

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function normalizedState(snapshot, fallback) {
  return employeeState({ ...fallback, ...(snapshot || {}) });
}

async function createSchedulePersonnelResolver(client, employees) {
  const records = employees || [];
  const employeeById = new Map(records.map((employee) => [String(employee.id), employee]));
  const ids = [...employeeById.keys()];
  const eventsByEmployee = new Map();
  if (ids.length && hasLifecycleModel(client) && client.employeeLifecycleEvent?.findMany) {
    const events = await client.employeeLifecycleEvent.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, effectiveDate: true, sequence: true, oldValue: true, newValue: true },
      orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'asc' }, { sequence: 'asc' }]
    });
    for (const event of events) {
      const list = eventsByEmployee.get(String(event.employeeId)) || [];
      list.push(event);
      eventsByEmployee.set(String(event.employeeId), list);
    }
  }

  return (employeeId, asOfDate) => {
    const id = String(employeeId);
    const employee = employeeById.get(id);
    if (!employee) return null;
    const target = dateKey(asOfDate);
    const events = eventsByEmployee.get(id) || [];
    let latest = null;
    let earliestAfter = null;
    for (const event of events) {
      const effective = dateKey(event.effectiveDate);
      if (effective <= target) latest = event;
      else if (!earliestAfter) earliestAfter = event;
    }
    if (latest?.newValue?.employee) return normalizedState(latest.newValue.employee, employee);
    if (earliestAfter?.oldValue?.employee) return normalizedState(earliestAfter.oldValue.employee, employee);
    return employeeState(employee);
  };
}

async function loadScheduleEmployees(client, employeeIds) {
  const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  return client.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true }
  });
}

async function enrichScheduleAssignments(client, assignments, employees) {
  const records = employees || await loadScheduleEmployees(client, assignments.map((assignment) => assignment.employeeId));
  const resolve = await createSchedulePersonnelResolver(client, records);
  return assignments.map((assignment) => {
    const state = resolve(assignment.employeeId, assignment.workDate);
    if (!state) return assignment;
    return {
      ...assignment,
      employeeNameSnapshot: state.displayName,
      departmentSnapshot: state.department,
      positionSnapshot: state.jobTitle,
      historicalPersonnelState: state
    };
  });
}

module.exports = { createSchedulePersonnelResolver, enrichScheduleAssignments, loadScheduleEmployees };
