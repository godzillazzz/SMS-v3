import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('G03.1 annual quota API client', () => {
  it('posts explicit Gregorian quotaYear with the annual entitlement payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, ok: true, headers: new Headers(), json: async () => ({ data: { id: 'quota-1' } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.createLeaveQuota('test-access-token', { employeeId: 'employee-1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 6 });
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/leave-quotas');
    expect(options.method).toBe('POST');
    expect(options.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(options.body)).toEqual({ employeeId: 'employee-1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 6 });
  });

  it('sends selected year and legacy filters explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers(), json: async () => ({ data: [] }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.leaveQuotas('token', 2, { year: 2027 });
    await api.leaveQuotas('token', 1, { legacy: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/leave-quotas?page=2&pageSize=100&year=2027');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/leave-quotas?page=1&pageSize=100&legacy=true');
  });

  it('links legacy quota using explicit employee and Gregorian year', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers(), json: async () => ({ data: {} }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.linkLeaveQuota('token', 'quota-1', 'employee-1', 2027);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ employeeId: 'employee-1', quotaYear: 2027 });
  });

  it('preserves safe 409 and request-id error behavior', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 409, ok: false, headers: new Headers({ 'x-request-id': 'req-g031-409' }), json: async () => ({ error: 'Employee already has a leave quota for this year.', details: { code: 'LEAVE_QUOTA_ALREADY_EXISTS', quotaYear: 2027 } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createLeaveQuota('token', { employeeId: 'employee-1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 6 })).rejects.toMatchObject({ status: 409, requestId: 'req-g031-409' });
  });
});
