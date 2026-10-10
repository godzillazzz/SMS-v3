import { createRoot } from 'react-dom/client';
import { AttendanceOfficialReportPrint } from '../../src/pages/reports/AttendanceOfficialReport';
import type { AttendanceOfficialReport, AttendanceReportRow } from '../../src/pages/reports/attendance-report-client';
import { printDocument } from '../../src/schedule-print';

const employeeA = Array.from({ length: 31 }, (_, index): AttendanceReportRow => {
  const day = String(index + 1).padStart(2, '0');
  return {
    assignmentId: `fixture-assignment-${day}`,
    employeeId: 'fixture-employee-a',
    employeeCode: 'FIXTURE-001',
    employeeName: 'พนักงานตัวอย่าง หนึ่ง',
    department: 'หน่วยงานทดสอบ',
    workDate: `2026-08-${day}`,
    shift: { code: 'DAY', name: 'กะกลางวัน' },
    expectedSite: { id: 'fixture-site', code: 'SITE-A', name: 'ไซต์ทดสอบ' },
    assignedSite: { id: 'fixture-site', code: 'SITE-A', name: 'ไซต์ทดสอบ' },
    expectedStartAt: `2026-08-${day}T01:00:00.000Z`,
    expectedEndAt: `2026-08-${day}T13:00:00.000Z`,
    checkInAt: `2026-08-${day}T01:00:00.000Z`,
    checkOutAt: `2026-08-${day}T13:00:00.000Z`,
    effectiveCheckInAt: `2026-08-${day}T01:00:00.000Z`,
    effectiveCheckOutAt: `2026-08-${day}T13:00:00.000Z`,
    workedMinutes: 720,
    status: 'COMPLETE',
    flags: ['ON_TIME']
  };
});

const employeeB: AttendanceReportRow[] = [{
  ...employeeA[0],
  assignmentId: 'fixture-assignment-b',
  employeeId: 'fixture-employee-b',
  employeeCode: 'FIXTURE-002',
  employeeName: 'พนักงานตัวอย่าง สอง'
}];

const report: AttendanceOfficialReport = {
  reportId: 'ATT-2026-08-R1-FIXTURE01',
  period: '2026-08',
  revision: 1,
  certificationStatus: 'CERTIFIED',
  summaryDigest: 'a'.repeat(64),
  certifiedAt: '2026-09-01T02:00:00.000Z',
  certifiedByUserId: 'fixture-admin',
  generatedAt: '2026-09-01T03:00:00.000Z',
  generatedBy: 'Fixture Admin',
  summary: { assignments: 32, complete: 32 },
  rows: [...employeeA, ...employeeB]
};

createRoot(document.querySelector('#t31-one-root')!).render(
  <div id="t31-one"><AttendanceOfficialReportPrint report={report} employeePages={[employeeA]} printedAt="2026-09-01T03:00:00.000Z" /></div>
);
createRoot(document.querySelector('#t31-all-root')!).render(
  <div id="t31-all"><AttendanceOfficialReportPrint report={report} employeePages={[employeeA, employeeB]} printedAt="2026-09-01T03:00:00.000Z" /></div>
);

document.querySelector('#trigger-t31-one')!.addEventListener('click', () => {
  void printDocument('#t31-one', 'SMS T31 monthly timesheet.pdf', { orientation: 'portrait', margin: '0' });
});
document.querySelector('#trigger-t31-all')!.addEventListener('click', () => {
  void printDocument('#t31-all', 'SMS T31 department timesheets.pdf', { orientation: 'portrait', margin: '0' });
});
