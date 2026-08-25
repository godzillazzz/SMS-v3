export type AttendanceSupervisorRow = {
  date: string;
  assignmentId: string;
  sessionId?: string | null;
  employeeId: string;
  employeeCode?: string | null;
  employeeName: string;
  department?: string | null;
  expectedSite?: { id: string; code?: string | null; name?: string | null } | null;
  actualSite?: { id: string; code?: string | null; name?: string | null } | null;
  shift?: { id?: string; code?: string | null; name?: string | null };
  originalCheckInAt?: string | null;
  originalCheckOutAt?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  attendanceStatus: string;
  flags: string[];
  corrections?: Array<Record<string, unknown>>;
};

export type AttendanceDailyData = {
  date: string;
  generatedAt: string;
  scope: { role: string; department?: string | null };
  summary: Record<string, number>;
  rows: AttendanceSupervisorRow[];
};

export type AttendanceMonthPreview = {
  month: string;
  scheduleApproval?: { status: string; revision: number; approvedAt?: string | null } | null;
  summary: Record<string, number>;
  blockerCount: number;
  blockers: Array<{ assignmentId: string; employeeId: string; workDate: string; status: string; flags: string[] }>;
  rows: Array<Record<string, unknown>>;
};

export type AttendanceOfficialReport = {
  certificationId: string;
  month: string;
  revision: number;
  status: string;
  summaryDigest: string;
  certifiedAt: string;
  summary: Record<string, number>;
  rows: Array<Record<string, unknown>>;
};

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function csrfToken() {
  const encoded = document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

function headers(token: string, json = false) {
  const result = new Headers({ Authorization: `Bearer ${token}` });
  if (json) result.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) result.set('X-CSRF-Token', csrf);
  return result;
}

async function jsonRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: init.headers || headers(token, Boolean(init.body)) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `Attendance request failed (${response.status})`);
  return body.data as T;
}

export function attendanceSupervisorDaily(token: string, filters: { date: string; department?: string; siteId?: string; shiftTypeId?: string; employeeId?: string; status?: string }) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return jsonRequest<AttendanceDailyData>(token, `/attendance/supervisor/daily?${query.toString()}`);
}

export function attendanceCorrect(token: string, assignmentId: string, input: { eventType: 'CHECK_IN' | 'CHECK_OUT'; correctedEffectiveEventAt: string; reason: string }) {
  return jsonRequest<Record<string, unknown>>(token, `/attendance/governance/assignments/${encodeURIComponent(assignmentId)}/corrections`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify(input)
  });
}

export function attendanceMonthPreview(token: string, month: string) {
  return jsonRequest<AttendanceMonthPreview>(token, `/attendance/governance/months/${encodeURIComponent(month)}/preview`);
}

export function attendanceCertifications(token: string, month: string) {
  return jsonRequest<Array<Record<string, unknown>>>(token, `/attendance/governance/months/${encodeURIComponent(month)}/certifications`);
}

export function attendanceCertify(token: string, month: string) {
  return jsonRequest<Record<string, unknown>>(token, `/attendance/governance/months/${encodeURIComponent(month)}/certify`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify({})
  });
}

export function attendanceUnlock(token: string, month: string, reason: string) {
  return jsonRequest<Record<string, unknown>>(token, `/attendance/governance/months/${encodeURIComponent(month)}/unlock`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify({ reason })
  });
}

export function attendanceOfficialReport(token: string, month: string) {
  return jsonRequest<AttendanceOfficialReport>(token, `/attendance/governance/months/${encodeURIComponent(month)}/report`);
}

export async function attendanceDownloadXlsx(token: string, month: string) {
  const response = await fetch(`${baseUrl}/attendance/governance/months/${encodeURIComponent(month)}/report.xlsx`, { headers: headers(token) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message || body?.message || `Attendance export failed (${response.status})`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `attendance-${month}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
