process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { buildApprovedScheduleWorkbook, thaiMonth } = require('../src/services/schedule-export.service');

test('approved schedule export is a custom-formatted multi-sheet XLSX workbook', () => {
  const workbook = buildApprovedScheduleWorkbook({
    month: '2026-07',
    approval: { revision: 4, approvedAt: new Date('2026-07-01T00:00:00Z') },
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
  assert.match(firstSheet, /คำอธิบายรหัสกะ/);
  assert.match(firstSheet, /ผู้จัดการเขต \(ผู้อนุมัติ\)/);
  assert.match(styles, /<name val="Sarabun"\/>/);
});

test('Excel title uses the Buddhist year like the legacy report', () => {
  assert.equal(thaiMonth('2026-07'), 'กรกฎาคม 2569');
});
