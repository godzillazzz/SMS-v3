process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutoSchedulePlan, buildEmployeeAutoSchedulePlan, monthBounds, suggestedPhase } = require('../src/services/auto-schedule.service');
const { CORE_AUTO_SCHEDULE_PATTERNS } = require('../src/services/auto-schedule-pattern.service');

const shiftTypes = [
  { id: 'shift-d', code: 'D', name: 'Day', startTime: '08:00', endTime: '20:00', hours: 12, color: '#10B981' },
  { id: 'shift-n', code: 'N', name: 'Night', startTime: '20:00', endTime: '08:00', hours: 12, color: '#7C3AED' },
  { id: 'shift-off', code: 'OFF', name: 'Off', startTime: null, endTime: null, hours: 0, color: '#EF4444' },
  { id: 'shift-al', code: 'AL', name: 'Leave', startTime: null, endTime: null, hours: 0, color: '#3B82F6' }
];
const employees = [
  { id: 'supervisor', employeeCode: 'SAMPLE-SUP', displayName: 'Sample Supervisor', firstName: 'Sample', lastName: 'Supervisor', department: 'SAMPLE', jobTitle: 'Supervisor' },
  { id: 'worker', employeeCode: 'SAMPLE-WRK', displayName: 'Sample Worker', firstName: 'Sample', lastName: 'Worker', department: 'SAMPLE', jobTitle: 'Security Officer' }
];
const licenses = employees.map((employee) => ({ employeeId: employee.id, issueDate: new Date('2020-01-01T00:00:00Z'), expiryDate: new Date('2030-01-01T00:00:00Z'), status: 'Active' }));

function client({ current = [], history = [], employeeRows = employees, licenseRows = licenses, patternRows = CORE_AUTO_SCHEDULE_PATTERNS } = {}) {
  let shiftQuery = 0;
  return {
    schedulingRule: { findMany: async () => [{ ruleId: 'RULE001', value: '72', enabled: true }] },
    employee: { findMany: async () => employeeRows },
    shiftType: { findMany: async () => shiftTypes },
    shiftAssignment: { findMany: async () => (++shiftQuery === 1 ? current : history) },
    employeeLicense: { findMany: async () => licenseRows },
    autoSchedulePattern: {
      findMany: async ({ where } = {}) => patternRows
        .filter((pattern) => !where?.isActive || pattern.isActive !== false)
        .map((pattern) => ({ ...pattern, steps: pattern.steps.map((step) => ({ ...step })) }))
    }
  };
}

