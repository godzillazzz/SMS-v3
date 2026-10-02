import { attendanceAuthenticatedRequest } from './attendance-auth-request';

export type AttendanceTimePolicy = {
  lateGraceMinutes: number;
  earliestCheckInEnabled: boolean;
  earliestCheckInMinutesBeforeStart: number;
  latestCheckInEnabled: boolean;
  latestCheckInMinutesAfterStart: number | null;
  earliestCheckOutEnabled: boolean;
  earliestCheckOutMinutesAfterStart: number;
  latestCheckOutEnabled: boolean;
  latestCheckOutMinutesAfterEnd: number | null;
  earlyLeaveEnabled: boolean;
  earlyCheckoutToleranceMinutes: number;
  missingCheckoutEnabled: boolean;
  missingCheckoutAfterMinutes: number;
  maxShiftDurationEnabled: boolean;
  maxShiftDurationMinutes: number | null;
};

export type AttendanceTimePolicyScope = 'COMPANY' | 'SITE' | 'SHIFT_TYPE';
export type AttendanceTimePolicyRow = {
  id: string;
  scopeType: AttendanceTimePolicyScope;
  siteId: string | null;
  shiftTypeId: string | null;
  policy: AttendanceTimePolicy;
  effectiveFrom: string;
  createdAt: string;
};
export type AttendanceTimePolicyOptions = {
  id: string;
  code: string;
  name: string;
  startTime?: string | null;
  endTime?: string | null;
};
export type AttendanceTimePolicyList = {
  now: string;
  defaultPolicy: AttendanceTimePolicy;
  sites: AttendanceTimePolicyOptions[];
  shiftTypes: AttendanceTimePolicyOptions[];
  policies: AttendanceTimePolicyRow[];
};

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : 'ไม่สามารถจัดการนโยบายเวลาลงงานได้';
    throw new Error(message);
  }
  return body.data as T;
}

export async function loadAttendanceTimePolicies(token: string): Promise<AttendanceTimePolicyList> {
  const response = await attendanceAuthenticatedRequest('/attendance/time-policies', token, { method: 'GET', credentials: 'include' });
  return responseData<AttendanceTimePolicyList>(response);
}

export async function saveAttendanceTimePolicy(token: string, input: {
  scopeType: AttendanceTimePolicyScope;
  siteId?: string | null;
  shiftTypeId?: string | null;
  effectiveFrom?: string;
  policy: AttendanceTimePolicy;
}): Promise<AttendanceTimePolicyRow> {
  const response = await attendanceAuthenticatedRequest('/attendance/time-policies', token, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
  });
  return responseData<AttendanceTimePolicyRow>(response);
}
