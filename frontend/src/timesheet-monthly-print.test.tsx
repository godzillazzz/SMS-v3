import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttendanceOfficialReportPrint, attendanceReportPresentation as p } from './pages/reports/AttendanceOfficialReport';
import type { AttendanceOfficialReport, AttendanceReportRow } from './pages/reports/attendance-report-client';

const row = (o: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  assignmentId: crypto.randomUUID(), employeeId: 'e1', employeeCode: 'EMP-001', employeeName: 'สมชาย ใจดี', department: 'รปภ.',
  workDate: '2026-08-03', shift: { code: 'DAY', name: 'กะเช้า' },
  scheduledStartAt: '2026-08-03T01:00:00.000Z', scheduledEndAt: '2026-08-03T13:00:00.000Z',
  checkInAt: '2026-08-03T01:00:00.000Z', checkOutAt: '2026-08-03T13:00:00.000Z', workedMinutes: 720,
  status: 'COMPLETE', flags: ['ON_TIME'], ...o
});

const rows = [
  row(),
  row({ workDate: '2026-08-04', flags: ['LATE'], workedMinutes: 600 }),
  row({ workDate: '2026-08-05', flags: ['EARLY_OUT'], checkoutCondition: 'EARLY_LEAVE', workSiteContext: 'SUPPORT_SITE', actualSite: { id: 's2', code: 'B', name: 'Site B' } }),
  row({ workDate: '2026-08-06', flags: ['LEAVE'], checkInAt: null, checkOutAt: null, workedMinutes: null }),
  row({ workDate: '2026-08-07', flags: ['ABSENT'], checkInAt: null, checkOutAt: null, workedMinutes: null })
];
const report: AttendanceOfficialReport = { reportId: 'R', period: '2026-08', revision: 1, certificationStatus: 'CERTIFIED', summaryDigest: 'x', certifiedAt: '2026-09-01T00:00:00.000Z', certifiedByUserId: 'u', generatedAt: '2026-09-01T00:00:00.000Z', generatedBy: 'g', summary: {}, rows };

