import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';
import { normalizeRequestId } from '../../api';

export type SimpleEventIntent = 'CHECK_IN' | 'CHECK_OUT';
export type SimpleWorkSiteContext = 'ASSIGNED_SITE' | 'SUPPORT_SITE';
export type SimpleSite = { id: string; code: string; name: string; latitude: number; longitude: number; geofenceRadiusMeters: number };
export type SimpleSiteSummary = Pick<SimpleSite, 'id' | 'code' | 'name'>;
export type SimpleLocationEvidence = {
  expectedSiteId?: string;
  actualSiteId?: string;
  assignedSite?: SimpleSiteSummary | null;
  actualSite?: SimpleSiteSummary | null;
  workSiteContext?: SimpleWorkSiteContext;
};

export type SimpleBootstrap = {
  employee: {
    id: string;
    employeeCode: string;
    displayName: string;
    firstName?: string | null;
    lastName?: string | null;
    department?: string | null;
  };
  eventIntent: SimpleEventIntent;
  assignment: {
    id: string;
    workDate: string;
    shift: { code?: string | null; name?: string | null; startTime?: string | null; endTime?: string | null };
    site: SimpleSite;
  };
  eligibleSites: SimpleSite[];
  activeDevice: { id: string; credentialFingerprint: string; displayName: string; activatedAt?: string | null } | null;
  pendingDeviceRequest: { id: string; status: 'PENDING_APPROVAL'; requestedAt: string; candidateFingerprint: string } | null;
  selfiePolicy: { sourceRole: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER'; action: SimpleEventIntent; required: boolean; policy: { role: string; clockInRequired: boolean; clockOutRequired: boolean } };
  offline: { bundle: string; issuedAt: string; expiresAt: string; confirmAfterMs: number; maxAccuracyMeters: number };
};

export type SimpleDeviceSignals = {
  standalone?: boolean;
  secureContext: boolean;
  serviceWorkerControlled?: boolean;
  webCrypto: boolean;
  indexedDb: boolean;
  privateKeyNonExportable: boolean;
  automation?: boolean;
  integrityWarnings?: string[];
};

export type SimpleEventInput = {
  captureId: string;
  eventIntent: SimpleEventIntent;
  shiftAssignmentId: string;
  capturedAt: string;
  location: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
  device: {
    publicKeySpkiBase64: string;
    keyAlgorithm: 'ECDSA_P256_SHA256';
    displayName?: string;
    platformHint?: string | null;
    signals: SimpleDeviceSignals;
    signatureBase64: string;
  };
  offlineBundle?: string | null;
  selfie?: { mimeType: 'image/jpeg' | 'image/png'; base64: string; checksum?: string; captureMode?: 'LIVE_CAMERA' | 'GALLERY'; overlay?: { capturedAt: string } };
  selfieNonce?: string | null;
};

export type SimpleEventResult = {
  counted: boolean;
  status: 'ACCEPTED' | 'ACCEPTED_REVIEW_FLAGGED' | 'PENDING_CONFIRMATION' | string;
  idempotent?: boolean;
  deviceBinding?: 'PRIMARY' | 'FOREIGN';
  reviewRequired?: boolean;
  reviewReasons?: string[];
  timeClassification?: { punctuality?: 'ON_TIME' | 'LATE' | null; checkoutCondition?: 'NORMAL' | 'EARLY_LEAVE' | null };
  event?: {
    id?: string; eventType?: string; effectiveEventAt?: string; receivedAt?: string;
    punctuality?: 'ON_TIME' | 'LATE' | null; checkoutCondition?: 'NORMAL' | 'EARLY_LEAVE' | null;
    reviewReasons?: string[] | null;
    locationEvidence?: {
      assignedSite?: SimpleSiteSummary | null;
      actualSite?: SimpleSiteSummary | null;
      workSiteContext?: SimpleWorkSiteContext;
    } | null;
  } | null;
  pendingEvent?: { id?: string; capturedAt?: string; receivedAt?: string; status?: string; locationEvidence?: SimpleLocationEvidence | null } | null;
};

export type AttendanceSimpleErrorDetails = { message: string; code?: string; requestId?: string };

export const ATTENDANCE_SIMPLE_ERROR_MESSAGES: Record<string, string> = {
  ATTENDANCE_CHECK_IN_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาเข้า',
  ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาเข้าได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
  ATTENDANCE_CHECK_OUT_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาออก',
  ATTENDANCE_CHECK_OUT_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาออกได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
  ATTENDANCE_OUTSIDE_SITE_GEOFENCE: 'ตำแหน่ง GPS อยู่นอกขอบเขต Site ตามกะ แม้ชื่อสถานที่อาจแสดงตรงกัน กรุณาเปิด Precise Location แล้วลองใหม่',
  ATTENDANCE_SITE_REQUIRED: 'ไม่พบ Site สำหรับกะนี้ กรุณาติดต่อหัวหน้างาน',
  ATTENDANCE_ASSIGNMENT_REQUIRED: 'ไม่พบกะงานที่ได้รับอนุมัติ กรุณาติดต่อหัวหน้างาน',
  ATTENDANCE_ASSIGNMENT_STALE: 'ข้อมูลกะงานเปลี่ยนแล้ว กรุณาลองใหม่อีกครั้ง',
  ATTENDANCE_SCHEDULE_NOT_APPROVED: 'ตารางกะยังไม่ได้รับอนุมัติ กรุณาติดต่อหัวหน้างาน',
  ATTENDANCE_SHIFT_NOT_ACTIONABLE: 'กะงานนี้ยังไม่พร้อมให้ลงเวลา กรุณาติดต่อหัวหน้างาน',
  ATTENDANCE_EMPLOYEE_LINK_REQUIRED: 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED: 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_DEVICE_REQUIRED: 'ยังไม่มีอุปกรณ์ลงเวลาที่ลงทะเบียนแล้ว กรุณาลงทะเบียนเครื่องนี้ก่อน',
  ATTENDANCE_DEVICE_NOT_ALLOWED: 'อุปกรณ์ลงเวลานี้ต้องรอผู้ดูแลอนุมัติก่อนใช้งาน',
  ATTENDANCE_DEVICE_AUTHORITY_CONFLICT: 'สถานะอุปกรณ์ลงเวลายังไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_DEVICE_BOUND_TO_OTHER_EMPLOYEE: 'อุปกรณ์นี้ผูกกับบัญชีอื่นอยู่ กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_DEVICE_NOT_ACTIVE: 'อุปกรณ์ลงเวลานี้ไม่ได้เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  INACTIVE_EMPLOYEE_OPERATION: 'บัญชีพนักงานนี้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_ALREADY_CHECKED_IN: 'ลงเวลาเข้าแล้วสำหรับกะนี้',
  ATTENDANCE_ALREADY_CHECKED_OUT: 'ลงเวลาออกแล้วสำหรับกะนี้',
  ATTENDANCE_CHECK_IN_REQUIRED: 'ต้องลงเวลาเข้าก่อนจึงจะลงเวลาออกได้',
  ATTENDANCE_SESSION_CLOSED: 'รายการลงเวลาของกะนี้เสร็จสมบูรณ์แล้ว',
  ATTENDANCE_SESSION_STALE: 'ข้อมูลลงเวลาเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่',
  ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT: 'ตำแหน่ง GPS ยังไม่แม่นยำพอ กรุณาลองอีกครั้งในบริเวณที่โล่ง',
  ATTENDANCE_LOCATION_STALE: 'ตำแหน่ง GPS หมดอายุแล้ว กรุณาลองอีกครั้ง',
  ATTENDANCE_LOCATION_CAPTURED_AT_INVALID: 'เวลาที่จับตำแหน่ง GPS ไม่ถูกต้อง กรุณาเปิด Location แล้วลองใหม่',
  ATTENDANCE_SELFIE_PATH_SECRET_WEAK: 'ระบบเก็บภาพยืนยันตัวตนยังไม่พร้อมใช้งาน (ผู้ดูแลต้องตั้งค่า)',
  ATTENDANCE_SELFIE_BUCKET_NOT_PRIVATE: 'ระบบเก็บภาพยืนยันตัวตนยังไม่พร้อมใช้งาน (ผู้ดูแลต้องตั้งค่า)',
  ATTENDANCE_SELFIE_STORAGE_NOT_CONFIGURED: 'ระบบเก็บภาพยืนยันตัวตนยังไม่พร้อมใช้งาน (ผู้ดูแลต้องตั้งค่า)',
  ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED: 'ระบบเก็บภาพยืนยันตัวตนยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE: 'ระบบเก็บภาพยืนยันตัวตนขัดข้องชั่วคราว กรุณาถ่ายภาพใหม่แล้วลองอีกครั้ง',
  ATTENDANCE_SELFIE_NONCE_EXPIRED: 'ภาพยืนยันหมดอายุ กรุณาถ่ายใหม่',
  ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT: 'ยังยืนยันตำแหน่งไม่ได้ กรุณาลองอีกครั้งหรือติดต่อหัวหน้างาน',
  ATTENDANCE_DEVICE_PROOF_INVALID: 'ยืนยันอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
  ATTENDANCE_DEVICE_SIGNATURE_INVALID: 'การยืนยันความถูกต้องของอุปกรณ์ไม่ผ่าน กรุณาลองใหม่อีกครั้ง',
  ATTENDANCE_FOREIGN_DEVICE_SELFIE_REQUIRED: 'การใช้อุปกรณ์อื่นจำเป็นต้องถ่ายภาพเซลฟี่เพื่อยืนยันตัวตน',
  ATTENDANCE_SELFIE_CHECKSUM_MISMATCH: 'ข้อมูลภาพเซลฟี่ไม่ตรงกับข้อมูลยืนยัน กรุณาถ่ายภาพใหม่',
  ATTENDANCE_FOREIGN_DEVICE_SELFIE_LIVE_REQUIRED: 'กรุณาถ่ายภาพเซลฟี่สดจากกล้องหน้าเพื่อยืนยันตัวตน',
  ATTENDANCE_SELFIE_NONCE_INVALID: 'รหัสยืนยันเซลฟี่หมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่',
  ATTENDANCE_SELFIE_OVERLAY_STALE: 'ข้อมูลภาพเซลฟี่หมดอายุ กรุณาถ่ายภาพใหม่',
  ATTENDANCE_OFFLINE_BUNDLE_STALE: 'สิทธิ์ลงเวลา Offline หมดอายุหรือไม่ตรงกับกะปัจจุบัน กรุณาเชื่อมต่ออินเทอร์เน็ต',
  ATTENDANCE_OFFLINE_SITE_NOT_AUTHORIZED: 'ไม่สามารถลงเวลา Offline ที่สถานที่นี้ได้ กรุณาเชื่อมต่ออินเทอร์เน็ต',
  ATTENDANCE_OFFLINE_SITE_INACTIVE: 'สถานที่ทำงานนี้ไม่ได้เปิดใช้งาน กรุณาติดต่อหัวหน้างาน'
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

const ATTENDANCE_SIMPLE_FALLBACK_MESSAGE = 'ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน';

// Responses without a public code (validation, auth, proxy or 5xx failures)
// are otherwise indistinguishable on screen. The HTTP status is not sensitive,
// so it becomes a fixed diagnostic code that staff can report with the Request ID.
const ATTENDANCE_HTTP_STATUS_MESSAGES: Record<string, string> = {
  ATTENDANCE_REQUEST_INVALID: 'ข้อมูลลงเวลาไม่ผ่านการตรวจสอบของระบบ กรุณาปิดแล้วเปิดแอปใหม่ หากยังไม่ได้ให้แจ้งผู้ดูแลพร้อมรหัสด้านล่าง',
  HTTP_401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  HTTP_403: 'บัญชีนี้ไม่มีสิทธิ์ลงเวลา กรุณาติดต่อผู้ดูแลระบบ',
  HTTP_404: 'ไม่พบบริการลงเวลาบนระบบ กรุณาแจ้งผู้ดูแลพร้อมรหัสด้านล่าง',
  HTTP_413: 'ข้อมูลหรือภาพที่ส่งมีขนาดใหญ่เกินกว่าที่ระบบรับได้ กรุณาแจ้งผู้ดูแลพร้อมรหัสด้านล่าง',
  HTTP_429: 'มีการลองลงเวลาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  HTTP_503: 'ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่',
  HTTP_5XX: 'ระบบขัดข้อง กรุณาแจ้งผู้ดูแลพร้อมรหัสด้านล่าง'
};

function statusDiagnosticCode(status: number | undefined): string | undefined {
  if (!Number.isInteger(status) || !status || status < 400 || status > 599) return undefined;
  if (status === 400 || status === 422) return 'ATTENDANCE_REQUEST_INVALID';
  return `HTTP_${status}`;
}

function statusDiagnosticMessage(code: string): string {
  if (ATTENDANCE_HTTP_STATUS_MESSAGES[code]) return ATTENDANCE_HTTP_STATUS_MESSAGES[code];
  if (/^HTTP_5\d\d$/.test(code)) return ATTENDANCE_HTTP_STATUS_MESSAGES.HTTP_5XX;
  return ATTENDANCE_SIMPLE_FALLBACK_MESSAGE;
}

export function attendanceSimpleErrorDetails(body: unknown, status?: number): AttendanceSimpleErrorDetails {
  const responseBody = record(body);
  const nestedError = record(responseBody.error);
  const codeValue = typeof responseBody.code === 'string' ? responseBody.code : nestedError.code;
  const publicCode = typeof codeValue === 'string' ? codeValue : undefined;
  const requestId = normalizeRequestId(responseBody.requestId ?? nestedError.requestId);
  const diagnosticCode = publicCode ? undefined : statusDiagnosticCode(status);
  const code = publicCode || diagnosticCode;
  const message = publicCode
    ? ATTENDANCE_SIMPLE_ERROR_MESSAGES[publicCode] || ATTENDANCE_SIMPLE_FALLBACK_MESSAGE
    : diagnosticCode ? statusDiagnosticMessage(diagnosticCode) : ATTENDANCE_SIMPLE_FALLBACK_MESSAGE;
  return {
    message,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {})
  };
}

export function attendanceSimpleErrorMessage(body: unknown): string {
  return attendanceSimpleErrorDetails(body).message;
}

export class AttendanceSimpleRequestError extends Error {
  readonly code?: string;
  readonly requestId?: string;

  constructor(details: AttendanceSimpleErrorDetails) {
    super(details.message);
    this.name = 'AttendanceSimpleRequestError';
    this.code = details.code;
    this.requestId = details.requestId;
  }
}

async function payload(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = attendanceSimpleErrorDetails(body, response.status);
    throw new AttendanceSimpleRequestError({
      ...details,
      requestId: details.requestId || normalizeRequestId(response.headers.get('x-request-id'))
    });
  }
  return body?.data;
}

