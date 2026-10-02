import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

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

export function attendanceSimpleErrorMessage(body: unknown): string {
  const responseBody = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const error = responseBody.error && typeof responseBody.error === 'object'
    ? responseBody.error as Record<string, unknown>
    : {};
  const code = typeof error.code === 'string' ? error.code : '';
  const messages: Record<string, string> = {
    ATTENDANCE_CHECK_IN_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาเข้า',
    ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาเข้าได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
    ATTENDANCE_CHECK_OUT_TOO_EARLY: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาออก',
    ATTENDANCE_CHECK_OUT_LATEST_WINDOW_EXCEEDED: 'ไม่สามารถลงเวลาออกได้ เนื่องจากเกินช่วงเวลาที่กำหนด',
    ATTENDANCE_OUTSIDE_SITE_GEOFENCE: 'ไม่สามารถลงเวลาได้ เนื่องจากอยู่นอกพื้นที่ทำงานที่กำหนด',
    ATTENDANCE_ASSIGNMENT_REQUIRED: 'ไม่พบกะงานที่ได้รับอนุมัติ',
    ATTENDANCE_SCHEDULE_NOT_APPROVED: 'ไม่พบกะงานที่ได้รับอนุมัติ'
  };
  if (messages[code]) return messages[code];
  if (typeof error.message === 'string') return error.message;
  return typeof responseBody.message === 'string' ? responseBody.message : 'ไม่สามารถส่งคำขอลงเวลาได้';
}

async function payload(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(attendanceSimpleErrorMessage(body));
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
