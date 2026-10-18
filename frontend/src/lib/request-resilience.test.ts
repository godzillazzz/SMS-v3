import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  fetchWithResilience,
  isIdempotentMethod,
  isPlatformChallenge,
  PLATFORM_CHALLENGE_MESSAGE
} from './request-resilience';

const jsonResponse = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: status < 400 }), { status, headers });

const challengeResponse = () => jsonResponse(403, { 'x-vercel-mitigated': 'challenge', 'retry-after': '1' });

const noWait = async () => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isIdempotentMethod', () => {
  it('treats reads as idempotent and writes as not', () => {
    expect(isIdempotentMethod('GET')).toBe(true);
    expect(isIdempotentMethod(undefined)).toBe(true);
    expect(isIdempotentMethod('head')).toBe(true);
    expect(isIdempotentMethod('POST')).toBe(false);
    expect(isIdempotentMethod('PATCH')).toBe(false);
    expect(isIdempotentMethod('DELETE')).toBe(false);
  });
});

describe('isPlatformChallenge', () => {
  it('detects only a 403 marked as mitigated by challenge', () => {
    expect(isPlatformChallenge(challengeResponse())).toBe(true);
    expect(isPlatformChallenge(jsonResponse(403))).toBe(false);
    expect(isPlatformChallenge(jsonResponse(500, { 'x-vercel-mitigated': 'challenge' }))).toBe(false);
  });
});

describe('fetchWithResilience', () => {
  it('returns the first success without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/health', {}, { wait: noWait });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a platform challenge and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/health', {}, { wait: noWait, attempts: 3 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a challenged write because it never reached the application', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(jsonResponse(201));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/employees', { method: 'POST' }, { wait: noWait, attempts: 3 });
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ambiguous 5xx on a write', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/employees', { method: 'POST' }, { wait: noWait, attempts: 3 });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent 503 up to the attempt budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/health', {}, { wait: noWait, attempts: 3 });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honours retry-after on a 429', async () => {
    const waits: number[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithResilience('/api/v1/health', {}, { wait: async (ms) => { waits.push(ms); } });
    expect(waits[0]).toBe(2000);
  });

  it('retries a transport failure for reads', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithResilience('/api/v1/health', {}, { wait: noWait, attempts: 3 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never resends a write after a transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithResilience('/api/v1/employees', { method: 'POST' }, { wait: noWait, attempts: 3 }))
      .rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes a plain-language challenge message', () => {
    expect(PLATFORM_CHALLENGE_MESSAGE).toContain('ตรวจสอบความปลอดภัย');
  });
});
