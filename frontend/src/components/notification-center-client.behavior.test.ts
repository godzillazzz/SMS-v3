// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { notificationCenterClient } from './notification-center-client';
import { formatRequestErrorMessage } from '../request-error';

afterEach(() => vi.unstubAllGlobals());
it('preserves the request reference on a failed Notification Center load', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'x-request-id': '12345678-1234-4123-8123-123456789abc' } })));
  try { await notificationCenterClient.get('token'); throw new Error('expected failure'); }
  catch (error) { expect(formatRequestErrorMessage(error, 'load failed')).toContain('12345678-1234-4123-8123-123456789abc'); }
});
