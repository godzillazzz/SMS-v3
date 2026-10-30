import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collectAllPages, monthPrintTargetDate, EMPLOYEE_PAGE_SIZE } from './report-center-export';

const page = fs.readFileSync(path.join(__dirname, 'ReportCenterPage.tsx'), 'utf8');
const employeesRoute = fs.readFileSync(path.resolve(__dirname, '../../../../src/routes/employees.routes.js'), 'utf8');

describe('report center export helpers', () => {
  it('uses month end for past months and today for the current month', () => {
    expect(monthPrintTargetDate(2026, 9, '2026-10-30')).toBe('2026-09-30');
    expect(monthPrintTargetDate(2026, 2, '2026-10-30')).toBe('2026-02-28');
    expect(monthPrintTargetDate(2026, 10, '2026-10-30')).toBe('2026-10-30');
    expect(monthPrintTargetDate(2026, 11, '2026-10-30')).toBeNull();
  });

  it('collects every page until meta.totalPages', async () => {
    const load = vi.fn(async (pageNumber: number) => ({ data: [{ id: `r${pageNumber}` }], meta: { totalPages: 3 } }));
    await expect(collectAllPages(load)).resolves.toEqual([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed paginated responses instead of printing partial data', async () => {
    await expect(collectAllPages(async () => ({ data: 'bad' }))).rejects.toThrow();
  });

  it('stays within the employees API page size limit', () => {
    const max = Number(/pageSize: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)\.default\(20\)/.exec(employeesRoute)?.[1]);
    expect(max).toBeGreaterThan(0);
    expect(EMPLOYEE_PAGE_SIZE).toBeLessThanOrEqual(max);
    expect(page).not.toContain('pageSize: 500');
  });

  it('prints a chosen employee through the scoped month-print API', () => {
    expect(page).toContain('attendanceSupervisorMonthPrint(token, targetDate, timesheetEmployeeId)');
    expect(page).toContain('aria-label="เลือกพนักงานสำหรับพิมพ์รายบุคคล"');
    expect(page).not.toContain('sourceEmployees.slice(0, 1)');
  });
});
