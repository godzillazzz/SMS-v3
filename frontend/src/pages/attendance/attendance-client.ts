export type AttendanceEventIntent = 'CHECK_IN' | 'CHECK_OUT';

export type AttendanceLocationEvidence = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

export type AttendanceReadinessState = {
  attendanceAccepted: false;
  authority: string;
  state: string;
  blocking: boolean;
  retryable: boolean;
  action: string;
  messageKey: string;
  reasonCode?: string | null;
};

export type AttendanceReadinessData = {
  ok: boolean;
  eventIntent: AttendanceEventIntent | null;
  readiness: AttendanceReadinessState;
};

export type AttendanceReadinessResult =
  | { routeAvailable: true; data: AttendanceReadinessData; requestId?: string }
  | { routeAvailable: false; data: null; requestId?: string };

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function csrfToken() {
  const encoded = document.cookie
    .split('; ')
    .find((item) => item.startsWith('smsv3_csrf='))
    ?.split('=')[1];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

function safeRequestId(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

export class AttendanceReadinessError extends Error {
  status: number;
  requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'AttendanceReadinessError';
    this.status = status;
    this.requestId = requestId;
  }
}

export async function attendanceReadiness(token: string, input: {
  captureId: string;
  qrToken: string;
  location: AttendanceLocationEvidence;
}): Promise<AttendanceReadinessResult> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  });
  const csrf = csrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);

  const response = await fetch(`${baseUrl}/attendance/readiness`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      captureId: input.captureId,
      attendanceEvidence: {
        qrToken: input.qrToken,
        location: input.location
      }
    })
  });

  const requestId = safeRequestId(response.headers.get('x-request-id'));
  if (response.status === 404) return { routeAvailable: false, data: null, requestId };

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : response.status === 401
        ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
        : 'ไม่สามารถตรวจสอบความพร้อมของระบบลงเวลาได้';
    throw new AttendanceReadinessError(message, response.status, requestId);
  }

  return {
    routeAvailable: true,
    data: payload.data as AttendanceReadinessData,
    requestId
  };
}
