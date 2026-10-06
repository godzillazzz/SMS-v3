process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { buildApprovedScheduleWorkbook, thaiMonth } = require('../src/services/schedule-export.service');

test('approved schedule export is a custom-formatted multi-sheet XLSX workbook', () => {
  const workbook = buildApprovedScheduleWorkbook({
    month: '2026-07',
    approval: { revision: 4, approvedAt: new Date('2026-07-01T00:00:00Z'), approvedByDisplayName: 'Sample Approver' },
    departments: ['SAMPLE-A', 'SAMPLE-B'],
    shifts: [
      { employeeId: 'employee-a', employeeNameSnapshot: 'Sample Employee A', departmentSnapshot: 'SAMPLE-A', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'D' } },
      { employeeId: 'employee-b', employeeNameSnapshot: 'Sample Employee B', departmentSnapshot: 'SAMPLE-B', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'N' } }
    ],
    employees: [{ id: 'employee-a', jobTitle: 'Supervisor' }, { id: 'employee-b', jobTitle: 'Security Officer' }],
    shiftTypes: [{ code: 'D', name: 'Day', startTime: '08:00', endTime: '20:00', hours: 12 }, { code: 'N', name: 'Night', startTime: '20:00', endTime: '08:00', hours: 12 }],
    exportedBy: 'Sample Administrator'
  });
  assert.equal(workbook.subarray(0, 2).toString(), 'PK');
  const files = unzipSync(workbook);
  assert.ok(files['xl/worksheets/sheet1.xml']);
  assert.ok(files['xl/worksheets/sheet2.xml']);
  const firstSheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  const styles = strFromU8(files['xl/styles.xml']);
  assert.match(firstSheet, /ตารางกะที่อนุมัติแล้ว/);
  assert.match(firstSheet, /Revision: 4/);
  assert.match(firstSheet, /ผู้อนุมัติ: Sample Approver/);
  assert.match(firstSheet, /\(Sample Approver\)/);
  assert.match(firstSheet, /คำอธิบายรหัสกะ/);
  assert.match(firstSheet, /ผู้จัดการเขต \(ผู้อนุมัติ\)/);
  assert.match(styles, /<name val="Sarabun"\/>/);
});

test('Excel title uses the Buddhist year like the legacy report', () => {
  assert.equal(thaiMonth('2026-07'), 'กรกฎาคม 2569');
});

test('approved export sorts by employee code, ignoring historic custom positions', () => {
  const month = '2026-07';
  const shifts = [
    { employeeId: 'a', employeeCodeSnapshot: 'ST-10', employeeNameSnapshot: 'Sample 10', rosterOrder: 1, departmentSnapshot: 'A', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'D' } },
    { employeeId: 'b', employeeCodeSnapshot: 'ST-2', employeeNameSnapshot: 'Sample 2', rosterOrder: 900, departmentSnapshot: 'A', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'N' } },
    { employeeId: 'c', employeeCodeSnapshot: 'ST-1', employeeNameSnapshot: 'Sample 1', rosterOrder: 500, departmentSnapshot: 'A', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'OFF' } }
  ];
  const workbook = buildApprovedScheduleWorkbook({
    month, approval: { revision: 1 }, departments: ['A'], shifts,
    employees: shifts.map((row) => ({ id: row.employeeId, employeeCode: row.employeeCodeSnapshot, jobTitle: 'Security' })),
    shiftTypes: [{ code: 'D', name: 'Day' }, { code: 'N', name: 'Night' }, { code: 'OFF', name: 'Off' }],
    exportedBy: 'Test'
  });
  const xml = strFromU8(unzipSync(workbook)['xl/worksheets/sheet1.xml']);
  assert.ok(xml.indexOf('Sample 1') < xml.indexOf('Sample 2'));
  assert.ok(xml.indexOf('Sample 2') < xml.indexOf('Sample 10'));
});

test('approved export orders department sheets naturally and employee rows by department then code', () => {
  const shifts = [
    { employeeId: 'ten', employeeCodeSnapshot: 'ST-1', employeeNameSnapshot: 'AN10 Employee', departmentSnapshot: 'AN10', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'D' } },
    { employeeId: 'code-10', employeeCodeSnapshot: 'ST-10', employeeNameSnapshot: 'Sample 10', departmentSnapshot: 'AN2', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'N' } },
    { employeeId: 'code-2', employeeCodeSnapshot: 'ST-2', employeeNameSnapshot: 'Sample 2', departmentSnapshot: 'AN2', workDate: new Date('2026-07-01T00:00:00Z'), hours: 12, shiftType: { code: 'OFF' } }
  ];
  const workbook = buildApprovedScheduleWorkbook({
    month: '2026-07', approval: { revision: 1 }, departments: ['AN10', 'AN2'], shifts,
    employees: shifts.map((row) => ({ id: row.employeeId, employeeCode: row.employeeCodeSnapshot, department: row.departmentSnapshot, jobTitle: 'Security' })),
    shiftTypes: [{ code: 'D', name: 'Day' }, { code: 'N', name: 'Night' }, { code: 'OFF', name: 'Off' }],
    exportedBy: 'Test'
  });
  const files = unzipSync(workbook);
  const workbookXml = strFromU8(files['xl/workbook.xml']);
  const scheduleSheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(workbookXml.indexOf('name="AN2"') < workbookXml.indexOf('name="AN10"'));
  assert.ok(scheduleSheet.indexOf('Sample 2') < scheduleSheet.indexOf('Sample 10'));
});
