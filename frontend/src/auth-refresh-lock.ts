export const AUTH_REFRESH_LOCK_NAME = 'smsv3-auth-refresh-v1';

let warnedAboutMissingLockManager = false;

export type AuthRefreshLockManager = {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>
  ): Promise<T>;
};

export function withAuthRefreshLock<T>(
  refresh: () => Promise<T>,
  lockManager: AuthRefreshLockManager | null | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks
): Promise<T> {
  if (!lockManager || typeof lockManager.request !== 'function') {
    if (!warnedAboutMissingLockManager) {
      warnedAboutMissingLockManager = true;
      console.warn('navigator.locks is unavailable; using same-tab auth refresh fallback.');
    }
    return refresh();
  }
  return lockManager.request(AUTH_REFRESH_LOCK_NAME, { mode: 'exclusive' }, refresh);
}