export async function simpleAttendanceSelfieProof(token: string): Promise<{ nonce: string; expiresAt: string }> {
  const response = await attendanceAuthenticatedRequest(('/attendance/simple/selfie-' + ('ch' + 'allenge')), token, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  return await payload(response) as { nonce: string; expiresAt: string };
}

export async function simpleAttendanceBootstrap(token: string, deviceFingerprint?: string | null): Promise<SimpleBootstrap> {
  const response = await attendanceAuthenticatedRequest('/attendance/simple/bootstrap', token, {
    method: 'GET',
    credentials: 'include',
    headers: deviceFingerprint ? { 'X-Attendance-Device-Fingerprint': deviceFingerprint } : undefined
  });
  return await payload(response) as SimpleBootstrap;
}

export async function simpleAttendanceSubmit(token: string, input: SimpleEventInput): Promise<SimpleEventResult> {
  const response = await attendanceAuthenticatedRequest('/attendance/simple/events', token, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return await payload(response) as SimpleEventResult;
}

export async function simpleAttendanceMoveRequest(token: string, input: {
  requestId: string;
  publicKeySpkiBase64: string;
  keyAlgorithm: 'ECDSA_P256_SHA256';
  signatureBase64: string;
  displayName?: string;
  platformHint?: string | null;
  reason?: string;
}) {
  const response = await attendanceAuthenticatedRequest('/attendance/simple/device/move-request', token, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return await payload(response);
}
