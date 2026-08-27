import { ApiRequestError, normalizeRequestId } from '../../api';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

function csrfToken() {
  const encoded = document.cookie
    .split('; ')
    .find((item) => item.startsWith('smsv3_csrf='))
    ?.split('=')[1];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

async function call(path: string, token: string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const csrf = csrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await attendanceAuthenticatedRequest(path, token, {
    method: 'GET',
    credentials: 'include',
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers.get('x-request-id'))
      || normalizeRequestId(payload?.requestId);
    throw new ApiRequestError(payload?.error || 'Attendance supervisor request failed.', response.status, requestId, payload?.details);
  }
  return payload;
}

function query(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function attendanceSupervisorDaily(token: string, filters: {
  date?: string;
  department?: string;
  siteId?: string;
  shiftTypeId?: string;
  employeeId?: string;
  status?: string;
} = {}) {
  return call(`/attendance/supervisor/daily${query(filters)}`, token);
}

export function attendanceSupervisorHistory(token: string, filters: {
  from?: string;
  to?: string;
  department?: string;
  siteId?: string;
  shiftTypeId?: string;
  employeeId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  return call(`/attendance/supervisor/history${query(filters)}`, token);
}

export function attendanceSupervisorDetail(token: string, assignmentId: string) {
  return call(`/attendance/supervisor/assignments/${encodeURIComponent(assignmentId)}/detail`, token);
}

export function attendanceEvidenceView(token: string, evidenceId: string) {
  return call(`/attendance/evidence/${encodeURIComponent(evidenceId)}/view`, token);
}
