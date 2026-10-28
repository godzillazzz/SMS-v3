// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  revokeAttendanceDeviceCurrent: vi.fn(),
  promoteAttendanceDevice: vi.fn(),
  rejectAttendanceDevice: vi.fn(),
  attendanceDeviceSelfieBlob: vi.fn()
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
    // Owner issue 9: employee devices now open from the table's edit button.
    fireEvent.click(await screen.findByRole('button', { name: /^แก้ไขอุปกรณ์ของ/ }));

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

  it.each(['ADMIN', 'SUPERVISOR'])('does not show the employee-link warning to %s when the account is not enrolling its own device', async (role) => {
    const error = Object.assign(new Error('A linked employee account is required.'), {
      details: { code: 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED' },
      requestId: `req-${role.toLowerCase()}-unlinked`
    });
    vi.mocked(api.attendanceDeviceState).mockReset();
    vi.mocked(api.attendanceDeviceState).mockImplementation(() => Promise.reject(error));

    render(<AttendanceDevicePage token="test" role={role} />);

    await waitFor(() => expect(api.attendanceDeviceState).toHaveBeenCalled());
    expect(screen.queryByText('บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ')).toBeNull();
    expect(screen.queryByText('ลงทะเบียนอุปกรณ์เครื่องแรก')).toBeNull();
    expect(screen.getByText('บัญชีผู้ดูแลไม่ใช้ลงเวลาเอง')).toBeTruthy();
  });
});

describe('AttendanceDevicePage admin history presentation', () => {
  it('keeps the current primary and pending candidate out of collapsed historical records', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: null, activeRequest: null } } as never);
    vi.mocked(api.attendanceDeviceRequests).mockResolvedValue({ data: [] } as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    const candidate = { id: 'candidate-1', employeeId: 'employee-1', displayName: 'เครื่องใหม่', keyAlgorithm: 'ECDSA', status: 'PENDING_APPROVAL' as const, proofVerifiedAt: '2026-10-26T00:00:00.000Z' };
    const historical = { id: 'old-1', employeeId: 'employee-1', displayName: 'เครื่องเก่า', keyAlgorithm: 'ECDSA', status: 'REVOKED' as const, revokedAt: '2026-10-01T00:00:00.000Z' };
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockResolvedValue([{ employeeId: 'employee-1', employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' }, activeDevice: active, activeRequest: { id: 'request-1', employeeId: 'employee-1', requestType: 'REPLACEMENT', status: 'PENDING_APPROVAL', requestedByUserId: 'user-1', candidateDeviceEnrollmentId: candidate.id, createdAt: '2026-10-26T00:00:00.000Z' }, history: [active, candidate, historical], recentAudit: [] }] as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));

    render(<AttendanceDevicePage token="test" role="ADMIN" />);
    // Owner issue 9: employee devices now open from the table's edit button.
    fireEvent.click(await screen.findByRole('button', { name: /^แก้ไขอุปกรณ์ของ/ }));

    expect(await screen.findByText('รายละเอียดอุปกรณ์และประวัติ (1)')).toBeTruthy();
    expect(screen.getByText('อุปกรณ์ก่อนหน้า')).toBeTruthy();
    expect(screen.getByText('กิจกรรมล่าสุด')).toBeTruthy();
  });
});

