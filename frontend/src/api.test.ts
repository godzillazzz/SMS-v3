import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const success = () => ({ status: 200, ok: true, json: async () => ({ accessToken: 'test-access-token', user: {} }) });
afterEach(() => vi.unstubAllGlobals());

describe('API client', () => {
  it('exposes the browser authentication operations', () => {
    expect(typeof api.login).toBe('function'); expect(typeof api.refresh).toBe('function'); expect(typeof api.logout).toBe('function'); expect(typeof api.logoutAll).toBe('function');
  });
  it('sends the readable CSRF cookie in browser refresh, logout, and logout-all requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('document', { cookie: 'smsv3_csrf=test-csrf-value' });
    vi.stubGlobal('fetch', fetchMock);
    await api.refresh(); await api.logout(); await api.logoutAll('test-access-token');
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe('include');
      expect(options.headers.get('x-csrf-token')).toBe('test-csrf-value');
    }
  });
  it('sends the CSRF header for startup refresh from /dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('document', { cookie: 'smsv3_csrf=test-csrf-value' });
    vi.stubGlobal('location', { pathname: '/dashboard' });
    vi.stubGlobal('fetch', fetchMock);
    await api.refresh();
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/auth/refresh');
    expect(options.headers.get('x-csrf-token')).toBe('test-csrf-value');
  });
});
