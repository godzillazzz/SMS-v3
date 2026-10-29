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
