/**
 * Client-side resilience for unstable mobile networks and platform bot-protection.
 *
 * Guards operate on their own mobile data, so a request can fail while the phone changes cell or
 * while the platform serves a security challenge. This module retries only what is safe:
 *
 * - idempotent methods (GET/HEAD/OPTIONS): network errors, 429, 502/503/504
 * - any method: a platform challenge (403 with `x-vercel-mitigated`), because the request never
 *   reached the application, so resending cannot duplicate a write
 *
 * Non-idempotent requests are never retried after an ambiguous 5xx or a network error: the write may
 * already have been applied.
 */

export type ResilienceOptions = {
  /** Total requests allowed, including the first one: attempts=3 means 1 request + 2 retries. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
  isIdempotent?: boolean;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY = 400;
const DEFAULT_MAX_DELAY = 3_000;
// Never retry early; give up instead when the server asks for more than 30 seconds.
const MAX_WAIT_BEFORE_GIVING_UP_MS = 30_000;
const RETRY_AFTER_TOO_LONG = 'retry-after-too-long' as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isPlatformChallenge(response: Response): boolean {
  if (response.status !== 403) return false;
  const mitigated = response.headers?.get?.('x-vercel-mitigated');
  return Boolean(mitigated && /challenge/i.test(mitigated));
}

export function isIdempotentMethod(method: string | undefined): boolean {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

function retryAfterMs(response: Response): number | typeof RETRY_AFTER_TOO_LONG | undefined {
  const header = response.headers?.get?.('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const delayMs = seconds * 1000;
    return delayMs <= MAX_WAIT_BEFORE_GIVING_UP_MS ? delayMs : RETRY_AFTER_TOO_LONG;
  }
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return undefined;
  const delayMs = date - Date.now();
  if (delayMs < 0) return undefined;
  return delayMs <= MAX_WAIT_BEFORE_GIVING_UP_MS ? delayMs : RETRY_AFTER_TOO_LONG;
}

function backoffDelay(attempt: number, base: number, max: number, random: () => number) {
  const exponential = Math.min(base * 2 ** attempt, max);
  return Math.round(exponential + random() * 150);
}

async function shouldRetry(
  response: Response,
  attempt: number,
  attempts: number,
  idempotent: boolean
): Promise<{ retry: boolean; delayMs?: number }> {
  if (attempt >= attempts - 1) return { retry: false };
  const challenge = isPlatformChallenge(response);
  const retryableStatus = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
  if (!challenge && (!idempotent || !retryableStatus)) return { retry: false };
  const retryAfter = retryAfterMs(response);
  if (retryAfter === RETRY_AFTER_TOO_LONG) throw new Error(PLATFORM_CHALLENGE_MESSAGE);
  if (challenge) return { retry: true, delayMs: retryAfter ?? 1_000 };
  return { retry: true, delayMs: retryAfter };
}

export async function fetchWithResilience(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ResilienceOptions = {}
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY;
  const wait = options.wait ?? sleep;
  const random = options.random ?? Math.random;
  const idempotent = options.isIdempotent ?? isIdempotentMethod(init.method);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      const decision = await shouldRetry(response, attempt, attempts, idempotent);
      if (!decision.retry) return response;
      await wait(decision.delayMs ?? backoffDelay(attempt, base, max, random));
    } catch (error) {
      lastError = error;
      // A server-directed give-up is not a transport failure and must not be retried.
      if (error instanceof Error && error.message === PLATFORM_CHALLENGE_MESSAGE) throw error;
      // A transport failure on a write is ambiguous: never resend it.
      if (!idempotent || attempt >= attempts - 1) throw error;
      await wait(backoffDelay(attempt, base, max, random));
    }
  }
  throw lastError ?? new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง');
}

export const PLATFORM_CHALLENGE_MESSAGE =
  'ระบบกำลังตรวจสอบความปลอดภัย กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
