import { describe, expect, it, vi } from 'vitest';
import type { AttendanceDeviceKeyInspection, AttendanceDeviceKeyInventory } from '../../lib/attendance-device-key';
import type { AttendanceDeviceState, AttendanceVerificationStart } from './attendance-client';
import {
  isCompleteAttendanceVerification,
  performAttendanceDeviceProof,
  type CompleteAttendanceVerification,
  type AttendanceDeviceProofDependencies
} from './attendance-device-proof';

const verification = (overrides: Partial<AttendanceVerificationStart> = {}): CompleteAttendanceVerification => ({
  verificationMode: 'GEOFENCE_ONLY_UAT',
  sessionId: 'verification-session-1',
  deviceEnrollmentId: 'active-device-1',
  status: 'PENDING_DEVICE_PROOF',
  expiresAt: '2026-09-30T12:00:00.000Z',
  challengeId: 'challenge-id-1',
  challenge: 'challenge-bytes',
  attendanceContext: { captureId: 'capture-1', eventIntent: 'CHECK_IN', shiftAssignmentId: 'shift-1', evidence: {} },
  activeChallenge: null,
  ...overrides
} as CompleteAttendanceVerification);

const activeState: AttendanceDeviceState = {
  employeeId: 'employee-1',
  activeDevice: { id: 'active-device-1', status: 'ACTIVE' },
  activeRequest: { candidateDeviceEnrollmentId: 'candidate-device-2' }
};

const inspection = (enrollmentId: string): AttendanceDeviceKeyInspection => ({
  enrollmentId,
  status: 'PRESENT',
  algorithm: 'ECDSA',
  namedCurve: 'P-256',
  extractable: false,
  usages: ['sign'],
  createdAt: '2026-09-30T00:00:00.000Z'
});

const inventory = (...keys: AttendanceDeviceKeyInspection[]): AttendanceDeviceKeyInventory => ({
  available: true,
  enrollmentIds: keys.map((key) => key.enrollmentId),
  keys,
  malformedRecordCount: 0
});

function dependencies(deviceState = activeState, keyInventory = inventory(inspection('active-device-1'), inspection('candidate-device-2'))) {
  return {
    readDeviceState: vi.fn(async () => deviceState),
    readKeyInventory: vi.fn(async () => keyInventory),
    signChallenge: vi.fn(async () => 'signature-result'),
    postDeviceProof: vi.fn(async () => ({ ok: true }))
  } satisfies AttendanceDeviceProofDependencies;
}

const supported = { supported: true } as const;

describe('Attendance device proof flow', () => {
  it('keeps Active Challenge required for normal biometric mode while controlled UAT may omit it', () => {
    expect(isCompleteAttendanceVerification(verification({ verificationMode: 'BIOMETRIC' }))).toBe(false);
    expect(isCompleteAttendanceVerification(verification({ verificationMode: 'BIOMETRIC', activeChallenge: { version: 'v1', code: 'TURN_LEFT', frameCount: 3 } }))).toBe(true);
    expect(isCompleteAttendanceVerification(verification({ verificationMode: 'GEOFENCE_ONLY_UAT', activeChallenge: null }))).toBe(true);
    expect(isCompleteAttendanceVerification(verification({ verificationMode: 'GEOFENCE_ONLY_UAT', deviceEnrollmentId: null }))).toBe(false);
  });

  it('signs the active verification ID and posts device proof when that local key is present', async () => {
    const deps = dependencies();
    const diagnostics = await performAttendanceDeviceProof({
      token: 'test-token',
      requestId: 'request-1',
      verification: verification(),
      capability: supported
    }, deps);

    expect(diagnostics.chain.activeDeviceId).toBe('active-device-1');
    expect(diagnostics.chain.candidateDeviceId).toBe('candidate-device-2');
    expect(diagnostics.chain.verificationDeviceId).toBe('active-device-1');
    expect(diagnostics.chain.verificationMatchesActive).toBe(true);
    expect(diagnostics.inspection?.status).toBe('PRESENT');
    expect(deps.signChallenge).toHaveBeenCalledOnce();
    expect(deps.signChallenge).toHaveBeenCalledWith('active-device-1', 'challenge-bytes');
    expect(deps.postDeviceProof).toHaveBeenCalledOnce();
    expect(deps.postDeviceProof).toHaveBeenCalledWith('test-token', 'verification-session-1', {
      challengeId: 'challenge-id-1',
      challenge: 'challenge-bytes',
      signatureBase64: 'signature-result'
    });
  });

  it('blocks controlled UAT before sign and proof POST when the matching local key is missing', async () => {
    const deps = dependencies(activeState, inventory());
    await expect(performAttendanceDeviceProof({
      token: 'test-token',
      requestId: 'request-2',
      verification: verification(),
      capability: supported
    }, deps)).rejects.toMatchObject({
      name: 'AttendanceFlowError',
      code: 'ATTENDANCE_DEVICE_LOCAL_KEY_MISSING',
      requestId: 'request-2'
    });
    expect(deps.signChallenge).not.toHaveBeenCalled();
    expect(deps.postDeviceProof).not.toHaveBeenCalled();
  });

  it('fails closed for a stale verification ID even if that stale key exists locally', async () => {
    const deps = dependencies(activeState, inventory(inspection('active-device-1'), inspection('stale-device-9')));
    await expect(performAttendanceDeviceProof({
      token: 'test-token',
      verification: verification({ deviceEnrollmentId: 'stale-device-9' }),
      capability: supported
    }, deps)).rejects.toMatchObject({
      name: 'AttendanceFlowError',
      code: 'ATTENDANCE_DEVICE_VERIFICATION_ID_MISMATCH'
    });
    expect(deps.signChallenge).not.toHaveBeenCalled();
    expect(deps.postDeviceProof).not.toHaveBeenCalled();
  });

  it('requires local device proof in controlled UAT even when the face challenge is omitted', async () => {
    const deps = dependencies();
    await performAttendanceDeviceProof({
      token: 'test-token',
      verification: verification({ verificationMode: 'GEOFENCE_ONLY_UAT', activeChallenge: null }),
      capability: supported
    }, deps);
    expect(deps.signChallenge).toHaveBeenCalledOnce();
    expect(deps.postDeviceProof).toHaveBeenCalledOnce();
  });
});
