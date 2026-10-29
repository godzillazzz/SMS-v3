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
    expect(s).toEqual({ scheduledDays: 5, presentDays: 3, lateDays: 1, earlyDays: 1, leaveDays: 1, noRecordDays: 1, offsiteDays: 1, totalMinutes: 720 * 2 + 600 });
  });

  it('classifies day status: holiday for unscheduled days, red for no record', () => {
    const days = p.monthDayRows(rows, '2026-08');
    expect(p.timesheetDayStatus(days[0])).toMatchObject({ label: 'ไม่มีข้อมูล', tone: 'unknown' }); // Sat 1 Aug, no shift
    expect(p.timesheetDayStatus(days[2])).toMatchObject({ label: 'ปกติ', tone: 'normal' });
    expect(p.timesheetDayStatus(days[3])).toMatchObject({ label: 'มาสาย', tone: 'warn' });
    expect(p.timesheetDayStatus(days[5])).toMatchObject({ label: 'ลา', tone: 'leave' });
    expect(p.timesheetDayStatus(days[6])).toMatchObject({ label: 'ไม่มีบันทึก', tone: 'absent' });
    expect(p.isWeekend(days[0])).toBe(true);
    expect(p.isWeekend(days[2])).toBe(false);
  });

  it('renders header, employee block, summary, every day and signatures; unknown data shows –', () => {
    const html = renderToStaticMarkup(<AttendanceOfficialReportPrint report={report} printedAt="2026-09-01T00:00:00.000Z" />);
    for (const text of ['ใบลงเวลาทำงาน', 'Monthly Timesheet', 'R', 'สิงหาคม พ.ศ. 2569', 'สมชาย ใจดี', 'EMP-001', 'ตำแหน่ง', 'แผนก', 'เวลาทำงาน',
      'วันทำงาน', 'มาทำงาน', 'มาสาย', 'ออกก่อน', 'ลา', 'ไม่มีบันทึก', 'นอกสถานที่', 'ชั่วโมงรวม', '34:00', 'หัวหน้างาน', 'ฝ่ายบุคคล']) expect(html).toContain(text);
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['วันที่', 'วัน', 'เวลาเข้า', 'เวลาออก', 'ชั่วโมง', 'สถานะ', 'หมายเหตุ']);
    expect(html.match(/<tr class="timesheet-day/g)).toHaveLength(31);
    expect(html).toContain('timesheet-day--weekend');
    expect(html).toContain('timesheet-status--absent');
    expect(html).toMatch(/<span>ตำแหน่ง<\/span><strong>–<\/strong>/);
    expect(html).not.toContain('Snapshot</strong>');
  });
});
