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

export type AttendanceContextRef = {
  captureId: string;
  eventIntent: AttendanceEventIntent;
  shiftAssignmentId: string;
  evidence: Record<string, unknown>;
};

export type AttendanceVerificationStart = {
  sessionId: string | null;
  status: string | null;
  expiresAt: string | null;
  challengeId: string | null;
  challenge: string | null;
  attendanceContext: AttendanceContextRef | null;
};

export type AttendanceVerificationStartData = AttendanceReadinessData & {
  verification: AttendanceVerificationStart | null;
};

export type AttendanceReadinessResult =
  | { routeAvailable: true; data: AttendanceReadinessData; requestId?: string }
  | { routeAvailable: false; data: null; requestId?: string };

export type AttendanceVerificationStartResult =
  | { routeAvailable: true; data: AttendanceVerificationStartData; requestId?: string }
  | { routeAvailable: false; data: null; requestId?: string };

export type AttendanceDeviceState = {
  employeeId: string;
  activeDevice: { id: string; status: string } | null;
};

export type AttendanceFaceVerificationData = {
  ok: boolean;
  verificationAccepted: boolean;
  receipt: string | null;
  receiptExpiresAt?: string | null;
  evidence?: { storageStatus?: string; stored?: boolean };
  readiness?: AttendanceReadinessState;
};

export type AttendanceAcceptedData = {
  ok: boolean;
  attendanceAccepted: boolean;
  idempotent?: boolean;
  event?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  readiness?: AttendanceReadinessState;
};

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

function authHeaders(token: string, json = false) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (json) headers.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  return headers;
}

function publicError(payload: Record<string, unknown>, status: number, fallback: string) {
  if (typeof payload?.error === 'string') return payload.error;
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  return fallback;
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

export class AttendanceFlowError extends Error {
  status: number;
  requestId?: string;
  code?: string;

  constructor(message: string, status: number, requestId?: string, code?: string) {
    super(message);
    this.name = 'AttendanceFlowError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

async function jsonPayload(response: Response) {
  return await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, any>;
}

export async function attendanceReadiness(token: string, input: {
  captureId: string;
  qrToken: string;
  location: AttendanceLocationEvidence;
}): Promise<AttendanceReadinessResult> {
  const response = await fetch(`${baseUrl}/attendance/readiness`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
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
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceReadinessError(publicError(payload, response.status, 'ไม่สามารถตรวจสอบความพร้อมของระบบลงเวลาได้'), response.status, requestId);
  return { routeAvailable: true, data: payload.data as AttendanceReadinessData, requestId };
}

export async function attendanceVerificationStart(token: string, input: {
  captureId: string;
  qrToken: string;
  location: AttendanceLocationEvidence;
}): Promise<AttendanceVerificationStartResult> {
  const response = await fetch(`${baseUrl}/attendance/verification/start`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
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
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถเริ่มขั้นตรวจใบหน้าได้'), response.status, requestId);
  return { routeAvailable: true, data: payload.data as AttendanceVerificationStartData, requestId };
}

export async function attendanceDeviceState(token: string): Promise<AttendanceDeviceState> {
  const response = await fetch(`${baseUrl}/attendance/devices/me`, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านอุปกรณ์ลงเวลาได้'), response.status, requestId);
  return payload.data as AttendanceDeviceState;
}

export async function verifyAttendanceDeviceProof(token: string, sessionId: string, input: {
  challengeId: string;
  challenge: string;
  signatureBase64: string;
}) {
  const response = await fetch(`${baseUrl}/attendance/verification/${encodeURIComponent(sessionId)}/device-proof`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      challengeId: input.challengeId,
      challenge: input.challenge,
      signatureBase64: input.signatureBase64
    })
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const message = response.status === 404
      ? 'ระบบตรวจใบหน้าแบบ trusted verifier ยังไม่เปิดใช้งาน'
      : publicError(payload, response.status, 'ไม่สามารถยืนยันคีย์ของอุปกรณ์สำหรับ Face Verification ได้');
    throw new AttendanceFlowError(message, response.status, requestId, response.status === 404 ? 'FACE_VERIFIER_UNAVAILABLE' : undefined);
  }
  if (payload.data?.ok !== true || payload.data?.verificationReady !== true) {
    throw new AttendanceFlowError('Server ไม่ยอมรับ device proof สำหรับ Face Verification', 409, requestId, payload.data?.readiness?.state);
  }
  return payload.data as Record<string, unknown>;
}

export async function attendanceFaceMatch(token: string, sessionId: string, photo: Blob): Promise<AttendanceFaceVerificationData> {
  const form = new FormData();
  form.append('photo', photo, 'attendance-live-face.jpg');
  const response = await fetch(`${baseUrl}/attendance/verification/${encodeURIComponent(sessionId)}/face-match`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token),
    body: form
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const message = response.status === 404
      ? 'Trusted face verifier ยังไม่เปิดใช้งาน'
      : publicError(payload, response.status, 'Server ไม่สามารถตรวจใบหน้าได้');
    throw new AttendanceFlowError(message, response.status, requestId, response.status === 404 ? 'FACE_VERIFIER_UNAVAILABLE' : undefined);
  }
  return payload.data as AttendanceFaceVerificationData;
}

export async function attendanceAcceptVerifiedEvent(token: string, input: {
  receipt: string;
  attendanceContext: AttendanceContextRef;
}): Promise<AttendanceAcceptedData> {
  const response = await fetch(`${baseUrl}/attendance/events`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      receipt: input.receipt,
      attendanceContext: input.attendanceContext
    })
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'Server ไม่สามารถบันทึก AttendanceEvent ได้'), response.status, requestId);
  return payload.data as AttendanceAcceptedData;
}
