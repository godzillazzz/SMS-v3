'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  GOVERNED_REASON_FIELDS,
  governedReasonRequired
} = require('../src/services/employee-master-mutation.service');

test('critical Employee changes require an auditable reason even when effective immediately', () => {
  assert.deepEqual(GOVERNED_REASON_FIELDS, ['firstName', 'lastName', 'department', 'jobTitle', 'isActive']);
  for (const field of GOVERNED_REASON_FIELDS) {
    assert.equal(governedReasonRequired({ [field]: field === 'isActive' ? false : 'new value' }, 'IMMEDIATE'), true, field);
  }
  assert.equal(governedReasonRequired({ phone: '0812345678' }, 'IMMEDIATE'), false);
  assert.equal(governedReasonRequired({ skill: 'CCTV' }, 'FUTURE_EFFECTIVE'), true);
});

test('Employee critical action source preserves the existing governed mutation and Manager request authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'personnel', 'EmployeeGovernedEditModal.tsx'), 'utf8');
  for (const action of ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION', 'REHIRE']) assert.match(source, new RegExp(action));
  assert.match(source, /api\.preflightEmployeeMasterEdit/);
  assert.match(source, /api\.updateEmployee/);
  assert.match(source, /api\.createEmployeeChangeDraft/);
  assert.match(source, /api\.submitEmployeeChangeRequest/);
  assert.doesNotMatch(source, /<EmployeeLifecycleModal/);
});
