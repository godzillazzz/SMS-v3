import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmployeeLeaveQuota } from './leave-request-quota-api';

afterEach(() => vi.unstubAllGlobals());

describe('employee leave quota query', () => {
  it('uses the existing authorized read endpoint with an exact year and employee filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await getEmployeeLeaveQuota('fixture-token', 2026, 'employee-123');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/leave-quotas?page=1&pageSize=100&year=2026&employeeId=employee-123');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token');
  });

  it('preserves safe API errors and request identifiers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers({ 'x-request-id': 'fixture-invalid-id' }), json: async () => ({ error: 'Invalid employee filter.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getEmployeeLeaveQuota('fixture-token', 2026, 'bad-id')).rejects.toMatchObject({ status: 400, requestId: 'fixture-invalid-id', message: 'Invalid employee filter.' });
  });
});
