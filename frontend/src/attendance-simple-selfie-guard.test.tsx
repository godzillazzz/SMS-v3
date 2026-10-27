// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), submit: vi.fn(), identity: vi.fn(), fingerprint: vi.fn(), count: vi.fn(), list: vi.fn(), cached: vi.fn(), store: vi.fn(), sign: vi.fn(), hash: vi.fn(), move: vi.fn() }));
vi.mock('./pages/attendance-simple/attendance-simple-client', async () => ({
  ...(await vi.importActual<typeof import('./pages/attendance-simple/attendance-simple-client')>('./pages/attendance-simple/attendance-simple-client')),
  simpleAttendanceBootstrap: mocks.bootstrap, simpleAttendanceSubmit: mocks.submit,
  simpleAttendanceSelfieProof: vi.fn(), simpleAttendanceMoveRequest: mocks.move
}));
vi.mock('./pages/attendance-simple/attendance-simple-storage', async () => ({
  ...(await vi.importActual<typeof import('./pages/attendance-simple/attendance-simple-storage')>('./pages/attendance-simple/attendance-simple-storage')),
  ensureDeviceIdentity: mocks.identity, deviceFingerprint: mocks.fingerprint,
  encryptedQueueCount: mocks.count, listEncryptedQueue: mocks.list, readEncryptedBootstrap: mocks.cached,
  storeEncryptedBootstrap: mocks.store, signPayload: mocks.sign, sha256Hex: mocks.hash
}));
import { AttendanceSimplePage, attendanceErrorMessage, attendanceFailure, isDisplayableAttendanceCode } from './pages/attendance-simple/AttendanceSimplePage';

const site = { id: 'site-1', code: 'BV', name: 'BV#AN2', latitude: 13.7, longitude: 100.5, geofenceRadiusMeters: 150 };
const base = { employee: { id: 'emp-1', displayName: 'UAT Guard', employeeCode: 'UAT-1' }, eventIntent: 'CHECK_IN' as const, assignment: { id: 'assign-1', workDate: '2026-10-19', shift: { code: 'D', startTime: '07:00', endTime: '19:00' }, site }, eligibleSites: [site], activeDevice: { id: 'dev-old', credentialFingerprint: 'device-A', displayName: 'เครื่องเดิม' }, pendingDeviceRequest: null, selfiePolicy: { sourceRole: 'VIEWER' as const, action: 'CHECK_IN' as const, required: false, policy: { role: 'VIEWER', clockInRequired: false, clockOutRequired: false } }, offline: { bundle: 'bundle', issuedAt: '2026-10-19T00:00:00.000Z', expiresAt: '2026-10-20T00:00:00.000Z', confirmAfterMs: 300000, maxAccuracyMeters: 50 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fingerprint.mockResolvedValue('device-B');
  mocks.identity.mockResolvedValue({ privateKey: {}, publicKeySpkiBase64: 'pk', keyAlgorithm: 'ECDSA_P256_SHA256' });
  mocks.count.mockResolvedValue(0); mocks.list.mockResolvedValue([]); mocks.cached.mockResolvedValue(null); mocks.store.mockResolvedValue(undefined);
  mocks.sign.mockResolvedValue('signature'); mocks.hash.mockResolvedValue('hash');
  mocks.bootstrap.mockResolvedValue(base); mocks.submit.mockResolvedValue({ counted: true, status: 'ACCEPTED', event: { eventType: 'CHECK_IN' } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: site.latitude, longitude: site.longitude, accuracy: 8 }, timestamp: Date.now() }) } });
});
afterEach(cleanup);

