import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api';
import { isRefreshTransientFailure, isRefreshUnauthenticated, refreshWithRetry } from './auth-startup-recovery';

describe('startup refresh recovery', () => {
  it('retries a 503 with 1s, 2s and 4s backoff before succeeding', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError('Database unavailable.', 503))
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockRejectedValueOnce(new ApiRequestError('Database unavailable.', 504))
      .mockResolvedValue({ accessToken: 'access-token' });
    const waits: number[] = [];

    await expect(refreshWithRetry(refresh, { sleep: async (milliseconds) => { waits.push(milliseconds); } }))
      .resolves.toEqual({ accessToken: 'access-token' });

    expect(refresh).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('stops after three transient retries and never changes the auth decision to login', async () => {
    const refresh = vi.fn().mockRejectedValue(new ApiRequestError('Database unavailable.', 503));
    await expect(refreshWithRetry(refresh, { sleep: async () => undefined })).rejects.toMatchObject({ status: 503 });
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('does not retry 401 or 403 authorization failures', async () => {
    for (const status of [401, 403]) {
      const refresh = vi.fn().mockRejectedValue(new ApiRequestError('Session expired.', status));
      await expect(refreshWithRetry(refresh, { sleep: async () => { throw new Error('should not sleep'); } })).rejects.toMatchObject({ status });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(isRefreshUnauthenticated(new ApiRequestError('denied', status))).toBe(true);
    }
  });

  it('classifies network and timeout failures as transient', () => {
    expect(isRefreshTransientFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRefreshTransientFailure(Object.assign(new Error('timeout'), { name: 'AbortError' }))).toBe(true);
    expect(isRefreshTransientFailure(new ApiRequestError('bad request', 400))).toBe(false);
  });
});
