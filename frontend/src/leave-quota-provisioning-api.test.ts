import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('Leave quota provisioning API client', () => {
  it('posts only the approved provisioning payload with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, ok: true, headers: new Headers(), json: async () => ({ data: { id: 'quota-1' } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.createLeaveQuota('test-access-token', { employeeId: 'employee-1', sickLeave: 30, personalLeave: 6, vacationLeave: 10 });
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/leave-quotas');
    expect(options.method).toBe('POST');
    expect(options.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(options.body)).toEqual({ employeeId: 'employee-1', sickLeave: 30, personalLeave: 6, vacationLeave: 10 });
  });

  it('preserves the shared safe 409 error and Request ID contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 409, ok: false, headers: new Headers({ 'x-request-id': 'req-g03-409' }), json: async () => ({ error: 'Employee already has a leave quota.', requestId: 'body-id', details: { code: 'LEAVE_QUOTA_ALREADY_EXISTS' } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createLeaveQuota('test-access-token', { employeeId: 'employee-1', sickLeave: 30, personalLeave: 6, vacationLeave: 10 })).rejects.toMatchObject({ name: 'ApiRequestError', status: 409, requestId: 'req-g03-409', message: 'Employee already has a leave quota.' });
  });
});
