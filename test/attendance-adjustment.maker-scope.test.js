'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertMakerScope } = require('../src/services/attendance-adjustment.service');

const assignment = (employeeId, department = 'OPS') => ({
  employeeId,
  departmentSnapshot: department,
  employee: { department }
});

function forbidden(fn, code = 'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN') {
  assert.throws(fn, (error) => error.statusCode === 403 && error.details?.code === code);
}

test('EMPLOYEE maker scope is limited to the matching assignment employeeId', () => {
  assert.equal(assertMakerScope({ sub: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-1' }, assignment('employee-1')), 'EMPLOYEE');
  forbidden(() => assertMakerScope({ sub: 'employee-user', role: 'EMPLOYEE', employeeId: 'employee-1' }, assignment('employee-2')));
});

test('MANAGER maker scope is limited to the matching department', () => {
  assert.equal(assertMakerScope({ sub: 'manager-user', role: 'MANAGER', department: 'OPS' }, assignment('employee-1', 'OPS')), 'MANAGER');
  forbidden(() => assertMakerScope({ sub: 'manager-user', role: 'MANAGER', department: 'HR' }, assignment('employee-1', 'OPS')));
});

test('SUPERVISOR is denied maker scope regardless of department', () => {
  forbidden(
    () => assertMakerScope({ sub: 'supervisor-user', role: 'SUPERVISOR', department: 'OPS' }, assignment('employee-1', 'OPS')),
    'ATTENDANCE_ADJUSTMENT_FORBIDDEN'
  );
});
