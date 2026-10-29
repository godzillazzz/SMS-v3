import { describe, expect, it, vi } from 'vitest';
import { attendanceDeviceSelfieWithTimestamp } from './attendance-client';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

vi.mock('../../attendance-auth-request', () => ({ attendanceAuthenticatedRequest: vi.fn() }));

describe('device selfie response timestamp', () => {
  it.each([
    ['2026-10-29T05:00:00.000Z', '2026-10-29T05:00:00.000Z'],
    [null, null],
    ['not-a-date', null],
    ['2026-02-30T05:00:00.000Z', null]
  ])('preserves valid header or returns no timestamp: %s', async (header, expected) => {
    const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
    if (header) headers['x-selfie-captured-at'] = header;
    vi.mocked(attendanceAuthenticatedRequest).mockResolvedValueOnce(new Response('photo', { headers }));
    const result = await attendanceDeviceSelfieWithTimestamp('token', 'employee', 'device');
    expect(result.capturedAt).toBe(expected);
    expect(await result.blob.text()).toBe('photo');
  });
});
