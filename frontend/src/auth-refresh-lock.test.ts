import { describe, expect, it, vi } from 'vitest';
import { AUTH_REFRESH_LOCK_NAME, withAuthRefreshLock, type AuthRefreshLockManager } from './auth-refresh-lock';

function createSerialLockManager(): AuthRefreshLockManager {
  let tail = Promise.resolve();
  return {
    async request<T>(name, options, callback) {
      expect(name).toBe(AUTH_REFRESH_LOCK_NAME);
      expect(options).toEqual({ mode: 'exclusive' });
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    }
  };
}

describe('cross-tab auth refresh coordination', () => {
  it('serializes refresh requests across independent callers', async () => {
    const locks = createSerialLockManager();
    let active = 0;
    let maxActive = 0;
    const refresh = async (value: string) => withAuthRefreshLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    }, locks);

    await expect(Promise.all([refresh('first'), refresh('second')])).resolves.toEqual(['first', 'second']);
    expect(maxActive).toBe(1);
  });

  it('falls back to same-tab refresh when browser lock support is unavailable and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refresh = vi.fn(async () => 'refreshed');
    const invalidLockManager = { request: null } as unknown as AuthRefreshLockManager;

    try {
      await expect(withAuthRefreshLock(refresh, null)).resolves.toBe('refreshed');
      await expect(withAuthRefreshLock(refresh, invalidLockManager)).resolves.toBe('refreshed');
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
