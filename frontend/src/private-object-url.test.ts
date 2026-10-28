// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateObjectUrl } from './api';

// Owner issue 6 (2026-10-28): licence documents did not show because the viewer pointed an <iframe> at the
// authenticated storage proxy (no Bearer header) using a path outside the API base.
describe('privateObjectUrl', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('fetches the proxy file under the API base with the token and returns an object URL', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:licence');
    Object.assign(URL, { createObjectURL });

    const url = await privateObjectUrl('token-1', '/api/storage-proxy/license/doc-1');

    expect(url).toBe('blob:licence');
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('/api/v1/storage-proxy/license/doc-1');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1');
  });

  it('leaves blob and data URLs untouched and reports a gone file in Thai', async () => {
    expect(await privateObjectUrl('t', 'blob:already')).toBe('blob:already');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 410 })));
    await expect(privateObjectUrl('t', '/api/storage-proxy/license/gone')).rejects.toThrow('ไฟล์นี้ถูกลบหรือไม่สามารถเปิดได้แล้ว');
  });
});
