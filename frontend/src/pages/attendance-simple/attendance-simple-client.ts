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

const ATTENDANCE_SIMPLE_ERROR_MESSAGES: Record<string, string> = {
  ATTENDANCE_CHECK_IN_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาเข้า',
  ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาเข้าได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
  ATTENDANCE_CHECK_OUT_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาออก',
  ATTENDANCE_CHECK_OUT_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาออกได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
  ATTENDANCE_OUTSIDE_SITE_GEOFENCE: 'ไม่สามารถลงเวลาได้ เนื่องจากอยู่นอกพื้นที่ทำงานที่กำหนด',
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
  ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT: 'ยังยืนยันตำแหน่งไม่ได้ กรุณาลองอีกครั้งหรือติดต่อหัวหน้างาน',
  ATTENDANCE_DEVICE_PROOF_INVALID: 'ยืนยันอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
  ATTENDANCE_OFFLINE_BUNDLE_STALE: 'สิทธิ์ลงเวลา Offline หมดอายุหรือไม่ตรงกับกะปัจจุบัน กรุณาเชื่อมต่ออินเทอร์เน็ต',
  ATTENDANCE_OFFLINE_SITE_NOT_AUTHORIZED: 'ไม่สามารถลงเวลา Offline ที่สถานที่นี้ได้ กรุณาเชื่อมต่ออินเทอร์เน็ต',
  ATTENDANCE_OFFLINE_SITE_INACTIVE: 'สถานที่ทำงานนี้ไม่ได้เปิดใช้งาน กรุณาติดต่อหัวหน้างาน'
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function attendanceSimpleErrorDetails(body: unknown): AttendanceSimpleErrorDetails {
  const responseBody = record(body);
  const nestedError = record(responseBody.error);
  const codeValue = typeof responseBody.code === 'string' ? responseBody.code : nestedError.code;
  const code = typeof codeValue === 'string' ? codeValue : undefined;
  const requestId = normalizeRequestId(responseBody.requestId ?? nestedError.requestId);
  return {
    message: (code && ATTENDANCE_SIMPLE_ERROR_MESSAGES[code]) || 'ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน',
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
    const details = attendanceSimpleErrorDetails(body);
    throw new AttendanceSimpleRequestError({
      ...details,
      requestId: details.requestId || normalizeRequestId(response.headers.get('x-request-id'))
    });
  }
  return body?.data;
}

export async function simpleAttendanceBootstrap(token: string): Promise<SimpleBootstrap> {
  const response = await attendanceAuthenticatedRequest('/attendance/simple/bootstrap', token, {
    method: 'GET',
    credentials: 'include'
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
  reason: string;
}) {
  const response = await attendanceAuthenticatedRequest('/attendance/simple/device/move-request', token, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return await payload(response);
}
