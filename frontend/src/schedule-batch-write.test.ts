import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const jsonResponse = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(),
  json: async () => body
}) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('schedule batch writes', () => {
  it('sends 1000 assignments and 50 deletes in one atomic request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { count: 1050 } }));
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    const assignments = Array.from({ length: 1000 }, (_, index) => ({
      action: 'create' as const,
      draftKey: `assignment-${index}`,
      payload: {
        employeeId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        shiftTypeId: '00000000-0000-4000-8000-000000003000',
        workDate: '2026-08-01'
      }
    }));
    const deletes = Array.from({ length: 50 }, (_, index) => ({
      action: 'delete' as const,
      id: `00000000-0000-4000-8000-${String(index + 4000).padStart(12, '0')}`,
      draftKey: `delete-${index}`
    }));

    const result = await api.batchSaveShifts('test-token', [...assignments, ...deletes]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.assignments).toHaveLength(1000);
    expect(body.deletes).toHaveLength(50);
    expect(result.successCount).toBe(1050);
    expect(result.failureCount).toBe(0);
  });

  it('sends chunks sequentially and retains a failed chunk for explicit retry', async () => {
    let activeRequests = 0;
    let maximumConcurrentRequests = 0;
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      requestCount += 1;
      const status = requestCount === 1 ? 200 : 503;
      await Promise.resolve();
      activeRequests -= 1;
      return jsonResponse(status, status === 200 ? { data: { count: 1000 } } : { error: 'unavailable' });
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    const changes = Array.from({ length: 1001 }, (_, index) => ({
      action: 'create' as const,
      draftKey: `draft-${index}`,
      payload: {
        employeeId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        shiftTypeId: '00000000-0000-4000-8000-000000003000',
        workDate: '2026-08-01'
      }
    }));
    const progress: Array<{ total: number; completed: number; saved: number; failed: number }> = [];

    const result = await api.batchSaveShifts('test-token', changes, (value) => progress.push(value));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maximumConcurrentRequests).toBe(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).assignments).toHaveLength(1000);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).assignments).toHaveLength(1);
    expect(result.successCount).toBe(1000);
    expect(result.failureCount).toBe(1);
    expect(result.failedChanges[0].draftKey).toBe('draft-1000');
    expect(progress.at(-1)).toEqual({ total: 1001, completed: 1001, saved: 1000, failed: 1 });
  });
});
