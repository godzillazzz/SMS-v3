// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { api, ApiRequestError } from './api';
import { PLATFORM_CHALLENGE_MESSAGE } from './lib/request-resilience';

const challengeResponse = () =>
  new Response('<html>Vercel Security Checkpoint</html>', {
    status: 403,
    headers: { 'x-vercel-mitigated': 'challenge', 'retry-after': '0', 'content-type': 'text/html' }
  });

beforeEach(() => {
  // The API client reads the CSRF cookie; jsdom needs it present or absent deterministically.
  document.cookie = 'smsv3_csrf=test-csrf';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('download path resilience', () => {
  it('surfaces the platform-challenge message instead of a raw download failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(challengeResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.downloadLeaveAttachment('token', 'leave-1'))
      .rejects.toMatchObject({ message: PLATFORM_CHALLENGE_MESSAGE, status: 403 });

    // attempts=3 means at most three requests in total: the original plus two retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns the file when the retry finally succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(new Response('file-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''report.pdf` }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.downloadLeaveAttachment('token', 'leave-1');
    expect(result.fileName).toBe('report.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed ApiRequestError for an ordinary failure without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'ไม่พบไฟล์' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.downloadLeaveAttachment('token', 'leave-1')).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('json path challenge message', () => {
  it('uses the same message when a challenge persists on a json request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(challengeResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getSecuritySites('token')).rejects.toMatchObject({ message: PLATFORM_CHALLENGE_MESSAGE });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
