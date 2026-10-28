import { fetchWithResilience } from './lib/request-resilience';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Owner issue 6 (2026-10-28): private files (licence documents, photos) are served by the authenticated
 * storage proxy. An <iframe>/<img> cannot send the Bearer token, and the server hands out
 * "/api/storage-proxy/..." while the routes live under the API base, so the page fetches the bytes
 * itself and shows them through an object URL. Callers revoke the URL when the viewer closes.
 * Kept outside api.ts, whose source is locked by the T25 contract tests.
 */
export async function privateObjectUrl(token: string, url: string): Promise<string> {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  const proxyPath = url.replace(/^\/api\/(?:v1\/)?storage-proxy\//, '/storage-proxy/');
  const target = proxyPath.startsWith('/storage-proxy/') ? `${baseUrl}${proxyPath}` : url;
  const response = await fetchWithResilience(target, { credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 410 ? 'ไฟล์นี้ถูกลบหรือไม่สามารถเปิดได้แล้ว' : 'ไม่สามารถโหลดไฟล์ได้ กรุณาลองใหม่');
  return URL.createObjectURL(await response.blob());
}
