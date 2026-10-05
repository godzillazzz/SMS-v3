// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), submit: vi.fn(), identity: vi.fn(), list: vi.fn(), remove: vi.fn(), count: vi.fn(), cached: vi.fn(), store: vi.fn() }));
vi.mock('./pages/attendance-simple/attendance-simple-client', () => ({ simpleAttendanceBootstrap: mocks.bootstrap, simpleAttendanceSubmit: mocks.submit, simpleAttendanceMoveRequest: vi.fn() }));
vi.mock('./pages/attendance-simple/attendance-simple-storage', async () => ({
  ...await vi.importActual<typeof import('./pages/attendance-simple/attendance-simple-storage')>('./pages/attendance-simple/attendance-simple-storage'),
  ensureDeviceIdentity: mocks.identity, deviceFingerprint: vi.fn().mockResolvedValue('isolated-fingerprint'), encryptedQueueCount: mocks.count,
  listEncryptedQueue: mocks.list, removeQueued: mocks.remove, readEncryptedBootstrap: mocks.cached, storeEncryptedBootstrap: mocks.store
}));
import { AttendanceSimplePage } from './pages/attendance-simple/AttendanceSimplePage';
const fixture = { employee: { id: 'isolated', displayName: 'Isolated fixture', employeeCode: 'TEST' }, eventIntent: 'CHECK_IN', assignment: { id: 'fixture-assignment', workDate: '2026-10-02', shift: { code: 'D', startTime: '07:00', endTime: '19:00' }, site: { id: 'fixture-site', code: 'TEST', name: 'Fixture site' } }, eligibleSites: [], activeDevice: null, offline: { expiresAt: new Date(Date.now() + 86400000).toISOString() } };
const queuedValue = { captureId: 'queued-1', capturedAt: '2026-10-02T00:15:00.000Z', eventIntent: 'CHECK_IN', offlineBundle: 'unchanged-isolated-bundle', device: { signatureBase64: 'unchanged-isolated-signature' } };
let queue: Array<{ captureId: string; value: typeof queuedValue }>;
const accepted = { counted: true, status: 'ACCEPTED', event: { eventType: 'CHECK_IN', punctuality: 'LATE' } };
describe('isolated offline reconnect acceptance on exact released component', () => {
  beforeEach(() => {
    vi.clearAllMocks(); queue = [];
    mocks.bootstrap.mockResolvedValue(fixture); mocks.cached.mockResolvedValue(fixture);
    mocks.identity.mockResolvedValue({ privateKey: {}, publicKeySpkiBase64: 'isolated-public-key', keyAlgorithm: 'ECDSA_P256_SHA256' });
    mocks.list.mockImplementation(async () => queue.slice()); mocks.count.mockImplementation(async () => queue.length);
    mocks.remove.mockImplementation(async id => { queue = queue.filter(row => row.captureId !== id); });
    mocks.submit.mockResolvedValue(accepted);
  });
  afterEach(cleanup);
  it('PWA offline-to-online state update automatically submits the original signed capture and drains it', async () => {
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }];
    const view = render(<AttendanceSimplePage token="isolated-session" online={false} />);
    await screen.findByText('ออฟไลน์พร้อมใช้งาน · ระบบจะเก็บรายการในเครื่องและส่งเมื่อออนไลน์');
    expect(mocks.submit).not.toHaveBeenCalled();
    view.rerender(<AttendanceSimplePage token="isolated-session" online />);
    await waitFor(() => expect(queue).toHaveLength(0));
    expect(mocks.submit).toHaveBeenCalledWith('isolated-session', queuedValue);
    expect(mocks.submit.mock.calls[0][1].capturedAt).toBe('2026-10-02T00:15:00.000Z');
    expect(mocks.submit.mock.calls[0][1].device.signatureBase64).toBe('unchanged-isolated-signature');
  });
  it('delayed queue response drains local item and displays pending ADMIN confirmation', async () => {
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }];
    mocks.submit.mockResolvedValue({ counted: false, status: 'PENDING_CONFIRMATION', pendingEvent: { id: 'isolated-pending' } });
    render(<AttendanceSimplePage token="isolated-session" online />);
    await screen.findByText(/รอ ADMIN ยืนยันก่อนนับ/);
    expect(queue).toHaveLength(0); expect(mocks.remove).toHaveBeenCalledWith(queuedValue.captureId);
  });
  it('failed first sync preserves queue/order; online event retries then drains in order', async () => {
    const second = { ...queuedValue, captureId: 'queued-2', eventIntent: 'CHECK_OUT' };
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }, { captureId: second.captureId, value: second }];
    mocks.submit.mockRejectedValueOnce(new Error('isolated network failure')).mockResolvedValue(accepted);
    render(<AttendanceSimplePage token="isolated-session" online />);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(queue).toHaveLength(2); expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(queue).toHaveLength(0));
    expect(mocks.submit.mock.calls.map(call => call[1].captureId)).toEqual(['queued-1', 'queued-1', 'queued-2']);
  });
  it('reload obtains CHECK_OUT next action from server bootstrap', async () => {
    mocks.bootstrap.mockResolvedValue({ ...fixture, eventIntent: 'CHECK_OUT' });
    const first = render(<AttendanceSimplePage token="isolated-session" online />);
    await screen.findByRole('button', { name: /ลงเวลาออก/ }); first.unmount();
    render(<AttendanceSimplePage token="isolated-session" online />);
    await screen.findByRole('button', { name: /ลงเวลาออก/ });
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('after queued CHECK_IN sync, next action immediately reflects authoritative server CHECK_OUT', async () => {
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }];
    let serverIntent = 'CHECK_IN';
    mocks.bootstrap.mockImplementation(async () => ({ ...fixture, eventIntent: serverIntent }));
    mocks.submit.mockImplementation(async () => { serverIntent = 'CHECK_OUT'; return accepted; });
    render(<AttendanceSimplePage token="isolated-session" online />);
    await waitFor(() => expect(queue).toHaveLength(0));
    await screen.findByRole('button', { name: /ลงเวลาออก/ });
  });
  it('keeps acknowledged capture durable and disables punching if server refresh fails, then retries idempotently', async () => {
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }];
    mocks.bootstrap.mockResolvedValueOnce(fixture).mockRejectedValueOnce(new Error('isolated refresh failure')).mockResolvedValue({ ...fixture, eventIntent: 'CHECK_OUT' });
    mocks.submit.mockResolvedValue({ ...accepted, idempotent: true });
    render(<AttendanceSimplePage token="isolated-session" online />);
    await screen.findByText(/ยังตรวจสถานะล่าสุดไม่สำเร็จ/);
    expect(queue).toHaveLength(1); expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /ลงเวลาเข้า/ }).hasAttribute('disabled')).toBe(true);
    fireEvent(window, new Event('online'));
    await screen.findByRole('button', { name: /ลงเวลาออก/ });
    await waitFor(() => expect(queue).toHaveLength(0));
    expect(mocks.submit.mock.calls.map(call => call[1])).toEqual([queuedValue, queuedValue]);
  });
  it('serializes overlapping reconnect signals while a capture is being submitted', async () => {
    queue = [{ captureId: queuedValue.captureId, value: queuedValue }];
    let complete!: (value: typeof accepted) => void;
    mocks.submit.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    render(<AttendanceSimplePage token="isolated-session" online />);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('online')); fireEvent(window, new Event('online'));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    complete(accepted);
    await waitFor(() => expect(queue).toHaveLength(0));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});
