import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { attendancePrimaryActionState, createAttendanceActivationGuard } from './pages/attendance/attendance-action-state';

const page = readFileSync(new URL('./pages/attendance/AttendancePage.tsx', import.meta.url), 'utf8');

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

  it('makes blocked states explicit instead of presenting Ready while disabled', () => {
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

    const viewOnly = attendancePrimaryActionState({
      readOnly: true,
      online: true,
      busy: false,
      attendanceComplete: false,
      loading: false,
      scheduleReady: true,
      intent: 'CHECK_IN'
    });
    expect(viewOnly.enabled).toBe(false);
    expect(viewOnly.code).toBe('VIEW_ONLY');
    expect(viewOnly.detail).toContain('ไม่อนุญาตให้ลงเวลาแทนพนักงาน');
  });
});

describe('Attendance activation and cancellation hotfix', () => {
  it('starts GPS first, then the authoritative verification start without a duplicate readiness round trip', () => {
    expect(page).toMatch(/handleStartAttendance[\s\S]*?positionOnce\(\)[\s\S]*?checkReadinessWithEvidence\(captureId, undefined, nextLocation, operationEpoch\)/);
    expect(page).toMatch(/checkReadinessWithEvidence[\s\S]*?beginFaceVerificationWithEvidence/);
    expect(page).not.toContain('attendanceReadiness(token');
    expect(page).toMatch(/beginFaceVerificationWithEvidence[\s\S]*?attendanceVerificationStart\(token[\s\S]*?signAttendanceDeviceChallenge[\s\S]*?verifyAttendanceDeviceProof[\s\S]*?setFaceCaptureOpen\(true\)/);
    expect(page).toContain('signAttendanceDeviceChallenge(verification.deviceEnrollmentId, verification.challenge)');
  });

  it('surfaces user-visible reasons when an active attempt is blocked or cancelled', () => {
    expect(page).toContain('const reportInteractionBlocked = () => {');
    expect(page).toContain("setVerificationStage('ขั้นตอนลงเวลาถูกยกเลิก')");
    expect(page).toContain('setError(interactionBlockedMessage())');
    expect(page).toContain('ขั้นตอนลงเวลาถูกยกเลิกเพราะแอปหรือแท็บถูกพัก กรุณากดลงเวลาใหม่');
    expect(page).toContain("setError('Attempt นี้หมดอายุแล้ว กรุณากดลงเวลาใหม่')");
    expect(page).not.toContain('if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;');
  });

  it('routes touch/pen activation into the same primary action and suppresses the following synthetic click', () => {
    expect(page).toContain("if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;");
    expect(page).toContain('attendanceActivationGuardRef.current.notePointerActivation(Date.now())');
    expect(page).toContain('if (attendanceActivationGuardRef.current.shouldIgnoreSyntheticClick(Date.now())) return;');
    expect(page).toContain('handleEmployeePrimaryAction();');
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
