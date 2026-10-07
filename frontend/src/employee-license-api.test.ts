import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmployeeLicenses } from './employee-license-api';

afterEach(() => vi.unstubAllGlobals());

describe('employee-scoped license read', () => {
  it('uses the existing role-protected license list with an exact employee filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [], meta: { total: 0, totalPages: 0 } }) });
    vi.stubGlobal('fetch', fetchMock);
    await getEmployeeLicenses('fixture-token', 'employee-123');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/licenses?page=1&pageSize=1000&employeeStatus=ALL&employeeId=employee-123');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token');
  });

  it('does not turn an unavailable license authority into an empty list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers(), json: async () => ({ error: 'Forbidden' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getEmployeeLicenses('fixture-token', 'employee-123')).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
  });
});
