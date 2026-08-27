
import { ApiRequestError, normalizeRequestId } from '../../api';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

export type AttendanceAdjustmentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RETURNED_FOR_CORRECTION'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type AttendanceAdjustmentRequest = {
  id: string;
  shiftAssignmentId: string;
  attendanceSessionId?: string | null;
  requestType: 'CONFIRM_WORK_PERFORMED' | 'ADJUST_WORK_TIME';
  status: AttendanceAdjustmentStatus;
  makerUserId: string;
  makerRoleSnapshot: string;
  makerDisplayName?: string | null;
  currentRevision: number;
  approvedRevision?: number | null;
  beforeSnapshot: {
    workDate?: string;
    original?: { checkInAt?: string | null; checkOutAt?: string | null };
    effective?: { checkInAt?: string | null; checkOutAt?: string | null };
  };
  currentProposal: { checkInAt?: string | null; checkOutAt?: string | null };
  reason: string;
  lastReviewerComment?: string | null;
  approverUserId?: string | null;
  approverDisplayName?: string | null;
  approvedAt?: string | null;
  employeeId?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  workDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function csrfToken() {
  const encoded = document.cookie
    .split('; ')
    .find((item) => item.startsWith('smsv3_csrf='))
    ?.split('=')[1];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);

  const response = await attendanceAuthenticatedRequest(path, token, {
    ...init,
    credentials: 'include',
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers.get('x-request-id'))
      || normalizeRequestId(payload?.requestId);
    throw new ApiRequestError(payload?.error || 'Attendance adjustment request failed.', response.status, requestId, payload?.details);
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

export function listAttendanceAdjustments(token: string, filters: {
  status?: AttendanceAdjustmentStatus;
  assignmentId?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  return call(`/attendance/adjustment-requests${query(filters)}`, token);
}

export function createAttendanceAdjustment(token: string, input: {
  assignmentId: string;
  requestType: 'CONFIRM_WORK_PERFORMED' | 'ADJUST_WORK_TIME';
  proposal: { checkInAt?: string | null; checkOutAt?: string | null };
  reason: string;
}) {
  return call('/attendance/adjustment-requests', token, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function getAttendanceAdjustment(token: string, id: string) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}`, token);
}

export function reviseAttendanceAdjustment(token: string, id: string, input: {
  requestType: 'CONFIRM_WORK_PERFORMED' | 'ADJUST_WORK_TIME';
  proposal: { checkInAt?: string | null; checkOutAt?: string | null };
  reason: string;
}) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}`, token, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function submitAttendanceAdjustment(token: string, id: string) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}/submit`, token, {
    method: 'POST',
    body: '{}'
  });
}

export function approveAttendanceAdjustment(token: string, id: string) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}/approve`, token, {
    method: 'POST',
    body: '{}'
  });
}

export function returnAttendanceAdjustment(token: string, id: string, comment: string) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}/return`, token, {
    method: 'POST',
    body: JSON.stringify({ comment })
  });
}

export function rejectAttendanceAdjustment(token: string, id: string, comment: string) {
  return call(`/attendance/adjustment-requests/${encodeURIComponent(id)}/reject`, token, {
    method: 'POST',
    body: JSON.stringify({ comment })
  });
}
