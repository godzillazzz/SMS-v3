'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const {
  attendanceResultText,
  abnormalReasonText,
  buildAttendanceWorkbook,
  loadCertifiedAttendanceMonth,
  reportId,
  reportRowProjection
} = require('../src/services/attendance-report.service');
const { snapshotDigest } = require('../src/services/attendance-month-governance.service');

test('report abnormal reason labels are understandable Thai and hide internal codes', () => {
  assert.equal(abnormalReasonText(['MISSING_CHECK_OUT', 'MAX_SHIFT_DURATION_EXCEEDED']), 'ไม่ได้ลงเวลาออก, เกินเวลากะสูงสุด');
  assert.equal(attendanceResultText({ abnormalTime: true, abnormalReasons: ['MAX_SHIFT_DURATION_EXCEEDED'] }), 'เกินเวลากะสูงสุด');
  assert.equal(attendanceResultText({ checkoutCondition: 'MISSING_CHECK_OUT', abnormalTime: true, abnormalReasons: ['MISSING_CHECK_OUT'] }), 'ไม่ได้ลงเวลาออก');
  assert.equal(attendanceResultText({ checkoutCondition: 'MISSING_CHECK_OUT', abnormalTime: true, abnormalReasons: ['MISSING_CHECK_OUT', 'MAX_SHIFT_DURATION_EXCEEDED'] }), 'ไม่ได้ลงเวลาออก / เกินเวลากะสูงสุด');
});

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
  assert.match(attendance, /ช่วยปฏิบัติงาน/);
  assert.match(attendance, /<c r="Q6"[^>]*>[\s\S]*?ช่วยปฏิบัติงาน/);
  assert.match(attendance, /<c r="Q7"[^>]*>[\s\S]*?ปกติ/);
  assert.match(attendance, /ไม่ได้ลงเวลาออก/);
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
  assert.equal(attendanceResultText({ flags: ['MISSING_CHECK_OUT', 'TIME_ABNORMAL'] }), 'ไม่ได้ลงเวลาออก / เวลาผิดปกติ');
  assert.equal(attendanceResultText({ flags: ['ASSIST_OTHER_SITE'], actualSite: { name: 'คลังเหนือ' } }), 'ช่วยปฏิบัติงาน ณ คลังเหนือ');
  assert.equal(attendanceResultText({ flags: ['LATE', 'EARLY_OUT'] }), 'มาสาย / ออกก่อนเวลา');
});

test('official Attendance JSON projection excludes correction actors, reasons and raw evidence while preserving governed result fields', () => {
  const projected = reportRowProjection({
    ...certification().snapshot.rows[0],
    corrections: [{ id: 'correction-secret', reason: 'private reviewer reason', actorUserId: 'private-actor-id' }],
    originalCheckInAt: '2026-08-25T00:01:00.000Z',
    originalCheckOutAt: '2026-08-25T11:59:00.000Z'
  });

  assert.equal(projected.employeeCode, 'EMP-001');
  assert.deepEqual(projected.flags, ['LATE', 'ASSIST_OTHER_SITE']);
  assert.equal(projected.checkInAt, '2026-08-25T00:05:00.000Z');
  assert.equal(projected.actualSite.name, 'Site B');
  assert.equal(projected.assignedSite.name, 'Site A');
  assert.equal(projected.workSiteContext, 'SUPPORT_SITE');
  assert.equal('corrections' in projected, false);
  assert.equal('originalCheckInAt' in projected, false);
  assert.equal('originalCheckOutAt' in projected, false);
  assert.equal('locationEvidence' in projected, false);
  assert.equal('verificationSnapshot' in projected, false);
});

test('historical report rows without actual-site context safely fall back to the assigned Site', () => {
  const projected = reportRowProjection({
    assignmentId: 'legacy-assignment', status: 'IN_PROGRESS',
    expectedSite: { id: 'site-a', code: 'A', name: 'Site A' }, flags: []
  });
  assert.equal(projected.assignedSite.id, 'site-a');
  assert.equal(projected.actualSite.id, 'site-a');
  assert.equal(projected.workSiteContext, 'ASSIGNED_SITE');
});

test('official report preserves per-event Sites when a shift includes assigned and support locations', () => {
  const projected = reportRowProjection({
    assignmentId: 'multi-site-assignment',
    assignedSite: { id: 'site-a', code: 'A', name: 'Site A' },
    actualSite: { id: 'site-b', code: 'B', name: 'Site B' },
    workSiteContext: 'SUPPORT_SITE',
    flags: ['ASSIST_OTHER_SITE'],
    attendanceSites: [
      { eventType: 'CHECK_IN', actualSiteId: 'site-a', actualSite: { id: 'site-a', code: 'A', name: 'Site A' }, workSiteContext: 'ASSIGNED_SITE' },
      { eventType: 'CHECK_OUT', actualSiteId: 'site-b', actualSite: { id: 'site-b', code: 'B', name: 'Site B' }, workSiteContext: 'SUPPORT_SITE' }
    ]
  });
  assert.equal(projected.workSiteContext, 'SUPPORT_SITE');
  assert.deepEqual(projected.attendanceSites.map((site) => [site.eventType, site.actualSite?.name, site.workSiteContext]), [
    ['CHECK_IN', 'Site A', 'ASSIGNED_SITE'],
    ['CHECK_OUT', 'Site B', 'SUPPORT_SITE']
  ]);
});

