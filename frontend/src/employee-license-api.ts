import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type EmployeeLicense = {
  id: string;
  employeeId: string;
  licenseType: string;
  expiryDate?: string | null;
  status: string;
};

export async function getEmployeeLicenses(token: string, employeeId: string) {
  const params = new URLSearchParams({ page: '1', pageSize: '1000', employeeStatus: 'ALL', employeeId });
  const response = await fetch(`${baseUrl}/licenses?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const headerId = normalizeRequestId(response.headers?.get?.('x-request-id'));
    const payloadId = payload && typeof payload === 'object' ? normalizeRequestId((payload as { requestId?: unknown }).requestId) : undefined;
    throw new ApiRequestError(payload?.error || 'Unable to read employee licenses.', response.status, headerId || payloadId, payload?.details);
  }
  return payload as { data?: EmployeeLicense[]; meta?: { total?: number; totalPages?: number } };
}
