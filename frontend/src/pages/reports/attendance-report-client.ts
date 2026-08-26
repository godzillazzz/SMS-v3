import { api, ApiRequestError, normalizeRequestId } from '../../api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type AttendanceReportSite = { id: string; code: string; name: string };
export type AttendanceReportRow = {
  assignmentId: string;
  sessionId?: string | null;
  employeeId: string;
  employeeCode?: string | null;
  employeeName: string;
  department?: string | null;
  workDate: string;
  shift?: { id?: string; code?: string | null; name?: string | null } | null;
  expectedSite?: AttendanceReportSite | null;
  actualSite?: AttendanceReportSite | null;
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  earlyOutMinutes?: number | null;
  status: string;
  flags: string[];
};

export type AttendanceOfficialReport = {
  reportId: string;
  period: string;
  revision: number;
  certificationStatus: string;
  summaryDigest: string;
  certifiedAt: string;
  certifiedByUserId: string;
  generatedAt: string;
  generatedBy: string;
  summary: Record<string, number>;
  rows: AttendanceReportRow[];
};

type BinaryDownload = { blob: Blob; fileName: string };

function requestId(response: Response, payload?: unknown) {
  const header = normalizeRequestId(response.headers.get('x-request-id'));
  if (header) return header;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

async function refreshToken() {
  const refreshed = await api.refresh();
  return String(refreshed?.accessToken || '');
}

async function reportRequest<T>(path: string, token: string, binary: boolean, retry = true): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 401 && retry) {
    const nextToken = await refreshToken();
    if (nextToken) return reportRequest<T>(path, nextToken, binary, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      payload.error || 'ไม่สามารถโหลดรายงานลงเวลาได้',
      response.status,
      requestId(response, payload),
      payload.details
    );
  }
  if (binary) {
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    return { blob: await response.blob(), fileName: encodedName ? decodeURIComponent(encodedName) : 'SMS-Attendance.xlsx' } as T;
  }
  const payload = await response.json();
  return payload.data as T;
}

export function loadAttendanceOfficialReport(token: string, month: string) {
  return reportRequest<AttendanceOfficialReport>(`/attendance/governance/months/${encodeURIComponent(month)}/report`, token, false);
}

export function downloadAttendanceOfficialWorkbook(token: string, month: string) {
  return reportRequest<BinaryDownload>(`/attendance/governance/months/${encodeURIComponent(month)}/report.xlsx`, token, true);
}

export function saveBinaryDownload(download: BinaryDownload) {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
