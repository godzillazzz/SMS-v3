import { describe, expect, it, vi } from 'vitest';
import { attendancePrimaryActionState, createAttendanceActivationGuard } from './pages/attendance/attendance-action-state';

describe('Attendance primary action state', () => {
  it('allows an idle employee with an approved schedule to start CHECK_IN without QR/Face/Device pre-gates', () => {
    expect(attendancePrimaryActionState({
      readOnly: false,
      online: true,
      busy: false,
      attendanceComplete: false,
      loading: false,
      scheduleReady: true,
      intent: 'CHECK_IN'
    })).toMatchObject({
      code: 'READY',
      enabled: true,
      actionText: 'TAP TO CHECK IN',
      readyLine: 'Ready for CHECK IN'
    });
  });

  it('makes a blocked state explicit instead of presenting Ready while disabled', () => {
    const offline = attendancePrimaryActionState({
      readOnly: false,
      online: false,
      busy: false,
      attendanceComplete: false,
      loading: false,
      scheduleReady: true,
      intent: 'CHECK_IN'
    });
    expect(offline.enabled).toBe(false);
    expect(offline.code).toBe('OFFLINE');
    expect(offline.actionText).toBe('OFFLINE');
    expect(offline.detail).toContain('ออฟไลน์');
  });
});

describe('Attendance activation guard', () => {
  it('runs one underlying attempt for a double activation while the first is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const attempt = vi.fn(async () => { await pending; });
    const guard = createAttendanceActivationGuard();

    const first = guard.runExclusive(attempt);
    const second = guard.runExclusive(attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(await second).toBe(false);
    release();
    expect(await first).toBe(true);
  });

  it('deduplicates the synthetic click that follows a touch/pen pointer activation', () => {
    const guard = createAttendanceActivationGuard(800);
    guard.notePointerActivation(1000);
    expect(guard.shouldIgnoreSyntheticClick(1200)).toBe(true);
    expect(guard.shouldIgnoreSyntheticClick(1800)).toBe(false);
  });
});
