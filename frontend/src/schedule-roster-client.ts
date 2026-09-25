import { ApiRequestError, normalizeRequestId } from './api';

export type ScheduleRosterOrderRow = {
  id: string;
  employeeCode?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  rosterOrder?: number | null;
};

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const csrf = () => document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];

async function rosterCall(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include', headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers?.get?.('x-request-id')) || normalizeRequestId(payload?.requestId);
    throw new ApiRequestError(payload?.error || 'เกิดข้อผิดพลาดในการจัดลำดับพนักงาน', response.status, requestId, payload?.details);
  }
  return payload;
}

export function getScheduleRosterOrder(token: string, department: string) {
  return rosterCall(`/schedules/roster-order?department=${encodeURIComponent(department)}`, token);
}

export function updateScheduleRosterOrder(token: string, department: string, employeeIds: string[]) {
  return rosterCall('/schedules/roster-order', token, {
    method: 'PUT',
    body: JSON.stringify({ department, employeeIds })
  });
}