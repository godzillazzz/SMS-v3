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
const RETRY_AFTER_CAP_MS = 10_000;

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

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), RETRY_AFTER_CAP_MS));
  return undefined;
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
  if (isPlatformChallenge(response)) return { retry: true, delayMs: retryAfterMs(response) ?? 1_000 };
  if (!idempotent) return { retry: false };
  if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
    return { retry: true, delayMs: retryAfterMs(response) };
  }
  return { retry: false };
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
      // A transport failure on a write is ambiguous: never resend it.
      if (!idempotent || attempt >= attempts - 1) throw error;
      await wait(backoffDelay(attempt, base, max, random));
    }
  }
  throw lastError ?? new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง');
}

export const PLATFORM_CHALLENGE_MESSAGE =
  'ระบบกำลังตรวจสอบความปลอดภัย กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