test('auto schedule preview follows Supervisor and six-day rotating patterns without writing', async () => {
  const plan = await buildAutoSchedulePlan(client(), '2026-07');
  assert.equal(plan.summary.employees, 2);
  assert.equal(plan.rows.length, 62);
  const supervisorSunday = plan.rows.find((row) => row.employeeId === 'supervisor' && row.date === '2026-07-05');
  assert.equal(supervisorSunday.code, 'OFF');
  assert.deepEqual(plan.rows.filter((row) => row.employeeId === 'worker').slice(0, 7).map((row) => row.code), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']);
});

test('bulk magic-wand preview replaces ordinary manual rows but preserves approved leave and Admin license overrides', async () => {
  const current = [
    { employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'replace me', licenseOverride: false, shiftType: shiftTypes[1] },
    { employeeId: 'worker', workDate: new Date('2026-07-02T00:00:00Z'), locked: false, source: 'LEAVE_APPROVAL', remark: 'leave', licenseOverride: false, shiftType: shiftTypes[3] },
    { employeeId: 'worker', workDate: new Date('2026-07-03T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, overrideReason: 'Approved coverage', shiftType: shiftTypes[1] }
  ];
  const plan = await buildAutoSchedulePlan(client({ current }), '2026-07');
  const manual = plan.rows.find((row) => row.employeeId === 'worker' && row.date === '2026-07-01');
  const leave = plan.rows.find((row) => row.employeeId === 'worker' && row.date === '2026-07-02');
  const override = plan.rows.find((row) => row.employeeId === 'worker' && row.date === '2026-07-03');
  assert.equal(manual.code, 'D');
  assert.equal(manual.locked, false);
  assert.equal(leave.code, 'AL');
  assert.equal(override.code, 'N');
  assert.equal(override.licenseOverride, true);
  assert.equal(override.overrideReason, 'Approved coverage');
  assert.equal(plan.summary.manualLocked, 2);
});

test('bulk and individual magic-wand share AUTO Continue phase analysis', async () => {
  const history = [
    { employeeId: 'worker', workDate: new Date('2026-06-30T00:00:00Z'), shiftType: { code: 'N' } },
    { employeeId: 'worker', workDate: new Date('2026-06-29T00:00:00Z'), shiftType: { code: 'N' } }
  ];
  const bulk = await buildAutoSchedulePlan(client({ history }), '2026-07');
  const individual = await buildEmployeeAutoSchedulePlan(client({ history }), '2026-07', 'worker', 'AUTO', 'ROTATE');
  const bulkRows = bulk.rows.filter((row) => row.employeeId === 'worker');
  assert.equal(individual.analysis.code, 'N3');
  assert.deepEqual(bulkRows.map((row) => row.code), individual.rows.map((row) => row.code));
  assert.deepEqual(bulkRows.slice(0, 5).map((row) => row.code), ['N', 'N', 'N', 'N', 'OFF']);
});

test('bulk uses the same individual history behavior when the previous-month final day is missing', async () => {
  const history = [
    { employeeId: 'worker', workDate: new Date('2026-06-29T00:00:00Z'), shiftType: { code: 'N' } },
    { employeeId: 'worker', workDate: new Date('2026-06-28T00:00:00Z'), shiftType: { code: 'N' } }
  ];
  const bulk = await buildAutoSchedulePlan(client({ history }), '2026-07');
  const individual = await buildEmployeeAutoSchedulePlan(client({ history }), '2026-07', 'worker', 'AUTO', 'ROTATE');
  const bulkRows = bulk.rows.filter((row) => row.employeeId === 'worker');
  assert.equal(individual.analysis.code, 'N3');
  assert.deepEqual(bulkRows.map((row) => row.code), individual.rows.map((row) => row.code));
  assert.deepEqual(bulkRows.slice(0, 5).map((row) => row.code), ['N', 'N', 'N', 'N', 'OFF']);
});

test('bulk and individual Supervisor pattern produce identical rows', async () => {
  const bulk = await buildAutoSchedulePlan(client(), '2026-07');
  const individual = await buildEmployeeAutoSchedulePlan(client(), '2026-07', 'supervisor', 'AUTO', 'SUPERVISOR');
  const bulkRows = bulk.rows.filter((row) => row.employeeId === 'supervisor');
  assert.deepEqual(bulkRows.map((row) => row.code), individual.rows.map((row) => row.code));
  assert.equal(bulkRows.find((row) => row.date === '2026-07-05').code, 'OFF');
});
test('individual magic-wand plan writes only the selected employee six-on/one-off rotation', async () => {
  const plan = await buildEmployeeAutoSchedulePlan(client(), '2026-07', 'worker');
  assert.equal(plan.summary.employees, 1);
  assert.equal(plan.rows.length, 31);
  assert.ok(plan.rows.every((row) => row.employeeId === 'worker'));
  assert.deepEqual(plan.rows.slice(0, 7).map((row) => row.code), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']);
});

test('auto schedule substitutes OFF and warns when a working license is unavailable', async () => {
  const plan = await buildAutoSchedulePlan(client({ licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07');
  assert.ok(plan.rows.filter((row) => row.employeeId === 'worker').every((row) => row.code === 'OFF'));
  assert.ok(plan.warnings.some((warning) => /Sample Worker/.test(warning) && /ใบอนุญาต/.test(warning)));
});

test('individual magic-wand converts an expired-license work pattern to OFF License Block rows', async () => {
  const plan = await buildEmployeeAutoSchedulePlan(client({ licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07', 'worker', 'D1', 'ROTATE');
  assert.ok(plan.rows.every((row) => row.code === 'OFF'));
  assert.ok(plan.rows.some((row) => String(row.remark).includes('License Block')));
});

test('individual magic-wand replaces a prior locked License Block when a renewal is effective', async () => {
  const current = [{
    employeeId: 'worker', workDate: new Date('2026-07-26T00:00:00Z'), locked: true, source: 'MANUAL',
    remark: 'License Block', licenseStatus: 'EXPIRED', licenseOverride: false,
    licenseBlockedFromShiftTypeId: 'shift-d', licenseBlockedFromRemark: 'Auto rotating pattern (D1)', shiftType: shiftTypes[2]
  }];
  const renewed = [
    { employeeId: 'worker', issueDate: new Date('2026-07-26T00:00:00Z'), expiryDate: new Date('2027-07-25T00:00:00Z'), status: 'Active' },
    ...licenses.filter((license) => license.employeeId !== 'worker')
  ];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current, licenseRows: renewed }), '2026-07', 'worker', 'D1', 'ROTATE');
  const day = plan.rows.find((row) => row.date === '2026-07-26');
  assert.equal(day.code, 'N');
  assert.equal(day.locked, false);
  assert.equal(day.licenseStatus, 'VALID');
  assert.equal(day.licenseBlockedFromShiftTypeId, null);
});

test('individual magic-wand retains an existing Admin license override during an expired interval', async () => {
  const current = [{
    employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL',
    remark: 'Admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, overrideReason: 'Approved coverage', shiftType: shiftTypes[1]
  }];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current, licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07', 'worker', 'D1', 'ROTATE');
  const override = plan.rows.find((row) => row.date === '2026-07-01');
  assert.equal(override.code, 'N');
  assert.equal(override.locked, true);
  assert.equal(override.licenseOverride, true);
  assert.equal(override.licenseStatus, 'OVERRIDDEN');
  assert.equal(override.overrideReason, 'Approved coverage');
});

test('the latest magic-wand action replaces prior manual shifts but keeps leave and Admin overrides', async () => {
  const current = [
    { employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'old manual', licenseOverride: false, shiftType: shiftTypes[2] },
    { employeeId: 'worker', workDate: new Date('2026-07-02T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, shiftType: shiftTypes[1] },
    { employeeId: 'worker', workDate: new Date('2026-07-03T00:00:00Z'), locked: true, source: 'LEAVE_APPROVAL', remark: 'leave', licenseOverride: false, shiftType: shiftTypes[3] }
  ];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current }), '2026-07', 'worker', 'D1', 'ROTATE');
  const first = plan.rows.find((row) => row.date === '2026-07-01');
  const override = plan.rows.find((row) => row.date === '2026-07-02');
  const leave = plan.rows.find((row) => row.date === '2026-07-03');
  assert.equal(first.code, 'D');
  assert.equal(first.locked, false);
  assert.equal(override.code, 'N');
  assert.equal(override.licenseOverride, true);
  assert.equal(leave.code, 'AL');
});

test('auto schedule date and history helpers are deterministic', () => {
  const rotate = CORE_AUTO_SCHEDULE_PATTERNS.find((pattern) => pattern.code === 'ROTATE');
  assert.equal(monthBounds('2026-02').dates.length, 28);
  assert.equal(suggestedPhase([{ shiftType: { code: 'D' } }, { shiftType: { code: 'D' } }], rotate), 'D3');
  assert.equal(suggestedPhase([{ shiftType: { code: 'OFF' } }, { shiftType: { code: 'D' } }], rotate), 'N1');
});


test('custom Pattern Master preview uses custom phases while preserving AL and Admin license override', async () => {
  const custom = {
    id: 'custom-team-a',
    code: 'TEAM_A',
    name: 'Team A Custom',
    mode: 'CYCLE',
    steps: [
      { phaseCode: 'A1', shiftCode: 'N', label: 'Night first' },
      { phaseCode: 'A2', shiftCode: 'OFF', label: 'Rest' },
      { phaseCode: 'A3', shiftCode: 'D', label: 'Day third' }
    ],
    isActive: true,
    isSystem: false,
    targetGroup: 'MANUAL',
    sortOrder: 100
  };
  const current = [
    { employeeId: 'worker', workDate: new Date('2026-07-02T00:00:00Z'), locked: true, source: 'LEAVE_APPROVAL', remark: 'leave', licenseOverride: false, shiftType: shiftTypes[3] },
    { employeeId: 'worker', workDate: new Date('2026-07-03T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, overrideReason: 'Approved coverage', shiftType: shiftTypes[1] }
  ];
  const plan = await buildEmployeeAutoSchedulePlan(
    client({ current, patternRows: [...CORE_AUTO_SCHEDULE_PATTERNS, custom] }),
    '2026-07',
    'worker',
    'A1',
    'TEAM_A'
  );
  assert.deepEqual(plan.rows.slice(0, 4).map((row) => row.code), ['N', 'AL', 'N', 'N']);
  assert.equal(plan.rows[0].phaseCode, 'A1');
  assert.equal(plan.rows[1].phaseCode, null);
  assert.equal(plan.rows[2].phaseCode, null);
  assert.equal(plan.rows[2].licenseOverride, true);
  assert.equal(plan.rows[2].overrideReason, 'Approved coverage');
  assert.equal(plan.pattern.code, 'TEAM_A');
  assert.equal(plan.effectivePhase, 'A1');
});

test('custom Pattern Master rejects a phase that does not belong to the selected pattern', async () => {
  const custom = {
    id: 'custom-team-a',
    code: 'TEAM_A',
    name: 'Team A Custom',
    mode: 'CYCLE',
    steps: [
      { phaseCode: 'A1', shiftCode: 'D', label: 'Day' },
      { phaseCode: 'A2', shiftCode: 'OFF', label: 'Rest' }
    ],
    isActive: true,
    isSystem: false,
    targetGroup: 'MANUAL',
    sortOrder: 100
  };
  await assert.rejects(
    () => buildEmployeeAutoSchedulePlan(
      client({ patternRows: [...CORE_AUTO_SCHEDULE_PATTERNS, custom] }),
      '2026-07',
      'worker',
      'D1',
      'TEAM_A'
    ),
    (error) => error?.statusCode === 400 && error?.details?.code === 'AUTO_SCHEDULE_PHASE_NOT_FOUND'
  );
});

test('inactive custom Pattern Master is excluded from new previews', async () => {
  const inactive = {
    id: 'custom-inactive',
    code: 'INACTIVE_X',
    name: 'Inactive',
    mode: 'CYCLE',
    steps: [{ phaseCode: 'X1', shiftCode: 'D', label: 'Day' }],
    isActive: false,
    isSystem: false,
    targetGroup: 'MANUAL',
    sortOrder: 100
  };
  await assert.rejects(
    () => buildEmployeeAutoSchedulePlan(
      client({ patternRows: [...CORE_AUTO_SCHEDULE_PATTERNS, inactive] }),
      '2026-07',
      'worker',
      'X1',
      'INACTIVE_X'
    ),
    (error) => error?.statusCode === 404 && error?.details?.code === 'AUTO_SCHEDULE_PATTERN_NOT_FOUND'
  );
});
