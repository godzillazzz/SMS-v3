import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { attendanceReportPresentation } from './pages/reports/AttendanceOfficialReport';
import type { AttendanceReportRow } from './pages/reports/attendance-report-client';

const row = (overrides: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  assignmentId: overrides.assignmentId || crypto.randomUUID(),
  employeeId: overrides.employeeId || 'employee-a',
  employeeCode: overrides.employeeCode ?? 'EMP-001',
  employeeName: overrides.employeeName || 'Employee A',
  department: overrides.department ?? 'SECURITY',
  workDate: overrides.workDate || '2026-08-25',
  shift: overrides.shift ?? { code: 'DAY', name: 'Day' },
  expectedSite: overrides.expectedSite ?? { id: 'site-a', code: 'A', name: 'Site A' },
  actualSite: overrides.actualSite ?? { id: 'site-a', code: 'A', name: 'Site A' },
  status: overrides.status || 'COMPLETE',
  flags: overrides.flags || ['ON_TIME'],
  checkInAt: overrides.checkInAt ?? '2026-08-25T00:00:00.000Z',
  checkOutAt: overrides.checkOutAt ?? '2026-08-25T12:00:00.000Z',
  workedMinutes: overrides.workedMinutes ?? 720,
  lateMinutes: overrides.lateMinutes ?? 0,
  earlyOutMinutes: overrides.earlyOutMinutes ?? 0
});

describe('Official Attendance report presentation', () => {
  it('uses the shared Attendance auth-continuity helper for certified JSON/XLSX requests', () => {
    const client = readFileSync(new URL('./pages/reports/attendance-report-client.ts', import.meta.url), 'utf8');
    expect(client).toContain("import { attendanceAuthenticatedRequest } from '../../attendance-auth-request'");
    expect(client).toContain('attendanceAuthenticatedRequest(path, token)');
    expect(client).not.toContain('api.refresh()');
    expect(client).not.toContain('await fetch(');
  });

  it('groups one monthly print page per employee and sorts daily rows', () => {
    const grouped = attendanceReportPresentation.groupByEmployee([
      row({ assignmentId: 'a2', workDate: '2026-08-26' }),
      row({ assignmentId: 'b1', employeeId: 'employee-b', employeeCode: 'EMP-002', employeeName: 'Employee B' }),
      row({ assignmentId: 'a1', workDate: '2026-08-25' })
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].map((item) => item.assignmentId)).toEqual(['a1', 'a2']);
    expect(grouped[1][0].employeeCode).toBe('EMP-002');
  });

  it('uses Owner-locked missing checkout and assist-site wording', () => {
    expect(attendanceReportPresentation.resultText(row({ flags: ['MISSING_CHECK_OUT', 'TIME_ABNORMAL'], checkOutAt: null, workedMinutes: null })))
      .toBe('ไม่ได้ลงเวลาออก / เวลาผิดปกติ');
    expect(attendanceReportPresentation.resultText(row({ flags: ['ASSIST_OTHER_SITE'], actualSite: { id: 'site-b', code: 'B', name: 'Site B' } })))
      .toBe('ช่วยปฏิบัติงาน ณ Site B');
  });

  it('summarizes abnormalities without inventing worked duration', () => {
    const summary = attendanceReportPresentation.employeeSummary([
      row({ flags: ['LATE'], lateMinutes: 5 }),
      row({ assignmentId: 'a2', flags: ['MISSING_CHECK_OUT', 'TIME_ABNORMAL'], checkOutAt: null, workedMinutes: null })
    ]);
    expect(summary.late).toBe(1);
    expect(summary.abnormal).toBe(1);
    expect(attendanceReportPresentation.durationText(null)).toBe('-');
  });

  it('builds every calendar date from the certified period without inferring off days or holidays', () => {
    const days = attendanceReportPresentation.monthDayRows([
      row({ workDate: '2026-08-01', workedMinutes: 480, flags: ['LATE'] }),
      row({ assignmentId: 'shift-2', workDate: '2026-08-01', workedMinutes: 300, flags: ['ON_TIME'] })
    ], '2026-08');
    expect(days).toHaveLength(31);
    expect(days[0].dateLabel).toContain('01/08/2569');
    expect(days[0].dateText).toBe('01/08/2569');
    expect(days[0].weekday).toBe('เสาร์');
    expect(days[0].rows).toHaveLength(2);
    expect(attendanceReportPresentation.dayTimes(days[0].rows, 'checkIn')).toHaveLength(2);
    expect(attendanceReportPresentation.dayTimes([], 'checkOut')).toEqual(['—']);
    expect(days[0].workedMinutes).toBe(780);
    expect(days[0].notes).toContain('มาสาย');
    expect(days[1].rows).toEqual([]);
    expect(days[1].notes).toContain('ไม่มีรายการที่รับรองใน Snapshot');
    const summary = attendanceReportPresentation.monthSummary(days[0].rows, '2026-08');
    expect(summary.workDays).toBe(1);
    expect(summary.lateDays).toBe(1);
    expect(summary.totalDays).toBe(31);
    expect(summary.unclassifiedDays).toBe(30);
  });

  it('renders the approved portrait timesheet fields, logo and signatures without excluded compensation data', () => {
    const source = readFileSync(new URL('./pages/reports/AttendanceOfficialReport.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles/attendance-report.css', import.meta.url), 'utf8');
    expect(source).toContain('/brand/sms-logo-horizontal.webp');
    for (const label of ['ลำดับ', 'วันที่', 'วัน', 'เวลาเข้า', 'เวลาออก', 'ชั่วโมงทำงาน', 'หมายเหตุ']) expect(source).toContain(`<th>${label}</th>`);
    expect(source).toContain('attendance-report-employee-column');
    expect(source).toContain('ประจำเดือน {formatThaiMonth(report.period)}');
    expect(source).toContain('ไม่มีข้อมูลใน Snapshot');
    expect(source).toContain("['พนักงาน', 'หัวหน้าหน่วยงาน', 'ฝ่ายบุคคล']");
    expect(source).toContain('ฝ่ายบุคคล');
    expect(source).not.toMatch(/\bOT\b|ค่าล่วงเวลา|เบี้ยเลี้ยง|ค่าพาหนะ|ค่าเดินทาง|ค่าตำแหน่ง|employee\.phone/);
    expect(source).toContain("{ orientation: 'portrait', margin: '0' }");
    expect(styles).not.toMatch(/@page/i);
    expect(styles).toContain('font-size: 7.5pt;');
  });

  it('keeps lateness, Support Site and foreign-device review visible together', () => {
    const presentation = row({
      workSiteContext: 'SUPPORT_SITE',
      assignedSite: { id: 'site-a', code: 'A', name: 'Site A' },
      actualSite: { id: 'site-b', code: 'B', name: 'Site B' },
      punctuality: 'LATE', flags: ['LATE', 'ASSIST_OTHER_SITE', 'DEVICE_MISMATCH']
    });
    const text = attendanceReportPresentation.resultText(presentation);
    expect(text).toContain('ช่วยปฏิบัติงาน ณ Site B');
    expect(text).toContain('มาสาย');
    expect(text).toContain('ใช้อุปกรณ์อื่น · ตรวจสอบ');
  });
});
