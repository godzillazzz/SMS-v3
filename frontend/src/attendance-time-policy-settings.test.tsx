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

  it('renders company minute controls and scope options only after policy data loads', async () => {
    const loadedPolicy = policyList();
    loadedPolicy.defaultPolicy = { ...defaultPolicy, earlyLeaveEnabled: false, missingCheckoutEnabled: false };
    mocks.load.mockResolvedValue({
      ...loadedPolicy,
      sites: [{ id: 'site-1', code: 'WCS', name: 'Wang Noi' }],
      shiftTypes: [{ id: 'shift-1', code: 'D', name: 'Day' }]
    });
    render(<AttendanceTimePolicySettingsCard token="admin-session" />);

    expect(await screen.findByText('โหลดนโยบายเวลาและรายการ Site/ประเภทกะแล้ว')).toBeTruthy();
    expect(screen.getByLabelText('ผ่อนผันการมาสาย (นาที)')).toBeTruthy();
    expect((screen.getByLabelText('ผ่อนผันการมาสาย (นาที)') as HTMLInputElement).value).toBe('0');
    expect(screen.getByLabelText(/จำกัดเวลาลงเวลาเข้าก่อนกะ/)).toBeTruthy();
    expect(screen.getByLabelText(/จำกัดเวลาลงเวลาเข้าสูงสุด/)).toBeTruthy();
    expect(screen.getByLabelText(/จำกัดเวลาลงเวลาออกเร็วสุด/)).toBeTruthy();
    expect(screen.getByLabelText(/จำกัดเวลาลงเวลาออกช้าสุด/)).toBeTruthy();
    expect(screen.getByLabelText(/ตรวจการออกก่อนเวลา/)).toBeTruthy();
    expect(screen.getByLabelText(/ตรวจรายการที่ไม่มีเวลาออก/)).toBeTruthy();
    expect(screen.getByLabelText(/ตรวจเวลากะที่เปิดค้าง/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('ระดับการตั้งค่า'), { target: { value: 'SITE' } });
    expect(screen.getByRole('option', { name: 'WCS — Wang Noi' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('ระดับการตั้งค่า'), { target: { value: 'SHIFT_TYPE' } });
    expect(screen.getByRole('option', { name: 'D — Day' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('ระดับการตั้งค่า'), { target: { value: 'COMPANY' } });
    fireEvent.change(screen.getByLabelText(/จำกัดเวลาลงเวลาเข้าก่อนกะ/), { target: { value: 'true' } });
    expect(screen.getByLabelText('ลงเวลาเข้าก่อนเริ่มกะได้ (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/จำกัดเวลาลงเวลาเข้าสูงสุด/), { target: { value: 'true' } });
    expect(screen.getByLabelText('จำกัดหลังเริ่มกะ (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/จำกัดเวลาลงเวลาออกเร็วสุด/), { target: { value: 'true' } });
    expect(screen.getByLabelText('ลงเวลาออกได้หลังเริ่มกะ (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/จำกัดเวลาลงเวลาออกช้าสุด/), { target: { value: 'true' } });
    expect(screen.getByLabelText('จำกัดหลังเลิกกะ (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/ตรวจการออกก่อนเวลา/), { target: { value: 'true' } });
    expect(screen.getByLabelText('ผ่อนผันการออกก่อนเวลา (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/ตรวจรายการที่ไม่มีเวลาออก/), { target: { value: 'true' } });
    expect(screen.getByLabelText('ถือว่าไม่มีเวลาออกหลังจบกะ (นาที)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/ตรวจเวลากะที่เปิดค้าง/), { target: { value: 'true' } });
    expect(screen.getByLabelText('เวลากะสูงสุด (นาที)')).toBeTruthy();
  });

  it('shows load failure distinctly and does not present fallback policy values', async () => {
    mocks.load.mockRejectedValue(new Error('API request failed'));
    render(<AttendanceTimePolicySettingsCard token="admin-session" />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('โหลดนโยบายเวลาไม่สำเร็จ')).toBeTruthy();
    expect(screen.getByText('ยังไม่แสดงค่าเริ่มต้นหรือช่องแก้ไข จนกว่าจะโหลดข้อมูลจากระบบได้')).toBeTruthy();
    expect(screen.queryByLabelText('ผ่อนผันการมาสาย (นาที)')).toBeNull();
    expect(screen.getByRole('button', { name: /บันทึกนโยบายเวลา/ })).toHaveProperty('disabled', true);
  });
});
