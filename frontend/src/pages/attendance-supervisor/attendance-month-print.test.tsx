// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AttendanceMonthToDatePrint,
  attendanceMonthPrintRows,
  monthToDateRows,
  type AttendanceMonthPrintPayload,
  type AttendancePrintEmployee,
  type AttendancePrintRow
} from './AttendanceMonthToDatePrint';

const employee = (id: string, isActive = true): AttendancePrintEmployee => ({
  id,
  employeeCode: `EMP-${id}`,
  displayName: `Employee ${id}`,
  department: 'OPS',
  isActive
});

const attendance = (employeeId: string, date: string, assignmentId = `${employeeId}-${date}`): AttendancePrintRow => ({
  assignmentId,
  employeeId,
  employeeCode: `EMP-${employeeId}`,
  employeeName: `Employee ${employeeId}`,
  department: 'OPS',
  date,
  shift: { code: 'D' },
  attendanceStatus: 'COMPLETE',
  flags: [],
  checkInAt: `${date}T01:00:00.000Z`,
  checkOutAt: `${date}T10:00:00.000Z`,
  workedMinutes: 540
});

afterEach(() => cleanup());

describe('attendance month-to-date print data', () => {
  it('adapts the dedicated authorized roster response without inventing rows for blank days', () => {
    const row = attendance('1', '2026-10-01');
    const payload: AttendanceMonthPrintPayload = {
      generatedAt: '2026-10-03T12:00:00.000Z',
      monthStart: '2026-10-01',
      selectedDate: '2026-10-03',
      scope: { role: 'ADMIN', department: null },
      employees: [
        { id: '1', employeeCode: 'EMP-1', employeeName: 'Employee 1', department: 'OPS', days: [
          { date: '2026-10-01', assignment: { id: row.assignmentId }, attendance: row },
          { date: '2026-10-02', assignment: null, attendance: null }
        ] },
        { id: '2', employeeCode: 'EMP-2', employeeName: 'Employee 2', department: 'OPS', days: [
          { date: '2026-10-01', assignment: null, attendance: null }
        ] }
      ]
    };

    expect(attendanceMonthPrintRows(payload)).toEqual([row]);
    expect(payload.employees).toHaveLength(2);
  });

  it('builds exactly day 1 through D in the selected month', () => {
    const days = monthToDateRows([attendance('1', '2026-10-01'), attendance('1', '2026-10-28')], '2026-10-28');
    expect(days).toHaveLength(28);
    expect(days[0].date).toBe('2026-10-01');
    expect(days[27].date).toBe('2026-10-28');
    expect(days[1].rows).toEqual([]);
  });
});

