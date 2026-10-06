'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareScheduleEmployeesByDepartment } = require('../src/services/schedule-employee-order.service');

test('schedule comparator uses natural department, employee code, and id ordering with blank departments last', () => {
  const rows = [
    { id: 'z', department: 'AN10', employeeCode: 'ST-1' },
    { id: 'c', department: 'AN2', employeeCode: 'ST-10' },
    { id: 'b', department: 'AN2', employeeCode: 'ST-2' },
    { id: 'a', department: 'AN2', employeeCode: 'ST-2' },
    { id: 'none', department: '', employeeCode: 'ST-0' }
  ];

  assert.deepEqual(rows.sort(compareScheduleEmployeesByDepartment).map((row) => row.id), ['a', 'b', 'c', 'z', 'none']);
});
