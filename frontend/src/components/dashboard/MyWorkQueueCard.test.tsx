// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
afterEach(cleanup);
import fs from 'node:fs';
import path from 'node:path';
import { MyWorkQueueCard } from './MyWorkQueueCard';

const byType = { EMPLOYEE_MASTER_CHANGE: 0, EMPLOYEE_REFERENCE_PHOTO: 0, LICENSE_DOCUMENT: 2, SCHEDULE_APPROVAL: 1, ATTENDANCE_DEVICE_REQUEST: 0, ATTENDANCE_ADJUSTMENT_REQUEST: 0, REGISTRATION_REQUEST: 0, USER_ACCESS: 0, LEAVE_REQUEST: 4 };

describe('D-01 งานของฉัน', () => {
  it('lists only non-empty request types, largest first, and opens the center filtered by type', () => {
    const onOpen = vi.fn();
    render(<MyWorkQueueCard summary={{ total: 7, byType }} onOpen={onOpen} />);
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('คำขอลา');
    expect(screen.queryByText('รูปอ้างอิงพนักงาน')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /คำขอลา 4 รายการ/ }));
    expect(onOpen).toHaveBeenCalledWith('LEAVE_REQUEST');
    fireEvent.click(screen.getByRole('button', { name: 'เปิดศูนย์อนุมัติ' }));
    expect(onOpen).toHaveBeenLastCalledWith();
  });

  it('never invents numbers while loading or after a failed count', () => {
    const { rerender } = render(<MyWorkQueueCard summary={null} status="loading" onOpen={() => undefined} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<MyWorkQueueCard summary={null} status="error" onOpen={() => undefined} />);
    expect(screen.getByText(/ไม่แสดงตัวเลขแทน/)).toBeTruthy();
  });

  it('uses the existing approval summary and Approval Center type filter, no new API', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MyWorkQueueCard.tsx'), 'utf8');
    expect(src).not.toMatch(/fetch\(|\/api\//);
    const main = fs.readFileSync(path.join(__dirname, '../../main.tsx'), 'utf8');
    expect(main).toContain("setActivePage('approvalCenter', type ? { type } : undefined, false)");
  });
});
