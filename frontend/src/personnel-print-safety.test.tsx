// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EmployeeRecordPrint, EmployeeRegisterPrint } from './components/personnel/PersonnelPrintForms';
import { loadEmployeePrintLeaves } from './components/personnel/personnel-print-leaves';
import type { PersonnelRecord } from './components/personnel/types';
import { readFileSync } from 'node:fs';

const employee = { id: 'selected', firstName: 'A', lastName: 'B', isActive: true } as PersonnelRecord;
describe('safe print behavior', () => {
  it('fetches all pages without invalid year-only query, filters year and rejects mismatched employee', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ data: [{ id: '1', employeeId: 'selected', startDate: '2026-01-01', endDate: '2026-01-02' }], meta: { totalPages: 2 } }).mockResolvedValueOnce({ data: [{ id: '2', employeeId: 'other', startDate: '2026-02-01', endDate: '2026-02-02' }], meta: { totalPages: 2 } });
    await expect(loadEmployeePrintLeaves(fetch, 'token', 'selected', 2026)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledWith('token', 1, { employeeId: 'selected' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('collects year overlaps across pages and rejects failed or malformed responses', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ data: [{ id: 'old', employeeId: 'selected', startDate: '2025-01-01', endDate: '2025-01-02' }, { id: 'overlap', employeeId: 'selected', startDate: '2025-12-31', endDate: '2026-01-02' }], meta: { totalPages: 2 } }).mockResolvedValueOnce({ data: [{ id: 'new', employeeId: 'selected', startDate: '2026-02-01', endDate: '2026-02-02' }], meta: { totalPages: 2 } });
    expect((await loadEmployeePrintLeaves(fetch, 'token', 'selected', 2026)).map(row => row.id)).toEqual(['overlap', 'new']);
    await expect(loadEmployeePrintLeaves(vi.fn().mockRejectedValue(new Error('network')), 'token', 'selected', 2026)).rejects.toThrow();
    await expect(loadEmployeePrintLeaves(vi.fn().mockResolvedValue({ data: [], meta: {} }), 'token', 'selected', 2026)).rejects.toThrow();
  });
  it('marks failure unavailable and does not call active employees normally working', () => {
    const view = render(<><EmployeeRecordPrint employee={employee} /><EmployeeRegisterPrint rows={[employee]} /></>);
    expect(view.container.querySelector('.personnel-record-print__history')?.textContent).toContain('ไม่สามารถ');
    expect(view.container.querySelector('.personnel-register-print__summary')?.textContent).not.toContain('ปฏิบัติงานปกติ 1');
    expect(view.container.querySelector('#personnel-register-print tbody')?.textContent).not.toContain('ปฏิบัติงาน');
    cleanup();
  });
  it('wires actual shell navigation and identifies printed date range', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain("onOpenLeave={() => selectPwaPage('leave')}");
    expect(main).toContain("onCheckIn={() => selectPwaPage('attendance')}");
    const history = readFileSync('src/pages/pwa-attendance/AttendanceHistoryPwaPage.tsx', 'utf8');
    expect(history).toContain('selected.from');
    expect(history).toContain('ช่วงที่เลือก');
    expect(history).not.toContain('พิมพ์รายงานประจำวัน');
  });
});
