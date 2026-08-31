import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

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

export type AttendanceActiveChallenge = {
  version: string;
  code: 'TURN_LEFT' | 'TURN_RIGHT' | 'LOOK_UP' | 'LOOK_DOWN' | string;
  frameCount: number;
};

export type AttendanceVerificationStart = {
  sessionId: string | null;
  deviceEnrollmentId: string | null;
  status: string | null;
  expiresAt: string | null;
  challengeId: string | null;
  challenge: string | null;
  attendanceContext: AttendanceContextRef | null;
  activeChallenge: AttendanceActiveChallenge | null;
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

export type AttendanceFaceChallengeUatStartData = {
  ok: true;
  uatOnly: true;
  attemptId: string;
  activeChallenge: AttendanceActiveChallenge;
  verifierCalled: false;
  verificationAccepted: false;
  attendanceAccepted: false;
  retained: false;
};

export type AttendanceSelfEmployee = {
  id: string;
  employeeCode: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  department?: string | null;
  jobTitle?: string | null;
};

export type AttendanceSelfSite = { id: string; code?: string | null; name: string };
export type AttendanceSelfShift = {
  id: string;
  code?: string | null;
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

export type AttendanceSelfRow = {
  date: string;
  assignmentId: string;
  sessionId?: string | null;
  employee: AttendanceSelfEmployee;
  shift: AttendanceSelfShift;
  expectedSite?: AttendanceSelfSite | null;
  actualSite?: AttendanceSelfSite | null;
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  originalCheckInAt?: string | null;
  originalCheckOutAt?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  checkInEventId?: string | null;
  checkOutEventId?: string | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  earlyOutMinutes?: number | null;
  status: string;
  flags: string[];
  corrected?: boolean;
  correctionEventTypes?: string[];
  authority?: string;
};

export type AttendanceSelfTodayData = {
  generatedAt: string;
  employee: AttendanceSelfEmployee;
  assignment: AttendanceSelfRow | null;
  scheduleReady: boolean;
  scheduleRevision?: number;
  reason?: string;
};

export type AttendanceSelfHistoryData = {
  generatedAt: string;
  employee: AttendanceSelfEmployee;
  from: string;
  to: string;
  rows: AttendanceSelfRow[];
};

export type AttendanceSelfScheduleRow = {
  date: string;
  assignmentId: string;
  shift: AttendanceSelfShift;
  expectedSite?: AttendanceSelfSite | null;
  remark?: string | null;
};

export type AttendanceSelfScheduleData = {
  generatedAt: string;
  employee: AttendanceSelfEmployee;
  month: string;
  approved: boolean;
  revision?: number | null;
  rows: AttendanceSelfScheduleRow[];
};

export type AttendanceFaceChallengeUatCaptureData = {
  ok: true;
  uatOnly: true;
  captureReceived: true;
  activeChallenge: AttendanceActiveChallenge;
  verifierCalled: false;
  verificationAccepted: false;
  attendanceAccepted: false;
  receipt: null;
  retained: false;
};


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

function publicCode(payload: Record<string, any>) {
  const value = typeof payload?.code === 'string'
    ? payload.code
    : typeof payload?.details?.code === 'string'
      ? payload.details.code
      : undefined;
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && /^[A-Z0-9_]+$/.test(normalized) ? normalized : undefined;
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
  qrToken?: string;
  location: AttendanceLocationEvidence;
}): Promise<AttendanceReadinessResult> {
  const response = await attendanceAuthenticatedRequest(`/attendance/readiness`, token, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      captureId: input.captureId,
      attendanceEvidence: {
        ...(input.qrToken ? { qrToken: input.qrToken } : {}),
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
  qrToken?: string;
  location: AttendanceLocationEvidence;
}): Promise<AttendanceVerificationStartResult> {
  const response = await attendanceAuthenticatedRequest(`/attendance/verification/start`, token, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      captureId: input.captureId,
      attendanceEvidence: {
        ...(input.qrToken ? { qrToken: input.qrToken } : {}),
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
  const response = await attendanceAuthenticatedRequest(`/attendance/devices/me`, token, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านอุปกรณ์ลงเวลาได้'), response.status, requestId);
  return payload.data as AttendanceDeviceState;
}

export async function attendanceDeviceAdminOverview(token: string) {
  const response = await attendanceAuthenticatedRequest('/attendance/devices/admin/overview', token, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านประวัติอุปกรณ์ลงเวลาได้'), response.status, requestId, publicCode(payload));
  return payload.data;
}

export async function revokeAttendanceDeviceCurrent(token: string, employeeId: string, deviceId: string, reason: string) {
  const path = `/attendance/devices/admin/employees/${encodeURIComponent(employeeId)}/current/${encodeURIComponent(deviceId)}/revoke`;
  const response = await attendanceAuthenticatedRequest(path, token, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({ reason })
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถยกเลิกอุปกรณ์ลงเวลาได้'), response.status, requestId, publicCode(payload));
  return payload.data;
}

export async function verifyAttendanceDeviceProof(token: string, sessionId: string, input: {
  challengeId: string;
  challenge: string;
  signatureBase64: string;
}) {
  const response = await attendanceAuthenticatedRequest(`/attendance/verification/${encodeURIComponent(sessionId)}/device-proof`, token, {
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

export async function attendanceFaceMatch(token: string, sessionId: string, photo: Blob, challengeFrames: Blob[]): Promise<AttendanceFaceVerificationData> {
  const form = new FormData();
  form.append('photo', photo, 'attendance-live-face.jpg');
  challengeFrames.forEach((frame, index) => form.append('challengeFrame', frame, `attendance-challenge-${index + 1}.jpg`));
  const response = await attendanceAuthenticatedRequest(`/attendance/verification/${encodeURIComponent(sessionId)}/face-match`, token, {
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

export async function attendanceFaceChallengeUatStart(token: string): Promise<AttendanceFaceChallengeUatStartData> {
  const response = await attendanceAuthenticatedRequest(`/attendance/uat/face-challenge/start`, token, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify({})
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const message = response.status === 404
      ? 'โหมดทดสอบ Active Challenge ยังไม่เปิดใน Preview นี้'
      : publicError(payload, response.status, 'ไม่สามารถเริ่ม Active Challenge UAT ได้');
    throw new AttendanceFlowError(message, response.status, requestId, response.status === 404 ? 'FACE_CHALLENGE_UAT_UNAVAILABLE' : undefined);
  }
  return payload.data as AttendanceFaceChallengeUatStartData;
}

export async function attendanceFaceChallengeUatCapture(token: string, attemptId: string, photo: Blob, challengeFrames: Blob[]): Promise<AttendanceFaceChallengeUatCaptureData> {
  const form = new FormData();
  form.append('photo', photo, 'uat-live-face.jpg');
  challengeFrames.forEach((frame, index) => form.append('challengeFrame', frame, `uat-challenge-${index + 1}.jpg`));
  const response = await attendanceAuthenticatedRequest(`/attendance/uat/face-challenge/${encodeURIComponent(attemptId)}/capture`, token, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token),
    body: form
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถส่งชุดภาพ Active Challenge UAT ได้'), response.status, requestId);
  return payload.data as AttendanceFaceChallengeUatCaptureData;
}

export async function attendanceSelfToday(token: string): Promise<AttendanceSelfTodayData> {
  const response = await attendanceAuthenticatedRequest(`/attendance/me/today`, token, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านข้อมูลลงเวลาวันนี้ได้'), response.status, requestId);
  return payload.data as AttendanceSelfTodayData;
}

export async function attendanceSelfHistory(token: string, input: { from?: string; to?: string } = {}): Promise<AttendanceSelfHistoryData> {
  const params = new URLSearchParams();
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  const response = await attendanceAuthenticatedRequest(`/attendance/me/history${params.size ? `?${params.toString()}` : ''}`, token, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านประวัติการลงเวลาได้'), response.status, requestId);
  return payload.data as AttendanceSelfHistoryData;
}

export async function attendanceSelfSchedule(token: string, month?: string): Promise<AttendanceSelfScheduleData> {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const response = await attendanceAuthenticatedRequest(`/attendance/me/schedule${params.size ? `?${params.toString()}` : ''}`, token, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(token)
  });
  const requestId = safeRequestId(response.headers.get('x-request-id'));
  const payload = await jsonPayload(response);
  if (!response.ok) throw new AttendanceFlowError(publicError(payload, response.status, 'ไม่สามารถอ่านตารางงานได้'), response.status, requestId);
  return payload.data as AttendanceSelfScheduleData;
}

export async function attendanceAcceptVerifiedEvent(token: string, input: {
  receipt: string;
  attendanceContext: AttendanceContextRef;
}): Promise<AttendanceAcceptedData> {
  const response = await attendanceAuthenticatedRequest(`/attendance/events`, token, {
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
  if (!response.ok) throw new AttendanceFlowError(
    publicError(payload, response.status, 'Server ไม่สามารถบันทึก AttendanceEvent ได้'),
    response.status,
    requestId,
    publicCode(payload)
  );
  return payload.data as AttendanceAcceptedData;
}