describe('actionable attendance error mapping', () => {
  it('maps unknown/provider storage failure to a safe public message', () => { const m = attendanceErrorMessage('ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE', 'fallback'); expect(m).toContain('ขัดข้องชั่วคราว'); expect(m).not.toContain('provider'); });
  it('keeps storage configuration failures safe', () => { const m = attendanceErrorMessage('ATTENDANCE_SELFIE_PATH_SECRET_WEAK', 'fallback'); expect(m).toContain('ยังไม่พร้อมใช้งาน'); expect(m).not.toContain('secret'); });
  it('explains missing check-in and expired selfie codes', () => { expect(attendanceErrorMessage('ATTENDANCE_CHECK_IN_REQUIRED', 'fallback')).toBe('ต้องลงเวลาเข้าก่อนจึงจะลงเวลาออกได้'); expect(attendanceErrorMessage('ATTENDANCE_SELFIE_NONCE_EXPIRED', 'fallback')).toBe('ภาพยืนยันหมดอายุ กรุณาถ่ายใหม่'); });
  it('keeps unknown details safe and includes the fallback', () => { expect(attendanceErrorMessage('UNEXPECTED_CODE', 'fallback')).toBe('fallback'); });
  it('extracts safe code and request id from nested HTTP error shapes', () => { expect(attendanceFailure({ response: { data: { error: { code: 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE', requestId: 'req-foreign-1' } } } }, 'fallback')).toMatchObject({ code: 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE', requestId: 'req-foreign-1' }); });
  it('shows unmapped server codes and status diagnostics as a reference', () => { expect(attendanceFailure({ code: 'ATTENDANCE_CONTEXT_STALE', requestId: 'req-ctx-1' }, 'fallback')).toEqual({ message: 'fallback', code: 'ATTENDANCE_CONTEXT_STALE', requestId: 'req-ctx-1' }); expect(attendanceFailure({ code: 'HTTP_500' }, 'fallback')).toMatchObject({ code: 'HTTP_500' }); expect(isDisplayableAttendanceCode('ATTENDANCE_REQUEST_INVALID')).toBe(true); expect(isDisplayableAttendanceCode('attendance_lower')).toBe(false); expect(isDisplayableAttendanceCode('HTTP_200')).toBe(false); expect(isDisplayableAttendanceCode('ATTENDANCE_' + 'X'.repeat(81))).toBe(false); });
  it('omits unsafe nested request ids and codes', () => { const f = attendanceFailure({ error: { code: '<script>secret</script>', requestId: `safe\u0000${'x'.repeat(250)}` } }, 'fallback'); expect(f).toEqual({ message: 'fallback' }); });
  it('retains valid diagnostics while rejecting overlong request ids', () => { expect(attendanceFailure({ code: 'ATTENDANCE_CHECK_IN_REQUIRED', requestId: 'req-valid-1' }, 'fallback')).toMatchObject({ code: 'ATTENDANCE_CHECK_IN_REQUIRED', requestId: 'req-valid-1' }); expect(attendanceFailure({ code: 'ATTENDANCE_CHECK_IN_REQUIRED', requestId: 'r'.repeat(201) }, 'fallback')).not.toHaveProperty('requestId'); });
});

describe('primary device move from the PWA', () => {
  // The foreign-device card is part of the installed-app (PWA) layout.
  beforeEach(() => { window.history.replaceState({}, '', '/?pwa=1'); });
  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('offers an explicit request on a foreign device without blocking clock-in', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, activeDevice: { id: 'device-a', credentialFingerprint: 'device-A' }, pendingDeviceRequest: null });
    mocks.move.mockResolvedValue({ id: 'request-1', status: 'PENDING_APPROVAL' });
    render(<AttendanceSimplePage token="t" online />);
    const button = await screen.findByRole('button', { name: 'ขอใช้เครื่องนี้เป็นเครื่องหลัก' });
    expect(document.querySelector<HTMLButtonElement>('.attendance-simple__clock')!.disabled).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
    expect(mocks.move.mock.calls[0][1]).toMatchObject({ publicKeySpkiBase64: 'pk', keyAlgorithm: 'ECDSA_P256_SHA256', signatureBase64: 'signature' });
    expect(mocks.sign.mock.calls.at(-1)?.[1]).toMatchObject({ version: 'SMS_ATTENDANCE_DEVICE_MOVE_V1', reason: 'ยืนยันด้วย selfie สดจากเครื่องใหม่' });
  });

  it('shows the pending state instead of the button once a request exists for this device', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, activeDevice: { id: 'device-a', credentialFingerprint: 'device-A' }, pendingDeviceRequest: { id: 'r1', status: 'PENDING_APPROVAL', requestedAt: '2026-10-26T00:00:00Z', candidateFingerprint: 'device-B' } });
    render(<AttendanceSimplePage token="t" online />);
    await screen.findByText(/ส่งคำขอใช้เครื่องนี้เป็นเครื่องหลักแล้ว/);
    expect(screen.queryByRole('button', { name: 'ขอใช้เครื่องนี้เป็นเครื่องหลัก' })).toBeNull();
  });
});

describe('device-independent selfie policy', () => {
  it('does not block Clock-in or create a device-change request for telemetry from another device', async () => {
    render(<AttendanceSimplePage token="t" online />);
    await screen.findByText('พร้อมลงเวลา · ระบบจะตรวจตำแหน่งก่อนบันทึก');
    const clock = document.querySelector<HTMLButtonElement>('.attendance-simple__clock')!;
    expect(clock.disabled).toBe(false);    fireEvent.click(clock);
    expect(document.body.textContent).not.toMatch(/PRIMARY|FOREIGN|ย้ายเครื่อง|รอ ADMIN อนุมัติ/);
  });
  it('OFF policy has no camera/storage dependency', async () => {
    render(<AttendanceSimplePage token="t" online />);
    await screen.findByText('พร้อมลงเวลา · ระบบจะตรวจตำแหน่งก่อนบันทึก');
    fireEvent.click(document.querySelector<HTMLButtonElement>('.attendance-simple__clock')!);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'ถ่ายภาพยืนยันตัวตน' })).toBeNull();
  });
  it('keeps both explicit action controls available while marking the server suggestion', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, eventIntent: 'CHECK_OUT', selfiePolicy: { ...base.selfiePolicy, action: 'CHECK_OUT' } });
    render(<AttendanceSimplePage token="t" online />);
    await screen.findByText('ลงเวลาออก');
    expect((screen.getByRole('button', { name: 'ลงเวลาเข้า' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'ลงเวลาออก' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'ลงเวลาออก' }) as HTMLButtonElement).getAttribute('title')).toContain('แนะนำ');
    expect(document.querySelector<HTMLButtonElement>('.attendance-simple__clock')?.textContent).toContain('ลงเวลาออก');
  });

  it('submits the explicitly selected action instead of the server suggestion', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, eventIntent: 'CHECK_OUT', selfiePolicy: { ...base.selfiePolicy, action: 'CHECK_OUT' } });
    render(<AttendanceSimplePage token="t" online />);
    await screen.findByRole('button', { name: 'ลงเวลาเข้า' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('.attendance-simple__action-choice button')!);
    expect(document.querySelector<HTMLButtonElement>('.attendance-simple__clock')?.textContent).toContain('ลงเวลาเข้า');
    fireEvent.click(document.querySelector<HTMLButtonElement>('.attendance-simple__clock')!);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls.at(-1)?.[1]).toMatchObject({ eventIntent: 'CHECK_IN' });
  });
});
