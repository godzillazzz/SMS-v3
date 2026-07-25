import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const success = () => ({ status: 200, ok: true, json: async () => ({ accessToken: 'test-access-token', user: {} }) });
afterEach(() => vi.unstubAllGlobals());

describe('API client', () => {
  it('exposes the browser authentication operations', () => {
    expect(typeof api.login).toBe('function'); expect(typeof api.refresh).toBe('function'); expect(typeof api.logout).toBe('function'); expect(typeof api.logoutAll).toBe('function');
    expect(typeof api.requestRegistrationOtp).toBe('function'); expect(typeof api.verifyRegistrationOtp).toBe('function'); expect(typeof api.requestPasswordResetOtp).toBe('function'); expect(typeof api.completePasswordReset).toBe('function');
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
  it('exposes the protected operational mutation methods', () => {
    for (const operation of [
      'createEmployee', 'updateEmployee', 'deleteEmployee',
      'createLicense', 'updateLicense', 'deleteLicense',
      'createShiftType', 'deleteShiftType',
      'createShift', 'updateShift', 'deleteShift',
      'previewAutoSchedule', 'commitAutoSchedule', 'previewEmployeeAutoSchedule', 'commitEmployeeAutoSchedule', 'exportScheduleExcel',
      'updateScheduleApproval', 'updateSchedulingRule', 'updateSystemSetting',
      'createLeaveRequest', 'createLeaveRequestWithAttachment', 'downloadLeaveAttachment', 'updateLeaveRequest', 'updateLeaveQuota',
      'updateUser', 'resetUserPassword', 'viewAsUser'
    ] as const) {
      expect(typeof api[operation]).toBe('function');
    }
  });
});
