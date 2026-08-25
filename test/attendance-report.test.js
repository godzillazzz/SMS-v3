'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { reportRows, buildAttendanceWorkbook, createAttendanceReportService } = require('../src/services/attendance-report.service');

const report = {
  certificationId: '11111111-1111-4111-8111-111111111111',
  month: '2026-08',
  revision: 2,
  status: 'CERTIFIED',
  summaryDigest: 'a'.repeat(64),
  certifiedAt: new Date('2026-09-01T01:00:00.000Z'),
  snapshot: {
    summary: { assignments: 1, complete: 1 },
    rows: [{
      workDate: '2026-08-25', employeeCode: 'E001', employeeName: 'สมชาย ใจดี', department: 'OPS',
      expectedSite: { code: 'PS01', name: 'Site A' }, actualSiteId: 'site-a', shift: { code: 'DAY', name: 'Day' },
      expectedStartAt: '2026-08-25T00:00:00.000Z', expectedEndAt: '2026-08-25T12:00:00.000Z',
      originalCheckInAt: '2026-08-25T00:01:00.000Z', originalCheckOutAt: null,
      checkInAt: '2026-08-25T00:00:00.000Z', checkOutAt: '2026-08-25T12:00:00.000Z', workedMinutes: 720,
      status: 'COMPLETE', flags: ['CORRECTED'], corrections: [{ id: 'c1' }],
      photo: 'must-never-export', verificationSnapshot: { secret: true }
    }]
  }
};

test('report projection includes official operational fields and excludes biometric evidence', () => {
  const rows = reportRows(report.snapshot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeName, 'สมชาย ใจดี');
  assert.equal(rows[0].originalCheckOutAt, '-');
  assert.equal(rows[0].correctionCount, '1');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'photo'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'verificationSnapshot'), false);
});

test('certified Attendance workbook is a valid XLSX zip with revision metadata and no face evidence', () => {
  const buffer = buildAttendanceWorkbook(report);
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
  const archive = unzipSync(new Uint8Array(buffer));
  const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /Official Attendance 2026-08 Rev\.2/);
  assert.match(sheet, /สมชาย ใจดี/);
  assert.match(sheet, /CORRECTED/);
  assert.doesNotMatch(sheet, /must-never-export|verificationSnapshot|secret/);
});

test('official report fails closed when the month has no current certification', async () => {
  const prisma = { $queryRaw: async () => [] };
  const service = createAttendanceReportService({ prisma });
  await assert.rejects(() => service.official('2026-08'), (error) => error?.details?.code === 'ATTENDANCE_REPORT_NOT_CERTIFIED');
});

test('official report is sourced from the frozen certification snapshot', async () => {
  const prisma = {
    $queryRaw: async () => [{
      id: report.certificationId, month: new Date('2026-08-01T00:00:00.000Z'), revision: 2, status: 'CERTIFIED',
      summarySnapshot: report.snapshot, summaryDigest: report.summaryDigest, certifiedByUserId: 'admin', certifiedAt: report.certifiedAt
    }]
  };
  const service = createAttendanceReportService({ prisma });
  const result = await service.official('2026-08');
  assert.equal(result.revision, 2);
  assert.equal(result.rows[0].workedMinutes, '720');
  assert.deepEqual(result.summary, { assignments: 1, complete: 1 });
});
