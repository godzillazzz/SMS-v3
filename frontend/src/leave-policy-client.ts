import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function responseRequestId(response: Response, payload?: unknown) {
  const headerRequestId = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (headerRequestId) return headerRequestId;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

export async function getLeavePolicy(token: string) {
  const response = await fetch(`${baseUrl}/leave-policy`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error || 'ไม่สามารถอ่าน Leave Policy ได้',
      response.status,
      responseRequestId(response, payload),
      payload?.details
    );
  }
  return payload;
}


export async function updateLeavePolicy(token: string, policy: unknown) {
  const csrf = document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  const response = await fetch(`${baseUrl}/leave-policy`, { method: 'PUT', credentials: 'include', headers, body: JSON.stringify(policy) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(payload?.error || 'ไม่สามารถบันทึก Leave Policy ได้', response.status, responseRequestId(response, payload), payload?.details);
  return payload;
}