describe('Monthly timesheet (owner reference layout)', () => {
  it('prints only day 1 through selected date without crossing its calendar month', () => {
    const selected = '2026-08-05';
    const days = p.monthDayRows([
      ...rows,
      row({ assignmentId: 'after-cutoff', workDate: '2026-08-06', flags: ['LATE'], workedMinutes: 600 }),
      row({ assignmentId: 'other-month', workDate: '2026-09-01', flags: ['LATE'], workedMinutes: 600 })
    ], '2026-08', selected);
    expect(days.map(({ day }) => day)).toEqual([1, 2, 3, 4, 5]);
    expect(days.flatMap(({ rows: dailyRows }) => dailyRows).some(({ assignmentId }) => assignmentId === 'after-cutoff')).toBe(false);
    expect(days.flatMap(({ rows: dailyRows }) => dailyRows).some(({ assignmentId }) => assignmentId === 'other-month')).toBe(false);
  });

  it('derives summary metrics through the selected date only', () => {
    const s = p.timesheetSummary(rows, '2026-08', '2026-08-04');
    expect(s).toEqual({ scheduledDays: 2, presentDays: 2, lateDays: 1, earlyDays: 0, leaveDays: 0, noRecordDays: 0, offsiteDays: 0, totalMinutes: 1320 });
  });

  it('prints exactly one selected employee monthly document with the cutoff stated in Thai', () => {
    const otherEmployee = row({ assignmentId: 'other-employee', employeeId: 'e2', employeeCode: 'EMP-002', employeeName: 'สุดา ใจดี' });
    const html = renderToStaticMarkup(<AttendanceOfficialReportPrint report={{ ...report, rows: [...rows, otherEmployee] }} employeePages={[rows]} throughDate="2026-08-05" />);
    expect(html.match(/<article class="attendance-report-page attendance-timesheet-page timesheet-sheet"/g)).toHaveLength(1);
    expect(html).toContain('ข้อมูลตั้งแต่วันที่ 1–5 สิงหาคม พ.ศ. 2569');
    expect(html).not.toContain('สุดา ใจดี');
    expect(html.match(/<tr class="timesheet-day/g)).toHaveLength(5);
  });

  it('never emits multiple employee documents from one print component', () => {
    const otherEmployee = row({ assignmentId: 'other-employee', employeeId: 'e2', employeeCode: 'EMP-002', employeeName: 'สุดา ใจดี' });
    const html = renderToStaticMarkup(<AttendanceOfficialReportPrint report={{ ...report, rows: [...rows, otherEmployee] }} />);
    expect(html.match(/<article class="attendance-report-page attendance-timesheet-page timesheet-sheet"/g)).toHaveLength(1);
  });

  it('does not invent holiday, document number, presence or normality from missing data', () => {
    const missing = row({ workDate: '2026-08-08', status: 'PENDING', flags: [], checkInAt: null, checkOutAt: null, workedMinutes: null });
    const days = p.monthDayRows([missing], '2026-08');
    expect(p.timesheetDayStatus(days[0]).label).toBe('ไม่มีข้อมูล');
    expect(p.timesheetDayStatus(days[7]).label).toBe('ตรวจสอบ');
    expect(p.timesheetSummary([missing], '2026-08').presentDays).toBe(0);
    const html = renderToStaticMarkup(<AttendanceOfficialReportPrint report={{ ...report, rows: [missing] }} />);
    expect(html).not.toContain('TS-256908-001');
    expect(html).toContain('R');
  });

  it('honours structured punctuality and flags requiring review', () => {
    const late = row({ punctuality: 'LATE', flags: [] });
    const wrong = row({ flags: ['WRONG_SHIFT'] });
    expect(p.timesheetDayStatus(p.monthDayRows([late], '2026-08')[2]).label).toBe('มาสาย');
    expect(p.timesheetDayStatus(p.monthDayRows([wrong], '2026-08')[2]).label).toBe('ตรวจสอบ');
  });

  it('derives the 8 summary boxes only from certified rows', () => {
    const s = p.timesheetSummary(rows, '2026-08');
    expect(s).toEqual({ scheduledDays: 3, presentDays: 3, lateDays: 1, earlyDays: 1, leaveDays: 1, noRecordDays: 1, offsiteDays: 1, totalMinutes: 720 * 2 + 600 });
  });

  it('classifies day status: holiday for unscheduled days, red for no record', () => {
    const days = p.monthDayRows(rows, '2026-08');
    expect(p.timesheetDayStatus(days[0])).toMatchObject({ label: 'ไม่มีข้อมูล', tone: 'unknown' }); // Sat 1 Aug, no shift
    expect(p.timesheetDayStatus(days[2])).toMatchObject({ label: 'ปกติ', tone: 'normal' });
    expect(p.timesheetDayStatus(days[3])).toMatchObject({ label: 'มาสาย', tone: 'warn' });
    expect(p.timesheetDayStatus(days[5])).toMatchObject({ label: 'ลา', tone: 'leave' });
    expect(p.timesheetDayStatus(days[6])).toMatchObject({ label: 'ขาดงาน', tone: 'absent' });
    expect(p.isWeekend(days[0])).toBe(true);
    expect(p.isWeekend(days[2])).toBe(false);
  });

  it('renders header, employee block, summary, every day and signatures; unknown data shows –', () => {
    const html = renderToStaticMarkup(<AttendanceOfficialReportPrint report={report} printedAt="2026-09-01T00:00:00.000Z" />);
    for (const text of ['ใบลงเวลาทำงาน', 'Monthly Timesheet', 'R', 'สิงหาคม พ.ศ. 2569', 'สมชาย ใจดี', 'EMP-001', 'ตำแหน่ง', 'แผนก', 'เวลาทำงาน',
      'วันทำงาน', 'มาทำงาน', 'มาสาย', 'ออกก่อนเวลา', 'ลางาน', 'ไม่มีบันทึก', 'นอกสถานที่', 'ชั่วโมงรวม', '34:00', 'ลงชื่อ', '( สมชาย ใจดี )', 'หัวหน้างาน', 'ฝ่ายบุคคล']) expect(html).toContain(text);
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['วันที่', 'วัน', 'เข้างาน', 'ออกงาน', 'ชั่วโมง', 'สถานะ', 'สถานที่', 'หมายเหตุ']);
    expect(html.match(/<tr class="timesheet-day/g)).toHaveLength(31);
    expect(html).toContain('timesheet-day--weekend');
    expect(html).toContain('timesheet-status--absent');
    expect(html).toMatch(/<span>ตำแหน่ง<\/span><strong>–<\/strong>/);
    expect(html).not.toContain('Snapshot</strong>');
  });
});
