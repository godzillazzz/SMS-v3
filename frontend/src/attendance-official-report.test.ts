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
      .toBe('เวลาผิดปกติ / ไม่มีเวลาออก');
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
});
