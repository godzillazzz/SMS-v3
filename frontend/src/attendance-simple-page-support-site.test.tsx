// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(), submit: vi.fn(), move: vi.fn(),
  fingerprint: vi.fn(), riskSignals: vi.fn(), queueCount: vi.fn(), enqueue: vi.fn(),
  ensureIdentity: vi.fn(), listQueue: vi.fn(), readBootstrap: vi.fn(), removeQueued: vi.fn(),
  signPayload: vi.fn(), storeBootstrap: vi.fn(), sha256: vi.fn()
}));

vi.mock('./pages/attendance-simple/attendance-simple-client', () => ({
  simpleAttendanceBootstrap: mocks.bootstrap,
  simpleAttendanceSubmit: mocks.submit,
  simpleAttendanceMoveRequest: mocks.move
}));

vi.mock('./pages/attendance-simple/attendance-simple-storage', async () => {
  const actual = await vi.importActual<typeof import('./pages/attendance-simple/attendance-simple-storage')>('./pages/attendance-simple/attendance-simple-storage');
  return {
    ...actual,
    deviceFingerprint: mocks.fingerprint,
    deviceRiskSignals: mocks.riskSignals,
    encryptedQueueCount: mocks.queueCount,
    enqueueEncrypted: mocks.enqueue,
    ensureDeviceIdentity: mocks.ensureIdentity,
    listEncryptedQueue: mocks.listQueue,
    readEncryptedBootstrap: mocks.readBootstrap,
    removeQueued: mocks.removeQueued,
    signPayload: mocks.signPayload,
    storeEncryptedBootstrap: mocks.storeBootstrap,
    sha256Hex: mocks.sha256
  };
});

import { AttendanceSimplePage } from './pages/attendance-simple/AttendanceSimplePage';

const siteA = { id: 'site-a', code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100 };
const siteB = { id: 'site-b', code: 'B', name: 'Site B', latitude: 13.7251, longitude: 100.5701, geofenceRadiusMeters: 120 };
const bootstrap = {
  employee: { id: 'employee-a', employeeCode: 'EMP-1', displayName: 'Employee Test', department: 'Security' },
  eventIntent: 'CHECK_IN' as const,
  assignment: { id: 'assignment-a', workDate: '2026-10-02', shift: { code: 'D', name: 'Day', startTime: '07:00', endTime: '19:00' }, site: siteA },
  eligibleSites: [siteA, siteB], activeDevice: null,
  offline: { bundle: 'signed-test-bundle-string-over-32-characters', issuedAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-10-03T00:00:00.000Z', confirmAfterMs: 300000, maxAccuracyMeters: 50 }
};

describe('Attendance support-Site confirmation UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bootstrap.mockResolvedValue(bootstrap);
    mocks.submit.mockResolvedValue({
      counted: true, status: 'ACCEPTED', deviceBinding: 'PRIMARY', reviewRequired: false,
      event: { id: 'event-a', eventType: 'CHECK_IN', locationEvidence: {
        expectedSiteId: siteA.id, actualSiteId: siteB.id,
        assignedSite: { id: siteA.id, code: siteA.code, name: siteA.name },
        actualSite: { id: siteB.id, code: siteB.code, name: siteB.name }, workSiteContext: 'SUPPORT_SITE'
      } }
    });
    mocks.ensureIdentity.mockResolvedValue({ publicKeySpkiBase64: 'public-key', keyAlgorithm: 'ECDSA_P256_SHA256', privateKey: {} });
    mocks.fingerprint.mockResolvedValue('device-fingerprint');
    mocks.riskSignals.mockReturnValue({ secureContext: true, serviceWorkerControlled: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true });
    mocks.queueCount.mockResolvedValue(0);
    mocks.listQueue.mockResolvedValue([]);
    mocks.signPayload.mockResolvedValue('signature');
    mocks.sha256.mockResolvedValue('bundle-hash');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: (position: unknown) => void) => success({
        coords: { latitude: siteB.latitude, longitude: siteB.longitude, accuracy: 8 }, timestamp: Date.now()
      })
    } });
  });

  afterEach(() => cleanup());

  it('shows assigned and actual Site before a separate support-Site confirmation, then submits GPS only', async () => {
    render(<AttendanceSimplePage token="test-session" online />);
    await screen.findByText('พร้อมลงเวลา · GPS/GEOFENCE บังคับ');
    fireEvent.click(screen.getByRole('button', { name: /ลงเวลาเข้า/ }));
    await screen.findByText(/ระบบจะบันทึกเป็น “ช่วยปฏิบัติงาน” · กดอีกครั้งเพื่อยืนยัน/);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText('สถานที่ตามตาราง: Site A')).toBeTruthy();
    expect(screen.getByText('สถานที่ลงเวลาจริง: Site B · ช่วยปฏิบัติงาน')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /ยืนยันช่วยปฏิบัติงานที่ Site B/ }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const submitted = mocks.submit.mock.calls[0][1];
    expect(submitted.location.latitude).toBe(siteB.latitude);
    expect('actualSiteId' in submitted).toBe(false);
    await screen.findByText(/ลงเวลาสำเร็จ · ช่วยปฏิบัติงานที่ Site B/);
  });

  it('keeps support-Site and foreign-device review flags independent in the accepted message', async () => {
    mocks.submit.mockResolvedValue({
      counted: true, status: 'ACCEPTED_REVIEW_FLAGGED', deviceBinding: 'FOREIGN', reviewRequired: true,
      reviewReasons: ['ASSIST_OTHER_SITE', 'DEVICE_MISMATCH'],
      event: { id: 'event-b', eventType: 'CHECK_IN', locationEvidence: {
        expectedSiteId: siteA.id, actualSiteId: siteB.id,
        assignedSite: { id: siteA.id, code: siteA.code, name: siteA.name },
        actualSite: { id: siteB.id, code: siteB.code, name: siteB.name }, workSiteContext: 'SUPPORT_SITE'
      } }
    });
    render(<AttendanceSimplePage token="test-session" online />);
    await screen.findByText('พร้อมลงเวลา · GPS/GEOFENCE บังคับ');
    fireEvent.click(screen.getByRole('button', { name: /ลงเวลาเข้า/ }));
    await screen.findByText(/กดอีกครั้งเพื่อยืนยัน/);
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันช่วยปฏิบัติงานที่ Site B/ }));
    const message = await screen.findByText(/ลงเวลาสำเร็จ/);
    expect(message.textContent).toContain('ช่วยปฏิบัติงานที่ Site B');
    expect(message.textContent).toContain('ใช้อุปกรณ์อื่นจากเครื่องหลัก');
    expect(message.textContent).not.toContain('เครื่องนี้ไม่ใช่เครื่องหลัก จึงติดธง');
  });
});
