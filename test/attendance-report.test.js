'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const {
  attendanceResultText,
  buildAttendanceWorkbook,
  loadCertifiedAttendanceMonth,
  reportId
} = require('../src/services/attendance-report.service');

function certification() {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    month: new Date('2026-08-01T00:00:00.000Z'),
    revision: 3,
    status: 'CERTIFIED',
    summaryDigest: 'a'.repeat(64),
    certifiedByUserId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    certifiedAt: new Date('2026-09-01T02:00:00.000Z'),
    snapshot: {
      version: 'ATTENDANCE_MONTH_OFFICIAL_V1',
      month: '2026-08',
      generatedAt: '2026-09-01T02:00:00.000Z',
      summary: {
        assignments: 2,
        complete: 1,
        absent: 0,
        leave: 0,
        late: 1,
        earlyOut: 0,
        assistOtherSite: 1,
        wrongShift: 0,
        outsideAllSites: 0,
        corrected: 0,
        timeAbnormal: 1
      },
      rows: [
        {
          assignmentId: 'assignment-a',
          employeeCode: 'EMP-001',
          employeeName: 'สมชาย ทดสอบ',
          department: 'SECURITY-A',
          workDate: '2026-08-25',
          expectedSite: { id: 'site-a', code: 'A', name: 'Site A' },
          actualSite: { id: 'site-b', code: 'B', name: 'Site B' },
          shift: { code: 'DAY', name: 'Day' },
          expectedStartAt: '2026-08-25T00:00:00.000Z',
          expectedEndAt: '2026-08-25T12:00:00.000Z',
          checkInAt: '2026-08-25T00:05:00.000Z',
          checkOutAt: '2026-08-25T12:00:00.000Z',
          workedMinutes: 715,
          lateMinutes: 5,
          earlyOutMinutes: 0,
          status: 'COMPLETE',
          flags: ['LATE', 'ASSIST_OTHER_SITE'],
          locationEvidence: { latitude: '13.0000000', longitude: '100.0000000', secretMarker: 'RAW-LOCATION-MUST-NOT-EXPORT' },
          verificationSnapshot: { referencePhotoId: 'PHOTO-MUST-NOT-EXPORT' }
        },
        {
          assignmentId: 'assignment-b',
          employeeCode: 'EMP-002',
          employeeName: 'สมหญิง ทดสอบ',
          department: 'SECURITY-B',
          workDate: '2026-08-25',
          expectedSite: { id: 'site-a', code: 'A', name: 'Site A' },
          actualSite: { id: 'site-a', code: 'A', name: 'Site A' },
          shift: { code: 'NIGHT', name: 'Night' },
          expectedStartAt: '2026-08-25T12:00:00.000Z',
          expectedEndAt: '2026-08-26T00:00:00.000Z',
          checkInAt: '2026-08-25T12:00:00.000Z',
          checkOutAt: null,
          workedMinutes: null,
          lateMinutes: 0,
          earlyOutMinutes: null,
          status: 'IN_PROGRESS',
          flags: ['ON_TIME', 'MISSING_CHECK_OUT', 'TIME_ABNORMAL']
        }
      ]
    }
  };
}

test('official Attendance XLSX is generated from certified snapshot without raw photo/location evidence', () => {
  const current = certification();
  const workbook = buildAttendanceWorkbook({
    certification: current,
    generatedBy: 'Admin Tester',
    generatedAt: new Date('2026-09-01T03:00:00.000Z')
  });

  assert.equal(workbook.subarray(0, 2).toString(), 'PK');
  const files = unzipSync(workbook);
  assert.ok(files['xl/worksheets/sheet1.xml']);
  assert.ok(files['xl/worksheets/sheet2.xml']);
  assert.ok(files['xl/styles.xml']);

  const attendance = strFromU8(files['xl/worksheets/sheet1.xml']);
  const summary = strFromU8(files['xl/worksheets/sheet2.xml']);
  const styles = strFromU8(files['xl/styles.xml']);

  assert.match(attendance, /Official Attendance Report/);
  assert.match(attendance, /รหัสพนักงาน/);
  assert.match(attendance, /สมชาย ทดสอบ/);
  assert.match(attendance, /Site A/);
  assert.match(attendance, /Site B/);
  assert.match(attendance, /ช่วยปฏิบัติงาน ณ Site B/);
  assert.match(attendance, /เวลาผิดปกติ \/ ไม่มีเวลาออก/);
  assert.match(attendance, /MISSING_CHECK_OUT, TIME_ABNORMAL/);
  assert.doesNotMatch(attendance, /RAW-LOCATION-MUST-NOT-EXPORT/);
  assert.doesNotMatch(attendance, /PHOTO-MUST-NOT-EXPORT/);
  assert.doesNotMatch(attendance, /latitude|longitude|referencePhotoId|verificationSnapshot/);

  assert.match(summary, new RegExp(reportId(current)));
  assert.match(summary, /Revision/);
  assert.match(summary, /Admin Tester/);
  assert.match(summary, new RegExp('a{64}'));
  assert.match(styles, /Noto Sans Thai/);
});

test('human-readable Attendance result preserves abnormal and assist-site wording', () => {
  assert.equal(attendanceResultText({ flags: ['MISSING_CHECK_OUT', 'TIME_ABNORMAL'] }), 'เวลาผิดปกติ / ไม่มีเวลาออก');
  assert.equal(attendanceResultText({ flags: ['ASSIST_OTHER_SITE'], actualSite: { name: 'คลังเหนือ' } }), 'ช่วยปฏิบัติงาน ณ คลังเหนือ');
  assert.equal(attendanceResultText({ flags: ['LATE', 'EARLY_OUT'] }), 'มาสาย / ออกก่อนเวลา');
});

test('official report load fails closed when month is not certified', async () => {
  const client = { $queryRaw: async () => [] };
  await assert.rejects(
    () => loadCertifiedAttendanceMonth('2026-08', client),
    (error) => error?.details?.code === 'ATTENDANCE_MONTH_NOT_CERTIFIED'
  );
});

test('official report load accepts only a structurally valid certified snapshot', async () => {
  const current = certification();
  const client = {
    $queryRaw: async () => [{
      id: current.id,
      month: current.month,
      revision: current.revision,
      status: current.status,
      summarySnapshot: current.snapshot,
      summaryDigest: current.summaryDigest,
      certifiedByUserId: current.certifiedByUserId,
      certifiedAt: current.certifiedAt
    }]
  };
  const loaded = await loadCertifiedAttendanceMonth('2026-08', client);
  assert.equal(loaded.revision, 3);
  assert.equal(loaded.snapshot.month, '2026-08');
  assert.equal(loaded.snapshot.rows.length, 2);
});
