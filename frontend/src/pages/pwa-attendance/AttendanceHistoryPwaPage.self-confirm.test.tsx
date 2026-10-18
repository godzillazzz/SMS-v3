// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const historyMock = vi.fn();
const listMock = vi.fn();
const createMock = vi.fn();
const submitMock = vi.fn();

vi.mock('../attendance/attendance-client', () => ({
  attendanceSelfHistory: (...args: unknown[]) => historyMock(...args)
}));
vi.mock('../attendance-supervisor/attendance-adjustment-client', () => ({
  listAttendanceAdjustments: (...args: unknown[]) => listMock(...args),
  createAttendanceAdjustment: (...args: unknown[]) => createMock(...args),
  submitAttendanceAdjustment: (...args: unknown[]) => submitMock(...args)
}));

const { AttendanceHistoryPwaPage } = await import('./AttendanceHistoryPwaPage');

const bangkokDate = (offsetDays: number) => {
  const base = new Date();
  const utc = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(utc);
};

const row = (overrides: Record<string, unknown> = {}) => ({
  date: bangkokDate(-1),
  assignmentId: 'assignment-1',
  employee: { id: 'employee-1', displayName: 'พนักงาน ทดสอบ' },
  shift: { code: 'D', name: 'กะกลางวัน', startTime: '08:00', endTime: '17:00' },
  flags: ['MISSING_CHECK_OUT'],
  status: 'TIME_ABNORMAL',
  checkInAt: '2026-10-17T01:00:00.000Z',
  checkOutAt: null,
  corrected: false,
  ...overrides
});

describe('AttendanceHistoryPwaPage — employee self confirmation (shift aware)', () => {
  afterEach(cleanup);

  beforeEach(() => {
    historyMock.mockReset();
    listMock.mockReset();
    createMock.mockReset();
    submitMock.mockReset();
    listMock.mockResolvedValue({ data: [] });
  });

  it('offers the confirmation action for a shift with a recording problem', async () => {
    historyMock.mockResolvedValue({ rows: [row()], summary: {} });
    render(<AttendanceHistoryPwaPage token="token" online />);
    expect(await screen.findByRole('button', { name: /ยืนยันการปฏิบัติงานวันที่/ })).toBeTruthy();
  });

  it('does not offer the action when the recorded shift is complete and normal', async () => {
    historyMock.mockResolvedValue({
      rows: [row({ flags: [], status: 'COMPLETE', checkOutAt: '2026-10-17T10:00:00.000Z' })],
      summary: {}
    });
    render(<AttendanceHistoryPwaPage token="token" online />);
    await screen.findByText('ประวัติการลงเวลา', { selector: 'h1' });
    await waitFor(() => expect(historyMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /ยืนยันการปฏิบัติงานวันที่/ })).toHaveLength(0));
  });

  it('hides the action for shifts older than the seven day window', async () => {
    historyMock.mockResolvedValue({ rows: [row({ date: bangkokDate(-12) })], summary: {} });
    render(<AttendanceHistoryPwaPage token="token" online />);
    await screen.findByText('ประวัติการลงเวลา', { selector: 'h1' });
    await waitFor(() => expect(historyMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /ยืนยันการปฏิบัติงานวันที่/ })).toHaveLength(0));
  });

  it('shows the existing request status instead of the action', async () => {
    historyMock.mockResolvedValue({ rows: [row()], summary: {} });
    listMock.mockResolvedValue({ data: [{ id: 'req-1', shiftAssignmentId: 'assignment-1', status: 'PENDING_APPROVAL' }] });
    render(<AttendanceHistoryPwaPage token="token" online />);
    expect(await screen.findByText(/มีคำขอสำหรับกะนี้แล้ว/)).toBeTruthy();
  });

  it('defaults a night shift to next-day checkout and previews the resolved range', async () => {
    historyMock.mockResolvedValue({
      rows: [row({ shift: { code: 'N', name: 'กะดึก', startTime: '20:00', endTime: '05:00' } })],
      summary: {}
    });
    render(<AttendanceHistoryPwaPage token="token" online />);

    fireEvent.click(await screen.findByRole('button', { name: /ยืนยันการปฏิบัติงานวันที่/ }));
    const dialog = await screen.findByRole('dialog', { name: 'ยืนยันการปฏิบัติงาน' });
    expect(dialog.textContent).toContain('ข้ามคืน');

    const checkbox = screen.getByRole('checkbox', { name: /ออกวันถัดไป/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const timeInputs = dialog.querySelectorAll('input[type="time"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(timeInputs[0], { target: { value: '20:05' } });
    fireEvent.change(timeInputs[1], { target: { value: '05:10' } });

    await waitFor(() => expect(dialog.textContent).toMatch(/9\.0[0-9] ชม\./));
  });

  it('rejects an impossible duration before submitting', async () => {
    historyMock.mockResolvedValue({ rows: [row()], summary: {} });
    render(<AttendanceHistoryPwaPage token="token" online />);

    fireEvent.click(await screen.findByRole('button', { name: /ยืนยันการปฏิบัติงานวันที่/ }));
    const dialog = await screen.findByRole('dialog', { name: 'ยืนยันการปฏิบัติงาน' });

    const timeInputs = dialog.querySelectorAll('input[type="time"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(timeInputs[0], { target: { value: '08:00' } });
    fireEvent.change(timeInputs[1], { target: { value: '07:00' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ยืนยันเวลาทำงานจริง' } });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอยืนยัน' }));

    expect(await screen.findByText(/เวลาออกต้องอยู่หลังเวลาเข้า/)).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });
});
