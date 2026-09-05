import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('WAVE 4 operational data surfaces contract', () => {
  it('migrates Data Quality to the shared responsive data-table contract without write semantics', () => {
    const page = read('./pages/data-quality/DataQualityCenterPage.tsx');
    expect(page).toContain('ResponsiveDataTable');
    expect(page).toContain('DataTablePagination');
    expect(page).toContain('DataTableSkeletonRows');
    expect(page).toContain('DataTableSkeletonCards');
    expect(page).toContain('DataTableState');
    expect(page).toContain('ariaLabel="รายการคุณภาพข้อมูล"');
    expect(page).toContain('data-quality-desktop-table');
    expect(page).toContain('data-quality-mobile-cards');
    expect(page).not.toMatch(/method:\s*['\"](?:POST|PUT|PATCH|DELETE)/);
  });

  it('uses the shared responsive shell and pagination for Leave History while preserving domain actions', () => {
    const main = read('./main.tsx');
    expect(main).toContain("import { DataTablePagination, ResponsiveDataTable } from './components/ResponsiveDataTable';");
    expect(main).toContain('className="leave-history-responsive-table"');
    expect(main).toContain("ariaLabel={mode === 'history' ? 'ประวัติการลาพนักงานทั้งหมด' : 'ประวัติคำขอลาของฉัน'}");
    expect(main).toContain('ariaLabel="การแบ่งหน้าประวัติการลา"');
    expect(main).toContain('onClick={() => onAttachment(row)}');
    expect(main).toContain('onClick={() => onPrint(row)}');
    expect(main).toContain('onClick={() => onEditReturned(row)}');
    expect(main).toContain('onClick={() => onCancel(row)}');
    expect(main).toContain('leaveTable(pendingRows, true)');
  });

  it('migrates Shift Setup presentation to desktop table plus mobile cards and reuses governance handlers', () => {
    const main = read('./main.tsx');
    const styles = read('./styles/data-surfaces.css');
    expect(main).toContain('className="shift-setup-responsive-table"');
    expect(main).toContain('className="table-card shift-setup-desktop-table"');
    expect(main).toContain('className="shift-setup-mobile-list"');
    expect(main).toContain('className="shift-setup-mobile-card data-mobile-card"');
    expect(main).toContain('openShiftTypeEditor(shiftType)');
    expect(main).toContain('toggleShiftTypeActive(shiftType)');
    expect(main).toContain('confirmShiftDeactivation()');
    expect(styles).toContain('/* WAVE 4 — Shift Setup responsive data surface. */');
    expect(styles).toContain('.shift-setup-mobile-list');
    expect(styles).toContain('.shift-setup-desktop-table');
    expect(styles).toContain('@media (max-width: 760px)');
    expect(styles).toContain('min-height: 44px;');
  });

  it('keeps the monthly Schedule matrix on its intentional custom scroll surface', () => {
    const main = read('./main.tsx');
    const mobile = read('./styles/production-mobile-responsive-v1.css');
    expect(main).toContain('<table className="schedule-grid">');
    expect(main).toContain('className="table-card calendar-card"');
    expect(mobile).toContain('.schedule-calendar-page .calendar-card > .table-scroll');
    expect(mobile).toContain('overflow-x: auto;');
    expect(mobile).toContain('touch-action: pan-x pan-y;');
  });

  it('keeps report surfaces card-oriented rather than forcing them into a generic table', () => {
    const report = read('./pages/reports/ReportCenterPage.tsx');
    const executive = read('./pages/executive-report/ExecutiveReportCenterPage.tsx');
    expect(report).toContain('report-center-export-grid');
    expect(report).toContain('report-center-export-card');
    expect(executive).toContain('executive-report-grid');
    expect(report).not.toContain('ResponsiveDataTable');
    expect(executive).not.toContain('ResponsiveDataTable');
  });

  it('migrates Attendance Supervisor through a separate sensitive responsive sub-gate', () => {
    const supervisor = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
    const styles = read('./pages/attendance-supervisor/attendance-supervisor-v4.css');
    expect(supervisor).toContain('ResponsiveDataTable');
    expect(supervisor).toContain('DataTablePagination');
    expect(supervisor).toContain('DataTableSkeletonRows');
    expect(supervisor).toContain('DataTableSkeletonCards');
    expect(supervisor).toContain('attendance-supervisor-v4__mobile-card');
    expect(supervisor).toContain('originalCheckInAt');
    expect(supervisor).toContain('await approveAttendanceAdjustment');
    expect(styles).toContain('min-width: 1080px;');
    expect(styles).toContain('overflow-x: auto;');
    expect(styles).toContain('@media (max-width: 1024px)');
  });
});