describe('AttendanceMonthToDatePrint', () => {
  it('renders one employee per page, including active employees with no attendance rows', () => {
    render(<AttendanceMonthToDatePrint
      date="2026-10-03"
      employees={[employee('1'), employee('2')]}
      rows={[attendance('1', '2026-10-01')]}
    />);

    const pages = document.querySelectorAll('.attendance-supervisor-print-page.timesheet-sheet');
    expect(pages).toHaveLength(2);
    expect(pages[0].textContent).toContain('Employee 1');
    expect(pages[1].textContent).toContain('Employee 2');
    for (const page of Array.from(pages)) {
      expect(page.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(page.textContent).toContain('01/10/2569');
      expect(page.textContent).toContain('03/10/2569');
      expect(page.textContent).toContain('พนักงาน');
      expect(page.textContent).toContain('หัวหน้างาน');
      expect(page.textContent).toContain('ฝ่ายบุคคล');
    }
  });
});

describe('AttendanceMonthToDatePrint day status and site notes (owner 2026-10-30)', () => {
  const page = (rows: AttendancePrintRow[], date = '2026-10-03') => {
    render(<AttendanceMonthToDatePrint date={date} employees={[employee('1')]} rows={rows} />);
    return document.querySelector('.attendance-supervisor-print-page.timesheet-sheet') as HTMLElement;
  };
  const cells = (sheet: HTMLElement, day: number) => Array.from(sheet.querySelectorAll('tbody tr')[day - 1].querySelectorAll('td')).map((cell) => cell.textContent);
  const box = (sheet: HTMLElement, label: string) => Array.from(sheet.querySelectorAll('.timesheet-summary > div, .timesheet-summary-box, .timesheet-summary div')).find((node) => node.textContent?.startsWith(label) || node.querySelector('span')?.textContent === label)?.textContent || '';

  it('shows an OFF / not-actionable day as วันหยุด instead of ไม่มีบันทึก and excludes it from working days', () => {
    const off: AttendancePrintRow = { ...attendance('1', '2026-10-02'), shift: { code: 'OFF' }, attendanceStatus: 'NOT_ACTIONABLE', checkInAt: null, checkOutAt: null, workedMinutes: null };
    const sheet = page([attendance('1', '2026-10-01'), off, attendance('1', '2026-10-03')]);
    expect(cells(sheet, 2)[5]).toBe('วันหยุด');
    expect(sheet.textContent).not.toContain('ไม่มีบันทึก');
    expect(box(sheet, 'วันทำงาน')).toContain('2');
    expect(box(sheet, 'วันหยุด')).toContain('1');
  });

  it('marks work on an OFF day explicitly', () => {
    const offWorked: AttendancePrintRow = { ...attendance('1', '2026-10-01'), shift: { code: 'OFF' }, attendanceStatus: 'NOT_ACTIONABLE' };
    const sheet = page([offWorked], '2026-10-01');
    expect(cells(sheet, 1)[5]).toBe('มาทำงาน (วันหยุด)');
  });

  it('names the actual Security Site in notes when attendance happened at another Site', () => {
    const support: AttendancePrintRow = {
      ...attendance('1', '2026-10-01'),
      workSiteContext: 'SUPPORT_SITE',
      expectedSite: { code: 'WCS', name: 'สถานีเพิ่มความดันก๊าซธรรมชาติวังน้อย' },
      actualSite: { code: 'AN0', name: 'BV#AN0' },
      attendanceSites: [
        { eventType: 'CHECK_IN', actualSite: { code: 'AN0', name: 'BV#AN0' }, workSiteContext: 'SUPPORT_SITE' },
        { eventType: 'CHECK_OUT', actualSite: { code: 'AN0', name: 'BV#AN0' }, workSiteContext: 'SUPPORT_SITE' }
      ]
    };
    const sheet = page([support], '2026-10-01');
    expect(cells(sheet, 1)[6]).toBe('ลงเวลาที่: BV#AN0');
  });

  it('names both Sites when check-in and check-out happened at different Sites', () => {
    const split: AttendancePrintRow = {
      ...attendance('1', '2026-10-01'),
      workSiteContext: 'SUPPORT_SITE',
      expectedSite: { code: 'WCS', name: 'WCS Station' },
      attendanceSites: [
        { eventType: 'CHECK_IN', actualSite: { code: 'AN0', name: 'BV#AN0' }, workSiteContext: 'SUPPORT_SITE' },
        { eventType: 'CHECK_OUT', actualSite: { code: 'WCS', name: 'WCS Station' }, workSiteContext: 'ASSIGNED_SITE' }
      ]
    };
    const sheet = page([split], '2026-10-01');
    expect(cells(sheet, 1)[6]).toBe('เข้า: BV#AN0 · ออก: WCS Station');
  });

  it('distinguishes attendance outside every Site from helping another Site and keeps other notes', () => {
    const outside: AttendancePrintRow = { ...attendance('1', '2026-10-01'), flags: ['OUTSIDE_ALL_SITES', 'EARLY_OUT'] };
    const sheet = page([outside], '2026-10-01');
    expect(cells(sheet, 1)[6]).toBe('ออกก่อน · นอกพื้นที่ทุก Site');
  });
});
