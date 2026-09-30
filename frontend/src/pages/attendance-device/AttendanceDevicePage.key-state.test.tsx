// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AttendanceDevicePage } from './AttendanceDevicePage';
import type { AttendanceDeviceKeyInspection, AttendanceDeviceKeyInventory } from '../../lib/attendance-device-key';

vi.mock('../../api', () => ({ api: { attendanceDeviceState: vi.fn() } }));
vi.mock('../../pages/attendance/attendance-client', () => ({
  attendanceDeviceAdminOverview: vi.fn(),
  revokeAttendanceDeviceCurrent: vi.fn()
}));
vi.mock('../../lib/attendance-device-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance-device-key')>();
  return {
    ...actual,
    attendanceDeviceCapability: vi.fn(() => ({ supported: true })),
    listAttendanceDeviceKeyIds: vi.fn(),
    pruneAttendanceDeviceKeys: vi.fn(async () => 0),
    deleteAttendanceDeviceKey: vi.fn(),
    generateAttendanceDeviceKeyPair: vi.fn(),
    signAttendanceDeviceChallenge: vi.fn(),
    storeAttendanceDevicePrivateKey: vi.fn()
  };
});

const present = (enrollmentId: string): AttendanceDeviceKeyInspection => ({
  enrollmentId,
  status: 'PRESENT',
  algorithm: 'ECDSA',
  namedCurve: 'P-256',
  extractable: false,
  usages: ['sign'],
  createdAt: '2026-09-01T00:00:00.000Z'
});

function inventory(keys: AttendanceDeviceKeyInspection[]): AttendanceDeviceKeyInventory {
  return { available: true, enrollmentIds: keys.map((key) => key.enrollmentId), keys, malformedRecordCount: 0 };
}

const active = {
  id: 'enrollment-active', employeeId: 'employee-1', displayName: 'iPhone', keyAlgorithm: 'ECDSA_P256_SHA256',
  platformHint: 'iPhone', status: 'ACTIVE' as const, activatedAt: '2026-09-01T00:00:00.000Z'
};

afterEach(() => cleanup());

beforeEach(() => vi.clearAllMocks());

describe('AttendanceDevicePage local key readiness', () => {
  it('shows READY_LOCAL_KEY only when the active server ID is present in this browser storage', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: active, activeRequest: null } } as never);
    const keys = inventory([present(active.id)]);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(keys);

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    const device = await screen.findByTestId('attendance-active-device');
    await waitFor(() => expect(device.getAttribute('data-local-key-state')).toBe('READY_LOCAL_KEY'));
    expect(screen.getByText('Private key พร้อมใน browser นี้')).toBeTruthy();
    expect(screen.getByText(/พร้อมทำ device proof/)).toBeTruthy();
    expect(screen.getByText('SERVER_ACTIVE_DEVICE')).toBeTruthy();
    expect(screen.getByText('LOCAL_PRIVATE_KEY_PRESENT')).toBeTruthy();
    expect(screen.getByText('VERIFICATION_DEVICE_ID_MATCH')).toBeTruthy();
  });

  it('shows a warning and never presents READY when the active server ID is absent locally', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: active, activeRequest: null } } as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    const device = await screen.findByTestId('attendance-active-device');
    await waitFor(() => expect(device.getAttribute('data-local-key-state')).toBe('MISSING_LOCAL_KEY'));
    expect(screen.getByText('สถานะ Server ACTIVE แต่ local key ยังไม่พร้อม')).toBeTruthy();
    expect(screen.getByText('LOCAL_PRIVATE_KEY_PRESENT')).toBeTruthy();
    expect(screen.getByText('VERIFICATION_DEVICE_ID_MATCH')).toBeTruthy();
    expect(screen.getByText(/Attendance จะหยุดก่อน device proof/)).toBeTruthy();
    expect(screen.queryByText('Private key พร้อมใน browser นี้')).toBeNull();
  });

  it('reports active and in-flight candidate key states independently', async () => {
    const candidateId = 'enrollment-candidate';
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: {
      employeeId: 'employee-1', activeDevice: active,
      activeRequest: {
        id: 'request-1', employeeId: 'employee-1', requestType: 'REPLACEMENT', status: 'PENDING_APPROVAL',
        requestedByUserId: 'user-1', candidateDeviceEnrollmentId: candidateId, createdAt: '2026-09-01T00:00:00.000Z',
        candidateDevice: { ...active, id: candidateId, status: 'PENDING_APPROVAL', displayName: 'Candidate iPhone', proofVerifiedAt: null }
      }
    } } as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([present(active.id), present(candidateId)]));

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    const activeDevice = await screen.findByTestId('attendance-active-device');
    const candidate = await screen.findByTestId('attendance-candidate-key-state');
    await waitFor(() => {
      expect(activeDevice.getAttribute('data-local-key-state')).toBe('READY_LOCAL_KEY');
      expect(candidate.getAttribute('data-local-key-state')).toBe('PRESENT');
    });
    expect(screen.getByText('SERVER_ACTIVE_DEVICE')).toBeTruthy();
    expect(screen.getByText('ACTIVE_REQUEST_CANDIDATE_ID')).toBeTruthy();
  });
});
