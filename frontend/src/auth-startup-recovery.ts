export type RefreshFailure = { status?: number; name?: string };

export function refreshFailureStatus(reason: unknown): number | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  const status = (reason as RefreshFailure).status;
  return typeof status === 'number' ? status : undefined;
}

export function isRefreshUnauthenticated(reason: unknown): boolean {
  const status = refreshFailureStatus(reason);
  return status === 401 || status === 403;
}

export function isRefreshTransientFailure(reason: unknown): boolean {
  const status = refreshFailureStatus(reason);
  return status === undefined || status >= 500;
}

export type RefreshWithRetryOptions = {
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Retries only transient startup refresh failures. Authentication failures are
 * returned immediately so the caller can show the login flow without hiding a
 * real authorization decision behind a retry screen.
 */
export async function refreshWithRetry<T>(
  refresh: () => Promise<T>,
  { maxRetries = 3, sleep = defaultSleep }: RefreshWithRetryOptions = {}
): Promise<T> {
  let retry = 0;
  while (true) {
    try {
      return await refresh();
    } catch (reason) {
      if (!isRefreshTransientFailure(reason) || retry >= maxRetries) throw reason;
      await sleep(1000 * (2 ** retry));
      retry += 1;
    }
  }
}
