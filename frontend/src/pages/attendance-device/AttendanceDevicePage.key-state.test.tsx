// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AttendanceDevicePage } from './AttendanceDevicePage';
import type { AttendanceDeviceKeyInspection, AttendanceDeviceKeyInventory } from '../../lib/attendance-device-key';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    ...actual,
    api: { ...actual.api, attendanceDeviceState: vi.fn(), attendanceDeviceRequests: vi.fn(), createAttendanceDeviceRequest: vi.fn() }
  };
});
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
  it('does not show zero-valued admin counts before queue data has loaded', async () => {
    vi.mocked(api.attendanceDeviceState).mockImplementation(() => new Promise(() => undefined) as never);
    vi.mocked(api.attendanceDeviceRequests).mockImplementation(() => new Promise(() => undefined) as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockImplementation(() => new Promise(() => undefined));

    const { container } = render(<AttendanceDevicePage token="test" role="ADMIN" />);

    expect(container.querySelectorAll('.attendance-device-queue-count')).toHaveLength(0);
    expect(screen.getByText('กำลังโหลดคิวอนุมัติ…')).toBeTruthy();
    expect(screen.getByText('กำลังโหลดประวัติอุปกรณ์…')).toBeTruthy();
  });

  it('shows device request, status, and audit enums in Thai', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: null, activeRequest: null } } as never);
    vi.mocked(api.attendanceDeviceRequests).mockResolvedValue({ data: [] } as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockResolvedValue([{
      employeeId: 'employee-1',
      employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' },
      activeDevice: null,
      activeRequest: {
        id: 'request-1', employeeId: 'employee-1', requestType: 'REPLACEMENT', status: 'RETURNED_FOR_CORRECTION',
        requestedByUserId: 'user-1', candidateDeviceEnrollmentId: 'device-2', createdAt: '2026-10-07T00:00:00.000Z', reason: null
      },
      history: [{
        id: 'device-1', employeeId: 'employee-1', displayName: 'โทรศัพท์เดิม', keyAlgorithm: 'ECDSA', status: 'REVOKED', revokedAt: '2026-10-06T00:00:00.000Z'
      }],
      recentAudit: [{ id: 'audit-1', action: 'UPDATE', entityType: 'AttendanceDeviceEnrollment', entityId: 'device-1', metadata: { event: 'ADMIN_REVOKE_CURRENT' }, createdAt: '2026-10-06T00:00:00.000Z', actor: { id: 'user-2', displayName: 'ผู้ดูแล' } }]
    }] as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));

    render(<AttendanceDevicePage token="test" role="ADMIN" />);

    expect(await screen.findByText('เปลี่ยนอุปกรณ์ · ส่งกลับให้แก้ไข')).toBeTruthy();
    expect(await screen.findByText('ยกเลิกการใช้งาน')).toBeTruthy();
    expect(await screen.findByText('ผู้ดูแลยกเลิกอุปกรณ์ปัจจุบัน')).toBeTruthy();
    expect(screen.queryByText('REPLACEMENT')).toBeNull();
    expect(screen.queryByText('RETURNED_FOR_CORRECTION')).toBeNull();
    expect(screen.queryByText('REVOKED')).toBeNull();
  });

  it('shows READY_LOCAL_KEY only when the active server ID is present in this browser storage', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: active, activeRequest: null } } as never);
    const keys = inventory([present(active.id)]);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(keys);

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    const device = await screen.findByTestId('attendance-active-device');
    await waitFor(() => expect(device.getAttribute('data-local-key-state')).toBe('READY_LOCAL_KEY'));
    expect(screen.getByText('คีย์ลับพร้อมใช้งานบนอุปกรณ์นี้')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'สถานะอุปกรณ์ของฉัน' }).querySelectorAll('li')[2].textContent).toContain('เสร็จแล้ว');
    expect(screen.getByText(/พร้อมยืนยันอุปกรณ์/)).toBeTruthy();
    expect(screen.getByText('อุปกรณ์หลักในระบบ')).toBeTruthy();
    expect(screen.getByText('มีคีย์ส่วนตัวในอุปกรณ์นี้')).toBeTruthy();
    expect(screen.getByText('ผลการตรวจสอบรหัสอุปกรณ์')).toBeTruthy();
  });

  it('shows a warning and never presents READY when the active server ID is absent locally', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: active, activeRequest: null } } as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    const device = await screen.findByTestId('attendance-active-device');
    await waitFor(() => expect(device.getAttribute('data-local-key-state')).toBe('MISSING_LOCAL_KEY'));
    expect(screen.getByText('ระบบระบุว่าอุปกรณ์ใช้งานอยู่ แต่ยังไม่พบคีย์ในอุปกรณ์นี้')).toBeTruthy();
    expect(screen.getByText('มีคีย์ส่วนตัวในอุปกรณ์นี้')).toBeTruthy();
    expect(screen.getByText('ผลการตรวจสอบรหัสอุปกรณ์')).toBeTruthy();
    expect(screen.getByText(/ระบบจะหยุดการลงเวลาก่อนยืนยันอุปกรณ์/)).toBeTruthy();
    expect(screen.queryByText('คีย์ลับพร้อมใช้งานบนอุปกรณ์นี้')).toBeNull();
    expect(screen.getByRole('region', { name: 'สถานะอุปกรณ์ของฉัน' }).querySelectorAll('li')[2].textContent).not.toContain('เสร็จแล้ว');
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
    const reviewStep = screen.getByRole('region', { name: 'สถานะอุปกรณ์ของฉัน' }).querySelectorAll('li')[1];
    expect(reviewStep.getAttribute('aria-current')).toBe('step');
    expect(reviewStep.textContent).not.toContain('เสร็จแล้ว');
    await waitFor(() => {
      expect(activeDevice.getAttribute('data-local-key-state')).toBe('READY_LOCAL_KEY');
      expect(candidate.getAttribute('data-local-key-state')).toBe('PRESENT');
    });
    expect(screen.getByText('อุปกรณ์หลักในระบบ')).toBeTruthy();
    expect(screen.getByText('รหัสอุปกรณ์ที่รอพิจารณา')).toBeTruthy();
  });

  it('shows the employee-link error in Thai, folds the request ID, and hides first-device enrollment', async () => {
    const requestId = 'req-attendance-employee-link-42';
    const error = Object.assign(new Error('A linked employee account is required.'), {
      details: { code: 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED' },
      requestId
    });
    vi.mocked(api.attendanceDeviceState).mockReset();
    vi.mocked(api.attendanceDeviceState).mockImplementation(() => Promise.reject(error));

    render(<AttendanceDevicePage token="test" role="EMPLOYEE" />);

    await waitFor(() => expect(api.attendanceDeviceState).toHaveBeenCalled());
    expect(api.attendanceDeviceState).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ')).toBeTruthy();
    expect(screen.queryByLabelText('ชื่ออุปกรณ์')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ลงทะเบียนอุปกรณ์เครื่องแรก' })).toBeNull();
    const details = screen.getByText('รายละเอียดสำหรับผู้ดูแล').closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain(requestId);
    expect(api.createAttendanceDeviceRequest).not.toHaveBeenCalled();
  });
});
