// @vitest-environment jsdom
// ATLAS regression: foreign-device selfie guard, pending-transfer lock and camera modal controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  submit: vi.fn(),
  selfieProof: vi.fn(),
  moveRequest: vi.fn(),
  identity: vi.fn(),
  fingerprint: vi.fn(),
  count: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  cached: vi.fn(),
  store: vi.fn()
}));

vi.mock('./pages/attendance-simple/attendance-simple-client', () => ({
  simpleAttendanceBootstrap: mocks.bootstrap,
  simpleAttendanceSubmit: mocks.submit,
  simpleAttendanceSelfieProof: mocks.selfieProof,
  simpleAttendanceMoveRequest: mocks.moveRequest
}));

vi.mock('./pages/attendance-simple/attendance-simple-storage', async () => {
  const actual = await vi.importActual<typeof import('./pages/attendance-simple/attendance-simple-storage')>('./pages/attendance-simple/attendance-simple-storage');
  return {
    ...actual,
    ensureDeviceIdentity: mocks.identity,
    deviceFingerprint: mocks.fingerprint,
    encryptedQueueCount: mocks.count,
    listEncryptedQueue: mocks.list,
    removeQueued: mocks.remove,
    readEncryptedBootstrap: mocks.cached,
    storeEncryptedBootstrap: mocks.store
  };
});

import { AttendanceSimplePage } from './pages/attendance-simple/AttendanceSimplePage';

const site = { id: 'site-1', code: 'BV', name: 'BV#AN2', latitude: 13.7, longitude: 100.5, geofenceRadiusMeters: 150 };
const assignment = { id: 'assign-1', workDate: '2026-10-19', shift: { code: 'D', startTime: '07:00', endTime: '19:00' }, site };
const base = {
  employee: { id: 'emp-1', displayName: 'UAT Guard', employeeCode: 'UAT-1' },
  eventIntent: 'CHECK_IN',
  assignment,
  eligibleSites: [site],
  activeDevice: { id: 'dev-old', credentialFingerprint: 'device-A', displayName: 'เครื่องเดิม' },
  pendingDeviceRequest: null,
  offline: { bundle: 'bundle', issuedAt: '2026-10-19T00:00:00.000Z', expiresAt: '2026-10-20T00:00:00.000Z', confirmAfterMs: 300000, maxAccuracyMeters: 50 }
};

const pending = { id: 'req-1', status: 'PENDING_APPROVAL', requestedAt: '2026-10-19T01:00:00.000Z', candidateFingerprint: 'device-B' };

describe('foreign device selfie guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fingerprint.mockResolvedValue('device-B');
    mocks.identity.mockResolvedValue({ privateKey: {}, publicKeySpkiBase64: 'pk', keyAlgorithm: 'ECDSA_P256_SHA256' });
    mocks.count.mockResolvedValue(0);
    mocks.list.mockResolvedValue([]);
    mocks.cached.mockResolvedValue(null);
    mocks.store.mockResolvedValue(undefined);
    mocks.selfieProof.mockResolvedValue({ nonce: 'nonce-1', expiresAt: new Date(Date.now() + 120000).toISOString() });
    mocks.submit.mockResolvedValue({ counted: true, status: 'ACCEPTED', event: { eventType: 'CHECK_IN' } });
    mocks.bootstrap.mockResolvedValue({ ...base });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) }
    });
  });
  afterEach(cleanup);

  it('locks clock-in and never opens the camera while a transfer request is pending', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, pendingDeviceRequest: pending });
    render(<AttendanceSimplePage token="t" online />);
    const locked = await screen.findByRole('button', { name: /ลงเวลาเข้า/ });
    await waitFor(() => expect(document.body.textContent).toMatch(/รอ ADMIN อนุมัติการย้ายเครื่อง/));
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(locked);
    expect(screen.queryByRole('dialog', { name: 'ถ่ายภาพยืนยันตัวตน' })).toBeNull();
    expect(globalThis.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('opens the camera modal for a foreign device without a pending request and exposes icon controls', async () => {
    render(<AttendanceSimplePage token="t" online />);
    const action = await screen.findByRole('button', { name: /ลงเวลาเข้า/ });
    fireEvent.click(action);
    const dialog = await screen.findByRole('dialog', { name: 'ถ่ายภาพยืนยันตัวตน' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ถ่ายภาพยืนยันตัวตน' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ยกเลิกการถ่ายภาพ' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกการถ่ายภาพ' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ถ่ายภาพยืนยันตัวตน' })).toBeNull());
  });

  it('does not lock the button when the previous request was returned for correction', async () => {
    mocks.bootstrap.mockResolvedValue({ ...base, pendingDeviceRequest: null });
    render(<AttendanceSimplePage token="t" online />);
    const action = await screen.findByRole('button', { name: /ลงเวลาเข้า/ });
    expect((action as HTMLButtonElement).disabled).toBe(false);
  });
});
