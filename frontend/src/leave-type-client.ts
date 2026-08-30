import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type LeaveTypeMaster = {
  id: string;
  code: string;
  name: string;
  quotaBucket: 'SICK' | 'PERSONAL' | 'VACATION' | 'NONE';
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

function responseRequestId(response: Response, payload?: unknown) {
  const headerRequestId = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (headerRequestId) return headerRequestId;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

async function request(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error || 'Leave Type operation failed',
      response.status,
      responseRequestId(response, payload),
      payload?.details
    );
  }
  return payload;
}

export async function getLeaveTypes(token: string, options: { includeInactive?: boolean } = {}) {
  const query = options.includeInactive ? '?includeInactive=true' : '';
  return request(token, `/leave-types${query}`, { method: 'GET' });
}

export async function createLeaveType(token: string, input: {
  code: string;
  name: string;
  quotaBucket: LeaveTypeMaster['quotaBucket'];
  isActive?: boolean;
  sortOrder?: number;
}) {
  return request(token, '/leave-types', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateLeaveType(token: string, id: string, input: Partial<Pick<LeaveTypeMaster, 'name' | 'quotaBucket' | 'isActive' | 'sortOrder'>>) {
  return request(token, `/leave-types/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}
