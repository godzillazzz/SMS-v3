import { ApiRequestError, normalizeRequestId } from './api';

export type LeaveDateConflict = {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  leaveType: string;
};

export type LeaveDateOverlapResult = {
  data: { hasConflict: boolean; conflict: LeaveDateConflict | null };
};

// Keep the central API client hash-locked. This is a read-only, isolated
// pre-submit preflight; the authoritative POST guard always rechecks.
export async function checkExistingLeaveDates(
  token: string,
  filters: { startDate: string; endDate: string; employeeId?: string }
): Promise<LeaveDateOverlapResult> {
  const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const csrf = document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
  if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  const response = await fetch(`${baseUrl}/leave-requests/check-overlap?${params.toString()}`, {
    method: 'GET', credentials: 'include', headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers.get('x-request-id'))
      || normalizeRequestId(payload.requestId);
    throw new ApiRequestError(payload.error || 'ไม่สามารถตรวจสอบประวัติคำขอลาได้', response.status, requestId, payload.details);
  }
  return payload as LeaveDateOverlapResult;
}
