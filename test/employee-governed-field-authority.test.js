'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN_FIELDS, MANAGER_FIELDS, normalizeChanges } = require('../src/services/employee-master-mutation.service');

test('governed Employee edit blocks direct employeeCode and hiredAt mutation', () => {
  assert.equal(ADMIN_FIELDS.includes('employeeCode'), false);
  assert.equal(ADMIN_FIELDS.includes('hiredAt'), false);
  assert.equal(MANAGER_FIELDS.includes('employeeCode'), false);
  assert.throws(() => normalizeChanges({ employeeCode: 'NEW-CODE' }, 'ADMIN'), (error) => error?.details?.code === 'EMPLOYEE_CHANGE_FIELD_NOT_ALLOWED');
  assert.throws(() => normalizeChanges({ hiredAt: '2026-01-01' }, 'ADMIN'), (error) => error?.details?.code === 'EMPLOYEE_CHANGE_FIELD_NOT_ALLOWED');
});

test('governed action fields remain available while safe general fields stay Admin-only', () => {
  for (const field of ['firstName','lastName','department','jobTitle','isActive']) {
    assert.equal(ADMIN_FIELDS.includes(field), true);
    assert.equal(MANAGER_FIELDS.includes(field), true);
  }
  for (const field of ['email','phone','skill']) {
    assert.equal(ADMIN_FIELDS.includes(field), true);
    assert.equal(MANAGER_FIELDS.includes(field), false);
  }
});
