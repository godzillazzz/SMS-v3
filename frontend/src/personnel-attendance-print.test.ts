import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const table = read('components/personnel/PersonnelTable.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');
const report = read('pages/reports/AttendanceOfficialReport.tsx');
const center = read('pages/reports/ReportCenterPage.tsx');
const main = read('main.tsx');

describe('attendance print shortcut contracts', () => {
  it('limits the shortcut to ADMIN/SUPERVISOR while the feature flag is enabled', () => {
    expect(directory).toContain("const canPrintAttendance = ATTENDANCE_OFFICIAL_REPORT_ENABLED && (role === 'ADMIN' || role === 'SUPERVISOR');");
    expect(center).toContain("['ADMIN', 'SUPERVISOR'].includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED");
    expect(center).not.toContain("role === 'MANAGER' && ATTENDANCE_OFFICIAL_REPORT_ENABLED");
  });

  it('renders an accessible keyboard button and forwards the clicked row employee', () => {
    expect(table).toContain('onPrintAttendance?(employee: PersonnelRecord): void');
    expect(table).toContain('onPrintAttendance?.(employee)');
    expect(table).toContain('type="button"');
    expect(table).toContain('aria-label={`พิมพ์ใบลงเวลาของ ${employee.firstName} ${employee.lastName}`}');
    expect(table).toContain('data-row-primary-action');
    expect(main).toContain("setAttendanceReportEmployeeId(employee.id); setActivePage('attendanceReport')");
  });

  it('preselects an existing report employee and safely ignores an absent employee', () => {
    expect(report).toContain('employeePages.some((rows) => rows[0]?.employeeId === initialEmployeeId)');
    expect(report).toContain('setSelectedEmployeeId(initialEmployeeId)');
    expect(report).toContain('const selectedPage = visibleEmployeePages.find((rows) => rows[0]?.employeeId === selectedEmployeeId) || visibleEmployeePages[0];');
    expect(report).toContain('initialEmployeeId?: string');
  });
});
