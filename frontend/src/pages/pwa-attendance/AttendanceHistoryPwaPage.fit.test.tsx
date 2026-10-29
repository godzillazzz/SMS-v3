// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const historyMock = vi.fn();
vi.mock('../attendance/attendance-client', () => ({ attendanceSelfHistory: (...args: unknown[]) => historyMock(...args) }));
vi.mock('../attendance-supervisor/attendance-adjustment-client', () => ({
  listAttendanceAdjustments: vi.fn().mockResolvedValue({ data: [] }),
  createAttendanceAdjustment: vi.fn(),
  submitAttendanceAdjustment: vi.fn()
}));
const { AttendanceHistoryPwaPage } = await import('./AttendanceHistoryPwaPage');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const rows = [
  { date: today, assignmentId: 'a-1', employee: { id: 'e1', displayName: 'สมชาย ใจดี' }, shift: { code: 'D', startTime: '08:00', endTime: '17:00' }, actualSite: { id: 's1', name: 'อาคาร A' }, checkInAt: '2026-10-29T01:05:00.000Z', checkOutAt: null, workedMinutes: null, flags: ['LATE'], status: 'IN_PROGRESS' },
  { date: '2026-10-20', assignmentId: 'a-2', employee: { id: 'e1', displayName: 'สมชาย ใจดี' }, shift: { code: 'D' }, checkInAt: '2026-10-20T01:00:00.000Z', checkOutAt: '2026-10-20T10:00:00.000Z', workedMinutes: 540, flags: [], status: 'COMPLETE' }
];

describe('AttendanceHistoryPwaPage — fit-to-viewport redesign', () => {
  afterEach(cleanup);
  beforeEach(() => { historyMock.mockReset(); historyMock.mockResolvedValue({ rows }); });

  it('shows a today card with live time, status, check-in time and location', async () => {
    render(<AttendanceHistoryPwaPage token="t" online />);
    const card = await screen.findByRole('region', { name: 'ลงเวลาวันนี้' });
    expect(within(card).getByTestId('attendance-today-clock').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(within(card).getByText('มาสาย')).toBeTruthy();
    expect(within(card).getByText('อาคาร A')).toBeTruthy();
  });

  it('does not present an assigned site as the actual check-in site', async () => {
    historyMock.mockResolvedValue({ rows: [{ ...rows[0], actualSite: null, assignedSite: { name: 'หน่วยตามตาราง' } }] });
    render(<AttendanceHistoryPwaPage token="t" online />);
    const card = await screen.findByRole('region', { name: 'ลงเวลาวันนี้' });
    await screen.findByRole('table');
    expect(within(card).queryByText('หน่วยตามตาราง')).toBeNull();
    expect(within(card).getByText('–')).toBeTruthy();
  });

  it('renders a single table with the owner columns and "–" for missing data', async () => {
    render(<AttendanceHistoryPwaPage token="t" online />);
    const table = await screen.findByRole('table', { name: 'รายการลงเวลาทั้งหมด' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['พนักงาน', 'วันที่', 'เข้างาน', 'ออกงาน', 'ชั่วโมง', 'สถานที่', 'สถานะ']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body).toHaveLength(2);
    expect(within(body[0]).getAllByText('–').length).toBeGreaterThanOrEqual(2);
    expect(within(body[1]).getByText('มาทำงาน')).toBeTruthy();
    for (const cell of within(body[0]).getAllByRole('cell')) expect(cell.getAttribute('data-label')).toBeTruthy();
  });

  it('offers print, leave and check-in actions', async () => {
    const onOpenLeave = vi.fn(); const onCheckIn = vi.fn();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<AttendanceHistoryPwaPage token="t" online onOpenLeave={onOpenLeave} onCheckIn={onCheckIn} />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: /พิมพ์ประวัติช่วงที่เลือก/ }));
    fireEvent.click(screen.getByRole('button', { name: /ดูการลา/ }));
    fireEvent.click(screen.getByRole('button', { name: /ไปลงเวลา/ }));
    expect(print).toHaveBeenCalled(); expect(onOpenLeave).toHaveBeenCalled(); expect(onCheckIn).toHaveBeenCalled();
  });

  it('keeps fit styles in the page lazy CSS with fixed table layout and no horizontal overflow', () => {
    const css = readFileSync('src/pages/pwa-attendance/attendance-history-fit.css', 'utf8');
    expect(css).toContain('table-layout: fixed');
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toContain('@media (max-width: 760px)');
  });
});
