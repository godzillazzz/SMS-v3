// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));

vi.mock('./attendance-time-policy-client', () => ({
  loadAttendanceTimePolicies: mocks.load,
  saveAttendanceTimePolicy: mocks.save
}));

import { AttendanceTimePolicySettingsCard, attendanceTimePolicyDateTime } from './components/AttendanceTimePolicySettingsCard';

const defaultPolicy = {
  lateGraceMinutes: 0,
  earliestCheckInEnabled: false,
  earliestCheckInMinutesBeforeStart: 60,
  latestCheckInEnabled: false,
  latestCheckInMinutesAfterStart: null,
  earliestCheckOutEnabled: false,
  earliestCheckOutMinutesAfterStart: 0,
  latestCheckOutEnabled: false,
  latestCheckOutMinutesAfterEnd: null,
  earlyLeaveEnabled: true,
  earlyCheckoutToleranceMinutes: 0,
  missingCheckoutEnabled: true,
  missingCheckoutAfterMinutes: 0,
  maxShiftDurationEnabled: false,
  maxShiftDurationMinutes: null
};

function policyList() {
  return { now: '2026-10-02T00:00:00.000Z', defaultPolicy, sites: [], shiftTypes: [], policies: [] };
}

describe('Attendance time policy Admin screen', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('interprets effective-dated inputs in Asia/Bangkok regardless of browser timezone', () => {
    expect(attendanceTimePolicyDateTime.parse('2026-10-03T07:00')?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(attendanceTimePolicyDateTime.format('2026-10-03T00:00:00.000Z')).toBe('2026-10-03T07:00');
    expect(attendanceTimePolicyDateTime.parse('2026-02-31T07:00')).toBeNull();
  });

  it('keeps late check-in unrestricted until Admin turns the latest-window rule on', async () => {
    mocks.load.mockResolvedValue(policyList());
    mocks.save.mockResolvedValue({ id: 'policy-v2' });
    render(<AttendanceTimePolicySettingsCard token="admin-session" />);

    const latestToggle = await screen.findByRole('combobox', { name: /จำกัดเวลาลงเวลาเข้าสูงสุด/ });
    expect((latestToggle as HTMLSelectElement).value).toBe('false');
    fireEvent.change(latestToggle, { target: { value: 'true' } });
    expect(await screen.findByLabelText('จำกัดหลังเริ่มกะ (นาที)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/เริ่มใช้นโยบาย \(เวลาไทย\)/), { target: { value: '2026-10-03T07:00' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึกนโยบายเวลา/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][1]).toMatchObject({
      effectiveFrom: '2026-10-03T00:00:00.000Z',
      policy: { latestCheckInEnabled: true, latestCheckInMinutesAfterStart: 30 }
    });
  });
});
