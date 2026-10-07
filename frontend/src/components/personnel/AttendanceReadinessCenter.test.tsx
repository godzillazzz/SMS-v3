// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AttendanceReadinessCenter } from './AttendanceReadinessCenter';

vi.mock('../../api', () => ({ api: { employeeReadinessCenter: vi.fn() } }));

const response = {
  data: [
    { employee: { id: 'employee-ready', employeeCode: 'E001', firstName: 'กิตติ', lastName: 'พร้อม', department: 'AN1', jobTitle: 'หัวหน้า' }, status: 'READY', blockers: [], checks: {} },
    { employee: { id: 'employee-not-ready', employeeCode: 'E002', firstName: 'นภา', lastName: 'ตรวจเพิ่ม', department: 'AN2', jobTitle: 'พนักงาน' }, status: 'NOT_READY', blockers: [{ code: 'ACCOUNT_REQUIRED', label: 'User Account', detail: 'ยังไม่มีบัญชี' }], checks: {} }
  ],
  summary: { total: 2, ready: 1, notReady: 1, blockerCounts: { ACCOUNT_REQUIRED: 1 } },
  limitedTo: 50
};

describe('AttendanceReadinessCenter', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.employeeReadinessCenter).mockResolvedValue(response as never);
  });

  it('starts collapsed, shows authoritative Thai counts and filters authoritative statuses', async () => {
    const onReadinessChange = vi.fn();
    const { container } = render(<AttendanceReadinessCenter token="fixture-token" enabled onReadinessChange={onReadinessChange} />);

    expect((await screen.findByTestId('readiness-summary')).textContent).toBe('พร้อม 1 · ไม่พร้อม 1');
    const toggle = screen.getByRole('button', { name: 'ดูรายละเอียด' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.attendance-readiness-center__details')?.hasAttribute('hidden')).toBe(true);
    expect(api.employeeReadinessCenter).toHaveBeenCalledWith('fixture-token', '', 50);
    expect(onReadinessChange).toHaveBeenLastCalledWith({
      token: 'fixture-token',
      state: 'ready',
      byEmployeeId: { 'employee-ready': 'READY', 'employee-not-ready': 'NOT_READY' }
    });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const filterGroup = screen.getByRole('group', { name: 'กรองความพร้อม' });
    expect(within(filterGroup).getByRole('button', { name: 'ทั้งหมด' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(filterGroup).getByRole('button', { name: 'พร้อม' })).toBeTruthy();
    expect(within(filterGroup).getByRole('button', { name: 'ไม่พร้อม' })).toBeTruthy();
    expect(container.querySelectorAll('.attendance-readiness-row')).toHaveLength(2);

    fireEvent.click(within(filterGroup).getByRole('button', { name: 'ไม่พร้อม' }));
    expect(container.querySelectorAll('.attendance-readiness-row')).toHaveLength(1);
    expect(screen.getByText('นภา ตรวจเพิ่ม')).toBeTruthy();
    expect(screen.queryByText('กิตติ พร้อม')).toBeNull();
    expect(within(filterGroup).getByRole('button', { name: 'ไม่พร้อม' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not replace unavailable authority with zero counts', async () => {
    vi.mocked(api.employeeReadinessCenter).mockRejectedValueOnce(new Error('unavailable'));
    const onReadinessChange = vi.fn();
    render(<AttendanceReadinessCenter token="fixture-token" enabled onReadinessChange={onReadinessChange} />);

    expect((await screen.findByText('ตรวจสอบความพร้อมไม่ได้')).textContent).toBe('ตรวจสอบความพร้อมไม่ได้');
    expect(screen.queryByTestId('readiness-summary')).toBeNull();
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ token: 'fixture-token', state: 'error', byEmployeeId: {} }));
  });

  it('does not request readiness for roles the endpoint does not authorize', () => {
    const onReadinessChange = vi.fn();
    const { container } = render(<AttendanceReadinessCenter token="fixture-token" enabled={false} onReadinessChange={onReadinessChange} />);

    expect(container.firstChild).toBeNull();
    expect(api.employeeReadinessCenter).not.toHaveBeenCalled();
  });
});
