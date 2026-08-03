import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api } from './api';
import { sanitizeLicenseDocumentError } from './components/license-document-utils';

const success = () => ({ status: 200, ok: true, json: async () => ({ accessToken: 'test-access-token', user: {} }) });
afterEach(() => vi.unstubAllGlobals());

describe('API client', () => {
  it('exposes the browser authentication operations', () => {
    expect(typeof api.login).toBe('function'); expect(typeof api.refresh).toBe('function'); expect(typeof api.logout).toBe('function'); expect(typeof api.logoutAll).toBe('function');
    expect(typeof api.registrationEmployees).toBe('function'); expect(typeof api.requestRegistrationOtp).toBe('function'); expect(typeof api.verifyRegistrationOtp).toBe('function'); expect(typeof api.requestPasswordResetOtp).toBe('function'); expect(typeof api.completePasswordReset).toBe('function');
  });
  it('loads only backend-approved employees for registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.registrationEmployees();
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/auth/register/available-employees');
    expect(options.credentials).toBe('include');
  });
  it('sends the readable CSRF cookie in browser refresh, logout, and logout-all requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('document', { cookie: 'smsv3_csrf=test-csrf-value' });
    vi.stubGlobal('fetch', fetchMock);
    await api.refresh(); await api.logout(); await api.logoutAll('test-access-token');
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe('include');
      expect(options.headers.get('x-csrf-token')).toBe('test-csrf-value');
    }
  });
  it('sends the CSRF header for startup refresh from /dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('document', { cookie: 'smsv3_csrf=test-csrf-value' });
    vi.stubGlobal('location', { pathname: '/dashboard' });
    vi.stubGlobal('fetch', fetchMock);
    await api.refresh();
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/auth/refresh');
    expect(options.headers.get('x-csrf-token')).toBe('test-csrf-value');
  });
  it('requests the complete employee directory within the API page-size limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: [], meta: { total: 0 } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.employees('test-access-token');
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/employees?page=1&pageSize=100');
    expect(options.credentials).toBe('include');
    expect(options.headers.get('authorization')).toBe('Bearer test-access-token');
  });
  it('exposes every migrated operational data endpoint', () => {
    for (const operation of ['dashboard', 'licenses', 'shiftTypes', 'shifts', 'scheduleCalendar', 'scheduleApprovals', 'schedulingRules', 'ruleChecks', 'systemSettings', 'leaveRequests', 'leaveSummary', 'leaveQuotas', 'users', 'auditEvents', 'reportSummary'] as const) {
      expect(typeof api[operation]).toBe('function');
    }
  });
  it('sends the selected leave history month with the paginated request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: [], meta: { total: 0 } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.leaveRequests('test-access-token', 1, { year: 2026, month: 8 });
    const [path] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/leave-requests?page=1&pageSize=100&year=2026&month=8');
  });
  it('preserves known approval errors and request IDs without exposing response internals', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 409, ok: false, json: async () => ({ error: 'สถานะเอกสารมีการเปลี่ยนแปลง กรุณารีเฟรชและลองใหม่', requestId: 'req-approval-409' }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.approveLicenseDocument('test-access-token', 'document-id')).rejects.toMatchObject({ name: 'ApiRequestError', status: 409, requestId: 'req-approval-409', message: 'สถานะเอกสารมีการเปลี่ยนแปลง กรุณารีเฟรชและลองใหม่' });
  });
  it('uses dedicated correction and resubmission endpoints without leaking storage fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: {} }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.returnLicenseDocumentForCorrection('test-access-token', 'document-id', 'แก้ไขวันที่');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/license-documents/document-id/return-for-correction');
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ correctionReason: 'แก้ไขวันที่' });
    await api.resubmitLicenseDocument('test-access-token', 'document-id', { licenseNumber: 'LN-1', proposedStartDate: '2026-01-01', proposedExpiryDate: '2026-12-31' });
    const [path, options] = fetchMock.mock.calls[1];
    expect(path).toBe('/api/v1/license-documents/document-id/resubmit');
    expect(options.headers.Authorization).toBe('Bearer test-access-token');
    expect(options.body.get('licenseNumber')).toBe('LN-1');
    expect(options.body.get('proposedStartDate')).toBe('2026-01-01');
    expect(options.body.get('document')).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('storageObjectKey');
  });
  it('uses the admin-only permanent delete endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: { deleted: true } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.permanentlyDeleteLicenseDocument('test-access-token', 'document-id');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/license-documents/document-id/permanent');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-access-token');
  });
  it('adds a safe reference ID only to sanitized server errors', () => {
    expect(sanitizeLicenseDocumentError(new ApiRequestError('Database unavailable.', 503, 'req-db-503'))).toBe('ระบบไม่สามารถดำเนินการเอกสารได้ชั่วคราว กรุณาลองใหม่อีกครั้ง (รหัสอ้างอิง: req-db-503)');
    expect(sanitizeLicenseDocumentError(new ApiRequestError('คุณไม่มีสิทธิ์อนุมัติเอกสารนี้', 403, 'req-auth-403'))).toBe('คุณไม่มีสิทธิ์อนุมัติเอกสารนี้');
  });
  it('exposes the protected operational mutation methods', () => {
    for (const operation of [
      'createEmployee', 'updateEmployee', 'deleteEmployee',
      'createLicense', 'updateLicense', 'deleteLicense',
      'createShiftType', 'deleteShiftType',
      'createShift', 'updateShift', 'deleteShift',
      'previewAutoSchedule', 'commitAutoSchedule', 'previewEmployeeAutoSchedule', 'commitEmployeeAutoSchedule', 'exportScheduleExcel',
      'updateScheduleApproval', 'updateSchedulingRule', 'updateSystemSetting',
      'createLeaveRequest', 'createLeaveRequestWithAttachment', 'downloadLeaveAttachment', 'updateLeaveRequest', 'cancelLeaveRequest', 'updateLeaveQuota',
      'updateUser', 'resetUserPassword', 'viewAsUser'
    ] as const) {
      expect(typeof api[operation]).toBe('function');
    }
  });
});
