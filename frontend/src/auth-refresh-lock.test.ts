import { describe, expect, it } from 'vitest';
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

  it('fails closed without browser lock support instead of racing refresh-token rotation', async () => {
    let refreshCalls = 0;
    await expect(withAuthRefreshLock(async () => { refreshCalls += 1; }, null)).rejects.toThrow(/cross-tab session refresh/);
    expect(refreshCalls).toBe(0);
  });
});
