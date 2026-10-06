const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmployeeProjectedStateResolver,
  employeeProjectedStateAt,
  ensureEmployeeOperationalForShift
} = require('../src/services/employee-operational-eligibility.service');

function employee(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    firstName: 'Batch',
    lastName: 'Employee',
    displayName: 'Batch Employee',
    department: 'Ops',
    jobTitle: 'Guard',
    isActive: true,
    deletedAt: null,
    ...overrides
  };
}

function snapshot(base, overrides = {}) {
  return {
    firstName: base.firstName,
    lastName: base.lastName,
    displayName: base.displayName,
    department: base.department,
    jobTitle: base.jobTitle,
    isActive: base.isActive,
    ...overrides
  };
}

function fakeClient({ employees, events }) {
  const calls = { employeeFindMany: 0, lifecycleFindMany: 0, employeeFindUnique: 0, lifecycleFindFirst: 0 };
  const byId = new Map(employees.map((row) => [row.id, row]));
  return {
    calls,
    employee: {
      findMany: async ({ where }) => {
        calls.employeeFindMany += 1;
        const ids = new Set(where.id.in);
        return employees.filter((row) => ids.has(row.id));
      },
      findUnique: async ({ where }) => {
        calls.employeeFindUnique += 1;
        return byId.get(where.id) || null;
      }
    },
    employeeLifecycleEvent: {
      findMany: async ({ where }) => {
        calls.lifecycleFindMany += 1;
        const ids = new Set(where.employeeId.in);
        const maxDate = new Date(where.effectiveDate.lte);
        return events
          .filter((row) => ids.has(row.employeeId) && new Date(row.effectiveDate) <= maxDate)
          .sort((a, b) => {
            const employeeOrder = String(a.employeeId).localeCompare(String(b.employeeId));
            if (employeeOrder) return employeeOrder;
            const dateOrder = new Date(a.effectiveDate) - new Date(b.effectiveDate);
            return dateOrder || Number(a.sequence) - Number(b.sequence);
          });
      },
      findFirst: async ({ where }) => {
        calls.lifecycleFindFirst += 1;
        const maxDate = new Date(where.effectiveDate.lte);
        return events
          .filter((row) => row.employeeId === where.employeeId && new Date(row.effectiveDate) <= maxDate)
          .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate) || Number(b.sequence) - Number(a.sequence))[0] || null;
      }
    }
  };
}

test('bulk projected-state resolver preserves projectedStateAt semantics while collapsing 120-row lifecycle reads', async () => {
  const base = employee();
  const events = [
    {
      employeeId: base.id,
      effectiveDate: new Date('2026-10-15T00:00:00.000Z'),
      sequence: 1,
      newValue: { employee: snapshot(base, { isActive: false }) }
    },
    {
      employeeId: base.id,
      effectiveDate: new Date('2026-10-20T00:00:00.000Z'),
      sequence: 1,
      newValue: { employee: snapshot(base, { displayName: 'Batch Employee Rehired', isActive: true }) }
    },
    {
      employeeId: base.id,
      effectiveDate: new Date('2026-10-20T00:00:00.000Z'),
      sequence: 2,
      newValue: { employee: snapshot(base, { displayName: 'Batch Employee Final', isActive: false }) }
    }
  ];
  const client = fakeClient({ employees: [base], events });
  const rows = Array.from({ length: 120 }, (_, index) => ({
    employeeId: base.id,
    workDate: `2026-10-${String((index % 26) + 1).padStart(2, '0')}`
  }));

  const resolve = await createEmployeeProjectedStateResolver(client, rows);
  assert.equal(client.calls.employeeFindMany, 1);
  assert.equal(client.calls.lifecycleFindMany, 1);

  for (const date of ['2026-10-10', '2026-10-16', '2026-10-20', '2026-10-26']) {
    const legacy = await employeeProjectedStateAt(client, base.id, date);
    assert.deepEqual(resolve(base.id, date), legacy);
  }

  assert.equal(client.calls.employeeFindMany, 1);
  assert.equal(client.calls.lifecycleFindMany, 1);
  assert.equal(client.calls.employeeFindUnique, 4);
  assert.equal(client.calls.lifecycleFindFirst, 4);
});

test('bulk resolver preserves deleted-employee failure and OFF/AL bypass behavior', async () => {
  const deleted = employee({ id: '00000000-0000-4000-8000-000000000102', deletedAt: new Date('2026-10-01T00:00:00.000Z') });
  const client = fakeClient({ employees: [deleted], events: [] });
  const resolve = await createEmployeeProjectedStateResolver(client, [{ employeeId: deleted.id, workDate: '2026-10-10' }]);

  assert.throws(() => resolve(deleted.id, '2026-10-10'), (error) => error.statusCode === 404 && error.message === 'Employee not found.');
  await assert.doesNotReject(() => ensureEmployeeOperationalForShift(client, {
    employeeId: deleted.id,
    workDate: '2026-10-10',
    shiftCode: 'OFF',
    projectedStateResolver: () => { throw new Error('resolver must not be called for OFF'); }
  }));
  await assert.doesNotReject(() => ensureEmployeeOperationalForShift(client, {
    employeeId: deleted.id,
    workDate: '2026-10-10',
    shiftCode: 'AL',
    projectedStateResolver: () => { throw new Error('resolver must not be called for AL'); }
  }));
});

test('bulk resolver keeps inactive operational shifts blocked with the same conflict contract', async () => {
  const inactive = employee({ id: '00000000-0000-4000-8000-000000000103', isActive: false });
  const client = fakeClient({ employees: [inactive], events: [] });
  const resolve = await createEmployeeProjectedStateResolver(client, [{ employeeId: inactive.id, workDate: '2026-10-10' }]);

  await assert.rejects(
    () => ensureEmployeeOperationalForShift(client, {
      employeeId: inactive.id,
      workDate: new Date('2026-10-10T00:00:00.000Z'),
      shiftCode: 'D',
      projectedStateResolver: resolve
    }),
    (error) => error.statusCode === 409
      && error.details?.code === 'INACTIVE_EMPLOYEE_SCHEDULE_CONFLICT'
      && error.details?.employeeId === inactive.id
      && error.details?.workDate === '2026-10-10'
      && error.details?.employmentStatus === 'TERMINATED'
  );
});
