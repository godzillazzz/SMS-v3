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

export async function getShiftTypes(token: string, options: { includeInactive?: boolean } = {}) {
  const query = options.includeInactive ? '?includeInactive=true' : '';
  const response = await fetch(`${baseUrl}/shift-types${query}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error || 'Shift Type operation failed',
      response.status,
      responseRequestId(response, payload),
      payload?.details
    );
  }
  return payload;
}