test('official workbook keeps historical rows at their assigned Site when actual-site evidence is absent', () => {
  const current = certification();
  current.snapshot.rows = [
    {
      assignmentId: 'legacy-assignment', employeeCode: 'EMP-OLD', employeeName: 'Historical Employee',
      expectedSite: { id: 'site-a', code: 'A', name: 'Site A' }, flags: [], status: 'COMPLETE'
    }
  ];
  const files = unzipSync(buildAttendanceWorkbook({ certification: current }));
  const attendance = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(attendance, /<c r="E6"[^>]*>[\s\S]*?Site A/);
  assert.match(attendance, /<c r="F6"[^>]*>[\s\S]*?Site A/);
  assert.match(attendance, /<c r="Q6"[^>]*>[\s\S]*?ปกติ/);
  assert.doesNotMatch(attendance, /ช่วยปฏิบัติงาน ณ/);
});

test('official workbook lists the actual Site for each Attendance event when the employee moves Sites during a shift', () => {
  const current = certification();
  current.snapshot.rows = [{
    assignmentId: 'multi-site-assignment', employeeCode: 'EMP-MULTI', employeeName: 'Multi Site Employee',
    department: 'SECURITY', workDate: '2026-08-25', shift: { code: 'DAY' },
    assignedSite: { id: 'site-a', code: 'A', name: 'Site A' }, expectedSite: { id: 'site-a', code: 'A', name: 'Site A' },
    actualSite: { id: 'site-b', code: 'B', name: 'Site B' }, workSiteContext: 'SUPPORT_SITE',
    attendanceSites: [
      { eventType: 'CHECK_IN', actualSiteId: 'site-a', actualSite: { id: 'site-a', code: 'A', name: 'Site A' }, workSiteContext: 'ASSIGNED_SITE' },
      { eventType: 'CHECK_OUT', actualSiteId: 'site-b', actualSite: { id: 'site-b', code: 'B', name: 'Site B' }, workSiteContext: 'SUPPORT_SITE' }
    ], flags: ['ASSIST_OTHER_SITE'], status: 'COMPLETE'
  }];
  const files = unzipSync(buildAttendanceWorkbook({ certification: current }));
  const attendance = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(attendance, /เข้า: Site A \/ ออก: Site B/);
  assert.match(attendance, /ช่วยปฏิบัติงาน/);
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
      summaryDigest: snapshotDigest(current.snapshot),
      certifiedByUserId: current.certifiedByUserId,
      certifiedAt: current.certifiedAt
    }]
  };
  const loaded = await loadCertifiedAttendanceMonth('2026-08', client);
  assert.equal(loaded.revision, 3);
  assert.equal(loaded.snapshot.month, '2026-08');
  assert.equal(loaded.snapshot.rows.length, 2);
});

test('official report load fails closed when certified snapshot digest or metadata is inconsistent', async () => {
  const current = certification();
  const badDigestClient = {
    $queryRaw: async () => [{
      id: current.id,
      month: current.month,
      revision: current.revision,
      status: current.status,
      summarySnapshot: current.snapshot,
      summaryDigest: '0'.repeat(64),
      certifiedByUserId: current.certifiedByUserId,
      certifiedAt: current.certifiedAt
    }]
  };
  await assert.rejects(
    () => loadCertifiedAttendanceMonth('2026-08', badDigestClient),
    (error) => error?.details?.code === 'ATTENDANCE_CERTIFICATION_DIGEST_MISMATCH'
  );

  const wrongMonthSnapshot = { ...current.snapshot, month: '2026-07' };
  const wrongMonthClient = {
    $queryRaw: async () => [{
      id: current.id,
      month: current.month,
      revision: current.revision,
      status: current.status,
      summarySnapshot: wrongMonthSnapshot,
      summaryDigest: snapshotDigest(wrongMonthSnapshot),
      certifiedByUserId: current.certifiedByUserId,
      certifiedAt: current.certifiedAt
    }]
  };
  await assert.rejects(
    () => loadCertifiedAttendanceMonth('2026-08', wrongMonthClient),
    (error) => error?.details?.code === 'ATTENDANCE_CERTIFICATION_SNAPSHOT_INVALID'
  );
});
