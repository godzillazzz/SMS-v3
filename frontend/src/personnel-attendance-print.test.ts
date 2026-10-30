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
  it('limits the shortcut to ADMIN/MANAGER/SUPERVISOR while the feature flag is enabled', () => {
    // OWNER policy 2026-10-30 (SNT-DR-L1): MANAGER gets the print shortcut too; backend enforces scope.
    expect(directory).toContain("const canPrintAttendance = ATTENDANCE_OFFICIAL_REPORT_ENABLED && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role);");
    expect(directory).not.toContain("(role === 'ADMIN' || role === 'SUPERVISOR')");
    // OWNER policy 2026-10-30: the Report Center official panel is now ADMIN/MANAGER/SUPERVISOR (cross-department).
    expect(center).toContain("ATTENDANCE_OFFICIAL_REPORT_ROLES.includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED");
    expect(center).toContain("export const ATTENDANCE_OFFICIAL_REPORT_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR'];");
  });

  it('offers the all-department print selector to ADMIN/MANAGER/SUPERVISOR while Excel stays ADMIN-only', () => {
    expect(report).toContain("{['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)\n        ? <label><span>จุดปฏิบัติงาน</span>");
    expect(report).toContain("{role === 'ADMIN' && <button type=\"button\" className=\"btn-neutral\" disabled={!report || loading || downloading} onClick={() => void exportExcel()}>");
  });

  it('renders an accessible keyboard button and forwards the clicked row employee', () => {
    expect(table).toContain('onPrintAttendance?(employee: PersonnelRecord): void');
    expect(table).toContain('onPrintAttendance?.(employee)');
    expect(table).toContain('type="button"');
    expect(table).toContain('aria-label={`พิมพ์ใบลงเวลาของ ${employee.firstName} ${employee.lastName}`}');
    expect(table).toContain('data-row-primary-action');
    expect(table).toContain('onKeyDown={(event) => { if (event.key === \'Enter\' || event.key === \' \')');
    expect(table).toContain('data-personnel-id={employee.id}');
    expect(table).toMatch(/rows\.map\(\(employee\).*onPrintAttendance\?\.\(employee\)/s);
    expect(main).toContain("setAttendanceReportEmployeeId(employee.id); setActivePage('attendanceReport')");
  });

  it('forwards each distinct row employee id rather than a shared selection', () => {
    expect(table).toMatch(/rows\.map\(\(employee\).*data-personnel-id=\{employee\.id\}.*onPrintAttendance\?\.\(employee\)/s);
    expect(main).toContain("setAttendanceReportEmployeeId(employee.id)");
    expect(main).toContain("setActivePage('attendanceReport')");
  });

  it('preselects an existing report employee and safely ignores an absent employee', () => {
    expect(report).toContain('employeePages.some((rows) => rows[0]?.employeeId === initialEmployeeId)');
    expect(report).toContain('setSelectedEmployeeId(initialEmployeeId)');
    expect(report).toContain('const selectedPage = visibleEmployeePages.find((rows) => rows[0]?.employeeId === selectedEmployeeId) || visibleEmployeePages[0];');
    expect(report).toContain('initialEmployeeId?: string');
    expect(report).toContain('if (!report || !pagesToPrint.length) return;');
  });

  it('keeps the print control natively keyboard accessible', () => {
    expect(table).toContain('type="button"');
    expect(table).toContain('aria-label={`พิมพ์ใบลงเวลาของ ${employee.firstName} ${employee.lastName}`}');
    expect(table).toContain('onClick={() => onPrintAttendance?.(employee)}');
  });
});
