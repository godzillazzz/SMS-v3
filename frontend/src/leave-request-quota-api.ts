import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export async function getEmployeeLeaveQuota(token: string, year: number, employeeId: string) {
  const params = new URLSearchParams({ page: '1', pageSize: '100', year: String(year), employeeId });
  const response = await fetch(`${baseUrl}/leave-quotas?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const headerId = normalizeRequestId(response.headers?.get?.('x-request-id'));
    const payloadId = payload && typeof payload === 'object' ? normalizeRequestId((payload as { requestId?: unknown }).requestId) : undefined;
    throw new ApiRequestError(payload?.error || 'Unable to read employee leave quota.', response.status, headerId || payloadId, payload?.details);
  }
  return payload as { data?: Array<Record<string, unknown>>; meta?: Record<string, unknown> };
}
