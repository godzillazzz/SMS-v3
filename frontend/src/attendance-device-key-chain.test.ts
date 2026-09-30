import { describe, expect, it } from 'vitest';
import { correlateAttendanceDeviceKeyIds } from './lib/attendance-device-key';

describe('Attendance device browser/server ID chain', () => {
  it('matches active server enrollment to a key stored under the same ID', () => {
    const chain = correlateAttendanceDeviceKeyIds({
      activeDeviceId: 'enrollment-active',
      verificationDeviceId: 'enrollment-active',
      storedEnrollmentIds: ['enrollment-active']
    });

    expect(chain.activeKeyIdMatch).toBe(true);
    expect(chain.verificationKeyIdMatch).toBe(true);
    expect(chain.verificationMatchesActive).toBe(true);
  });

  it('reports active server device with no matching local key as missing', () => {
    const chain = correlateAttendanceDeviceKeyIds({
      activeDeviceId: 'enrollment-active',
      verificationDeviceId: 'enrollment-active',
      storedEnrollmentIds: []
    });

    expect(chain.activeKeyIdMatch).toBe(false);
    expect(chain.verificationKeyIdMatch).toBe(false);
    expect(chain.verificationMatchesActive).toBe(true);
  });

  it('keeps candidate state separate from active state and identifies a verification mismatch', () => {
    const chain = correlateAttendanceDeviceKeyIds({
      activeDeviceId: 'enrollment-active',
      candidateDeviceId: 'enrollment-candidate',
      verificationDeviceId: 'enrollment-candidate',
      storedEnrollmentIds: ['enrollment-active']
    });

    expect(chain.activeKeyIdMatch).toBe(true);
    expect(chain.candidateKeyIdMatch).toBe(false);
    expect(chain.verificationKeyIdMatch).toBe(false);
    expect(chain.verificationMatchesActive).toBe(false);
  });

  it('deduplicates safe IDs and fails closed when verification is present without an active device', () => {
    const chain = correlateAttendanceDeviceKeyIds({
      verificationDeviceId: 'enrollment-verification',
      storedEnrollmentIds: ['enrollment-verification', 'enrollment-verification']
    });

    expect(chain.storedEnrollmentIds).toEqual(['enrollment-verification']);
    expect(chain.verificationKeyIdMatch).toBe(true);
    expect(chain.verificationMatchesActive).toBe(false);
  });
});