describe('AttendanceDevicePage ADMIN promote with selfie review', () => {
  it('shows the clock-in selfie behind the eye button before the admin confirms', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: null, activeRequest: null } } as never);
    vi.mocked(api.attendanceDeviceRequests).mockResolvedValue({ data: [] } as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    const candidate = { id: 'device-new', employeeId: 'employee-1', displayName: 'อุปกรณ์ลงเวลา', keyAlgorithm: 'ECDSA_P256_SHA256', status: 'PENDING_APPROVAL' as const, proofVerifiedAt: '2026-10-26T15:52:00.000Z', latestSelfieAt: '2026-10-26T15:52:00.000Z' };
    const pendingRequest = { id: 'request-new', employeeId: 'employee-1', requestType: 'REPLACEMENT', status: 'PENDING_APPROVAL', requestedByUserId: 'employee-user', candidateDeviceEnrollmentId: 'device-new', createdAt: '2026-10-26T15:52:00.000Z', candidateDevice: candidate, employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' } };
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockResolvedValue([{ employeeId: 'employee-1', employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' }, activeDevice: active, activeRequest: pendingRequest, history: [active, candidate], recentAudit: [] }] as never);
    vi.mocked(attendanceClient.attendanceDeviceSelfieBlob).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));
    const createObjectURL = vi.fn(() => 'blob:selfie'); const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(<AttendanceDevicePage token="test" role="ADMIN" />);
    // Owner issue 9: employee devices now open from the table's edit button.
    fireEvent.click(await screen.findByRole('button', { name: /^แก้ไขอุปกรณ์ของ/ }));
    expect(await screen.findByText(/มีรูปเซลฟี่ให้ตรวจ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งเป็นเครื่องหลัก' }));
    fireEvent.click(await screen.findByRole('button', { name: /ดูรูปเซลฟี่จากการลงเวลา/ }));
    const image = await screen.findByRole('img', { name: /รูปเซลฟี่จากการลงเวลาของ พนักงานตัวอย่าง/ });
    expect(image.getAttribute('src')).toBe('blob:selfie');
    expect(attendanceClient.attendanceDeviceSelfieBlob).toHaveBeenCalledWith('test', 'employee-1', 'device-new');
    expect(attendanceClient.promoteAttendanceDevice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'ไม่อนุมัติคำขอ' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:selfie'));
  });
});

describe('AttendanceDevicePage ADMIN rejects a device that has no request (owner 2026-10-28)', () => {
  it('shows ไม่อนุมัติ inside the detail dialog and rejects the device with the typed reason', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: null, activeRequest: null } } as never);
    vi.mocked(api.attendanceDeviceRequests).mockResolvedValue({ data: [] } as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    const stray = { id: 'device-stray', employeeId: 'employee-1', displayName: 'เครื่องลงเวลา', keyAlgorithm: 'ECDSA_P256_SHA256', status: 'PENDING_APPROVAL' as const, proofVerifiedAt: '2026-10-26T15:52:00.000Z' };
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockResolvedValue([{ employeeId: 'employee-1', employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' }, activeDevice: active, activeRequest: null, history: [active, stray], recentAudit: [] }] as never);
    vi.mocked(attendanceClient.rejectAttendanceDevice).mockResolvedValue({} as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));

    render(<AttendanceDevicePage token="test" role="ADMIN" />);
    fireEvent.click(await screen.findByRole('button', { name: /^แก้ไขอุปกรณ์ของ/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'ตั้งเป็นเครื่องหลัก' }));
    const reject = await screen.findByRole('button', { name: 'ไม่อนุมัติ' });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(screen.getByRole('dialog', { name: 'ตั้งเป็นเครื่องหลัก' })).getByRole('textbox'), { target: { value: 'ไม่ใช่เครื่องของพนักงาน' } });
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(attendanceClient.rejectAttendanceDevice).toHaveBeenCalledWith('test', 'employee-1', 'device-stray', 'ไม่ใช่เครื่องของพนักงาน'));
    expect(attendanceClient.promoteAttendanceDevice).not.toHaveBeenCalled();
  });
});

describe('AttendanceDevicePage opened from the Approval Center (owner issue 9)', () => {
  it('opens the employee pop-up with approve, reject and return for the pending request', async () => {
    vi.mocked(api.attendanceDeviceState).mockResolvedValue({ data: { employeeId: 'employee-1', activeDevice: null, activeRequest: null } } as never);
    const candidate = { id: 'device-new', employeeId: 'employee-1', displayName: 'อุปกรณ์ใหม่', keyAlgorithm: 'ECDSA_P256_SHA256', status: 'PENDING_APPROVAL' as const, proofVerifiedAt: '2026-10-26T15:52:00.000Z' };
    const pendingRequest = { id: 'request-new', employeeId: 'employee-1', requestType: 'REPLACEMENT', status: 'PENDING_APPROVAL', requestedByUserId: 'employee-user', candidateDeviceEnrollmentId: 'device-new', createdAt: '2026-10-26T15:52:00.000Z', candidateDevice: candidate, employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' } };
    vi.mocked(api.attendanceDeviceRequests).mockResolvedValue({ data: [pendingRequest] } as never);
    const attendanceClient = await import('../../pages/attendance/attendance-client');
    vi.mocked(attendanceClient.attendanceDeviceAdminOverview).mockResolvedValue([{ employeeId: 'employee-1', employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง' }, activeDevice: null, activeRequest: pendingRequest, history: [candidate], recentAudit: [] }] as never);
    const keyModule = await import('../../lib/attendance-device-key');
    vi.mocked(keyModule.listAttendanceDeviceKeyIds).mockResolvedValue(inventory([]));
    const handled = vi.fn();

    render(<AttendanceDevicePage token="test" role="ADMIN" initialRequestId="request-new" onInitialRequestHandled={handled} />);

    const dialog = await screen.findByRole('dialog', { name: 'อุปกรณ์ของ พนักงานตัวอย่าง' });
    expect(handled).toHaveBeenCalled();
    for (const name of ['อนุมัติ', 'ไม่อนุมัติ', 'ส่งกลับแก้ไข']) expect(within(dialog).getByRole('button', { name })).toBeTruthy();
  });
});
