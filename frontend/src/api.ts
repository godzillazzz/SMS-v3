import { optimizeUploadFile } from './lib/attachment-optimizer';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const csrf = () => document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];

export function normalizeRequestId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function responseRequestId(response: Response, payload?: unknown) {
  const headerRequestId = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (headerRequestId) return headerRequestId;
  if (payload && typeof payload === 'object' && 'requestId' in payload) return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  return undefined;
}

export class ApiRequestError extends Error {
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(message: string, status: number, requestId?: unknown, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.requestId = normalizeRequestId(requestId);
    this.details = details;
  }
}

let isRefreshing = false;
let refreshPromise: Promise<any> | null = null;
let onTokenRefreshed: ((token: string, user: any) => void) | null = null;

export type SecuritySiteQrCredential = {
  id: string;
  securitySiteId: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type SecuritySite = {
  id: string;
  code: string;
  name: string;
  latitude: string | null;
  longitude: string | null;
  geofenceRadiusMeters: number;
  isActive: boolean;
  departmentLinks: Array<{ securitySiteId: string; departmentName: string; isDefault: boolean }>;
  currentQrCredential: SecuritySiteQrCredential | null;
  qrCredentials: SecuritySiteQrCredential[];
};

export type SecuritySiteDepartmentMapping = {
  departmentName: string;
  siteIds: string[];
  defaultSiteId: string | null;
  links: Array<{ securitySiteId: string; departmentName: string; isDefault: boolean }>;
};

export type SecuritySiteOverlapWarning = {
  siteId: string;
  otherSiteId: string;
  siteCode: string;
  otherSiteCode: string;
  distanceMeters: number;
  combinedRadiusMeters: number;
  overlapMeters: number;
};

export type SecuritySiteListResponse = {
  sites: SecuritySite[];
  overlapWarnings: SecuritySiteOverlapWarning[];
};

export type SecuritySiteInput = {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
};

export type SecuritySiteUpdateInput = Partial<SecuritySiteInput> & { isActive?: boolean };

export type SecuritySiteDepartmentMappingInput = {
  departmentName: string;
  siteIds: string[];
  defaultSiteId: string | null;
};

export type SecuritySiteQrRotateResponse = {
  credential: SecuritySiteQrCredential;
  qrToken: string;
};

export function setTokenRefreshHandler(handler: ((token: string, user: any) => void) | null) {
  onTokenRefreshed = handler;
}

async function call(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));

  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (response.status === 204) return undefined;
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !isRetry && !path.startsWith('/auth/')) {
      try {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = api.refresh().finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
        }
        const refreshResult = await refreshPromise;
        if (refreshResult?.accessToken) {
          if (onTokenRefreshed) onTokenRefreshed(refreshResult.accessToken, refreshResult.user);
          headers.set('Authorization', `Bearer ${refreshResult.accessToken}`);
          return call(path, { ...init, headers }, true);
        }
      } catch (_e) {
        throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      }
    }
    const errMessage = payload.error || (response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ');
    throw new ApiRequestError(errMessage, response.status, responseRequestId(response, payload), payload.details);
  }
  return payload;
}

async function binaryCall(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
  const headers = new Headers(init.headers);
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));

  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (!response.ok) {
    if (response.status === 401 && !isRetry && !path.startsWith('/auth/')) {
      try {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = api.refresh().finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
        }
        const refreshResult = await refreshPromise;
        if (refreshResult?.accessToken) {
          if (onTokenRefreshed) onTokenRefreshed(refreshResult.accessToken, refreshResult.user);
          headers.set('Authorization', `Bearer ${refreshResult.accessToken}`);
          return binaryCall(path, { ...init, headers }, true);
        }
      } catch (_e) {
        throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      }
    }
    const payload = await response.json().catch(() => ({}));
    throw new ApiRequestError(payload.error || 'เกิดข้อผิดพลาดในการดาวน์โหลดเอกสาร', response.status, responseRequestId(response, payload));
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return { blob: await response.blob(), fileName: encodedName ? decodeURIComponent(encodedName) : 'download' };
}
export const api = {
  login: (email: string, password: string) => call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, clientType: 'browser' }) }),
  passkeyConfig: () => call('/auth/passkeys/config'),
  getSecuritySites: (token: string) => call('/admin/security-sites', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySiteListResponse }>,
  getSecuritySiteDepartments: (token: string) => call('/admin/security-sites/departments', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySiteDepartmentMapping[] }>,
  createSecuritySite: (token: string, data: SecuritySiteInput) => call('/admin/security-sites', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySite }>,
  updateSecuritySite: (token: string, id: string, data: SecuritySiteUpdateInput) => call(`/admin/security-sites/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySite }>,
  updateSecuritySiteDepartmentMapping: (token: string, data: SecuritySiteDepartmentMappingInput) => call('/admin/security-sites/department-mapping', { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySiteDepartmentMapping }>,
  rotateSecuritySiteQr: (token: string, id: string) => call(`/admin/security-sites/${id}/qr/rotate`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySiteQrRotateResponse }>,
  revokeSecuritySiteQr: (token: string, siteId: string, credentialId: string) => call(`/admin/security-sites/${siteId}/qr/${credentialId}/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }) as Promise<{ data: SecuritySiteQrCredential }>,
  passkeyLoginOptions: () => call('/auth/passkeys/login/options', { method: 'POST', body: '{}' }),
  passkeyLoginVerify: (challengeId: string, response: unknown) => call('/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) }),
  passkeys: (token: string) => call('/auth/passkeys', { headers: { Authorization: `Bearer ${token}` } }),
  passkeyRegistrationOptions: (token: string, currentPassword: string, displayName: string) => call('/auth/passkeys/register/options', { method: 'POST', body: JSON.stringify({ currentPassword, displayName }), headers: { Authorization: `Bearer ${token}` } }),
  passkeyRegistrationVerify: (token: string, challengeId: string, response: unknown, displayName: string) => call('/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ challengeId, response, displayName }), headers: { Authorization: `Bearer ${token}` } }),
  renamePasskey: (token: string, id: string, displayName: string) => call(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ displayName }), headers: { Authorization: `Bearer ${token}` } }),
  revokePasskey: (token: string, id: string, currentPassword: string) => call(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ currentPassword }), headers: { Authorization: `Bearer ${token}` } }),
  attendanceDeviceState: (token: string) => call('/attendance/devices/me', { headers: { Authorization: `Bearer ${token}` } }),
  createAttendanceDeviceRequest: (token: string, data: { displayName: string; publicKeySpkiBase64: string; keyAlgorithm: 'ECDSA_P256_SHA256'; platformHint?: string | null; reason?: string | null }) => call('/attendance/devices/requests', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  attendanceDeviceProofOptions: (token: string, id: string) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/proof/options`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  verifyAttendanceDeviceProof: (token: string, id: string, data: { challengeId: string; challenge: string; signatureBase64: string }) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/proof/verify`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  resubmitAttendanceDeviceRequest: (token: string, id: string, reason?: string | null) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/resubmit`, { method: 'POST', body: JSON.stringify({ reason: reason || null }), headers: { Authorization: `Bearer ${token}` } }),
  cancelAttendanceDeviceRequest: (token: string, id: string, reason: string) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  attendanceDeviceRequests: (token: string, status = 'PENDING_APPROVAL') => call(`/attendance/devices/requests?status=${encodeURIComponent(status)}`, { headers: { Authorization: `Bearer ${token}` } }),
  approveAttendanceDeviceRequest: (token: string, id: string, comment?: string) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ comment: comment || null }), headers: { Authorization: `Bearer ${token}` } }),
  returnAttendanceDeviceRequest: (token: string, id: string, comment: string) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/return-for-correction`, { method: 'POST', body: JSON.stringify({ comment }), headers: { Authorization: `Bearer ${token}` } }),
  rejectAttendanceDeviceRequest: (token: string, id: string, reason: string) => call(`/attendance/devices/requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  requestRegistrationOtp: (data: { submittedName: string; email: string; password: string; departmentHint?: string }) => call('/auth/register/request-otp', { method: 'POST', body: JSON.stringify(data) }),
  verifyRegistrationOtp: (email: string, code: string) => call('/auth/register/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }),
  requestPasswordResetOtp: (email: string) => call('/auth/password-reset/request-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  completePasswordReset: (email: string, code: string, newPassword: string) => call('/auth/password-reset/complete', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) }),
  refresh: () => call('/auth/refresh', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  logout: () => call('/auth/logout', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  logoutAll: (accessToken: string) => call('/auth/logout-all', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }), headers: { Authorization: `Bearer ${accessToken}` } }),
  dashboard: (token: string, filters: { date?: string; month?: string; department?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (filters.month) params.set('month', filters.month);
    if (filters.department) params.set('department', filters.department);
    const query = params.toString();
    return call(`/dashboard${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  },
  executiveReport: (token: string, filters: { year?: number; month?: number; department?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.year) params.set('year', String(filters.year));
    if (filters.month) params.set('month', String(filters.month));
    if (filters.department) params.set('department', filters.department);
    const query = params.toString();
    return call(`/executive-report${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  },
  employees: (token: string) => call('/employees?page=1&pageSize=100', { headers: { Authorization: `Bearer ${token}` } }),
  licenses: (token: string, page = 1, employeeStatus: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE') => call(`/licenses?page=${page}&pageSize=500&employeeStatus=${employeeStatus}`, { headers: { Authorization: `Bearer ${token}` } }),
  shiftTypes: (token: string) => call('/shift-types', { headers: { Authorization: `Bearer ${token}` } }),
  createShiftType: (token: string, data: unknown) => call('/shift-types', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateShiftType: (token: string, id: string, data: unknown) => call(`/shift-types/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  deleteShiftType: (token: string, id: string) => call(`/shift-types/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  shifts: (token: string, page = 1) => call(`/shifts?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  scheduleCalendar: (token: string, month: string, page = 1, department = '') => call(`/schedule-calendar?month=${encodeURIComponent(month)}&page=${page}&pageSize=20${department ? `&department=${encodeURIComponent(department)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
  previewAutoSchedule: (token: string, month: string) => call('/schedule/auto-preview', { method: 'POST', body: JSON.stringify({ month }), headers: { Authorization: `Bearer ${token}` } }),
  commitAutoSchedule: (token: string, month: string) => call('/schedule/auto-commit', { method: 'POST', body: JSON.stringify({ month }), headers: { Authorization: `Bearer ${token}` } }),
  previewEmployeeAutoSchedule: (token: string, month: string, employeeId: string, startPhase = 'AUTO', patternType = 'AUTO') => call('/schedule/employee-auto-preview', { method: 'POST', body: JSON.stringify({ month, employeeId, startPhase, patternType }), headers: { Authorization: `Bearer ${token}` } }),
  commitEmployeeAutoSchedule: (token: string, month: string, employeeId: string, startPhase = 'AUTO', patternType = 'AUTO') => call('/schedule/employee-auto-commit', { method: 'POST', body: JSON.stringify({ month, employeeId, startPhase, patternType }), headers: { Authorization: `Bearer ${token}` } }),
  exportScheduleExcel: (token: string, data: { month: string; scope: 'selected' | 'all'; departments: string[] }) => binaryCall('/schedule/export.xlsx', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }),
  scheduleApprovals: (token: string, page = 1) => call(`/schedule-approvals?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  schedulingRules: (token: string) => call('/scheduling-rules', { headers: { Authorization: `Bearer ${token}` } }),
  ruleChecks: (token: string, month: string) => call(`/rule-checks?month=${encodeURIComponent(month)}`, { headers: { Authorization: `Bearer ${token}` } }),
  systemSettings: (token: string) => call('/system-settings', { headers: { Authorization: `Bearer ${token}` } }),
  updateSystemSetting: (token: string, key: string, data: unknown) => call(`/system-settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  leaveRequests: (token: string, page = 1, filters: { year?: number; month?: number; status?: string; employeeId?: string; department?: string; search?: string } = {}) => { const params = new URLSearchParams({ page: String(page), pageSize: '100' }); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); }); return call(`/leave-requests?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }); },
  leavePendingCount: (token: string) => call('/leave-requests/pending-count', { headers: { Authorization: `Bearer ${token}` } }),
  leaveSummary: (token: string, year?: number) => call(`/leave-summary${year ? `?year=${year}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
  leaveQuotas: (token: string, page = 1, filters: { year?: number; legacy?: boolean } = {}) => { const params = new URLSearchParams({ page: String(page), pageSize: '100' }); if (filters.year) params.set('year', String(filters.year)); if (filters.legacy) params.set('legacy', 'true'); return call(`/leave-quotas?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }); },
  createLeaveQuota: (token: string, data: { employeeId: string; quotaYear: number; sickLeave: number; personalLeave: number; vacationLeave: number }) => call('/leave-quotas', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  users: (token: string) => call('/users', { headers: { Authorization: `Bearer ${token}` } }),
  registrationRequests: (token: string, status?: string) => call(`/registration-requests?page=1&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
  registrationCandidates: (token: string, id: string, search = '') => call(`/registration-requests/${encodeURIComponent(id)}/candidates${search ? `?search=${encodeURIComponent(search)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
  matchRegistrationRequest: (token: string, id: string, employeeId: string) => call(`/registration-requests/${encodeURIComponent(id)}/match`, { method: 'POST', body: JSON.stringify({ employeeId }), headers: { Authorization: `Bearer ${token}` } }),
  approveRegistrationRequest: (token: string, id: string) => call(`/registration-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  rejectRegistrationRequest: (token: string, id: string, reason: string) => call(`/registration-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  auditEvents: (token: string, page = 1, pageSize = 25, filters: { dateFrom?: string; dateTo?: string; actor?: string; entityType?: string; action?: string; search?: string; category?: string } = {}) => { const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); return call(`/audit-events?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }); },
  dataQualityIssues: (token: string, page = 1, pageSize = 25, filters: { severity?: string; module?: string; rule?: string; department?: string; search?: string } = {}) => { const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); return call(`/data-quality/issues?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }); },
  reportSummary: (token: string) => call('/reports/summary', { headers: { Authorization: `Bearer ${token}` } }),
  createEmployee: (token: string, data: unknown) => call('/employees', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateEmployee: (token: string, id: string, data: unknown) => call(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  personnelMasters: (token: string, activeOnly = true) => call(`/personnel-masters?activeOnly=${activeOnly ? 'true' : 'false'}`, { headers: { Authorization: `Bearer ${token}` } }),
  createPersonnelMaster: (token: string, kind: 'department' | 'position', data: unknown) => call(`/personnel-masters/${kind}`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }),
  personnelMasterImpact: (token: string, kind: 'department' | 'position', id: string) => call(`/personnel-masters/${kind}/${encodeURIComponent(id)}/impact`, { headers: { Authorization: `Bearer ${token}` } }),
  updatePersonnelMaster: (token: string, kind: 'department' | 'position', id: string, data: unknown) => call(`/personnel-masters/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }),
  employeeChangeRequests: (token: string, employeeId: string) => call(`/employees/${encodeURIComponent(employeeId)}/change-requests`, { headers: { Authorization: `Bearer ${token}` } }),
  employeeReferencePhotos: (token: string, employeeId: string) => call(`/employee-reference-photos/employee/${encodeURIComponent(employeeId)}`, { headers: { Authorization: `Bearer ${token}` } }),
  uploadEmployeeReferencePhoto: async (token: string, employeeId: string, photo: File) => { const optimized = await optimizeUploadFile(photo, 'EMPLOYEE_REFERENCE_PHOTO'); const body = new FormData(); body.append('photo', optimized); return callMultipart(`/employee-reference-photos/employee/${encodeURIComponent(employeeId)}`, token, body); },
  viewEmployeeReferencePhoto: (token: string, id: string) => call(`/employee-reference-photos/${encodeURIComponent(id)}/view`, { headers: { Authorization: `Bearer ${token}` } }),
  approveEmployeeReferencePhoto: (token: string, id: string) => call(`/employee-reference-photos/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  rejectEmployeeReferencePhoto: (token: string, id: string, reason: string) => call(`/employee-reference-photos/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  cancelEmployeeReferencePhoto: (token: string, id: string) => call(`/employee-reference-photos/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  preflightEmployeeMasterEdit: (token: string, employeeId: string, data: unknown) => call(`/employees/${encodeURIComponent(employeeId)}/master-edit/preflight`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createEmployeeChangeDraft: (token: string, employeeId: string, data: unknown) => call(`/employees/${encodeURIComponent(employeeId)}/change-requests`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  employeeChangeRequestQueue: (token: string, status?: string) => call(`/employee-change-requests?page=1&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
  employeeChangeRequest: (token: string, id: string) => call(`/employee-change-requests/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }),
  saveEmployeeChangeDraft: (token: string, id: string, data: unknown) => call(`/employee-change-requests/${encodeURIComponent(id)}/draft`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  submitEmployeeChangeRequest: (token: string, id: string, idempotencyKey: string) => call(`/employee-change-requests/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify({ idempotencyKey }), headers: { Authorization: `Bearer ${token}` } }),
  resubmitEmployeeChangeRequest: (token: string, id: string, idempotencyKey: string) => call(`/employee-change-requests/${encodeURIComponent(id)}/resubmit`, { method: 'POST', body: JSON.stringify({ idempotencyKey }), headers: { Authorization: `Bearer ${token}` } }),
  cancelEmployeeChangeRequest: (token: string, id: string, idempotencyKey: string, reason?: string) => call(`/employee-change-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ idempotencyKey, ...(reason ? { reason } : {}) }), headers: { Authorization: `Bearer ${token}` } }),
  approveEmployeeChangeRequest: (token: string, id: string, idempotencyKey: string, acknowledgeWarnings = false) => call(`/employee-change-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ idempotencyKey, acknowledgeWarnings }), headers: { Authorization: `Bearer ${token}` } }),
  returnEmployeeChangeRequest: (token: string, id: string, comment: string, idempotencyKey: string) => call(`/employee-change-requests/${encodeURIComponent(id)}/return-for-correction`, { method: 'POST', body: JSON.stringify({ comment, idempotencyKey }), headers: { Authorization: `Bearer ${token}` } }),
  rejectEmployeeChangeRequest: (token: string, id: string, reason: string, idempotencyKey: string) => call(`/employee-change-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason, idempotencyKey }), headers: { Authorization: `Bearer ${token}` } }),
  deleteEmployee: (token: string, id: string) => call(`/employees/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  employeeLifecycleHistory: (token: string, id: string, page = 1) => call(`/employees/${id}/lifecycle?page=${page}&pageSize=50`, { headers: { Authorization: `Bearer ${token}` } }),
  employeeLifecycleState: (token: string, id: string, date: string) => call(`/employees/${id}/lifecycle/state?date=${encodeURIComponent(date)}`, { headers: { Authorization: `Bearer ${token}` } }),
  preflightEmployeeLifecycle: (token: string, id: string, data: unknown) => call(`/employees/${id}/lifecycle/preflight`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createEmployeeLifecycleEvent: (token: string, id: string, data: unknown) => call(`/employees/${id}/lifecycle`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createLicense: (token: string, data: unknown) => call('/licenses', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateLicense: (token: string, id: string, data: unknown) => call(`/licenses/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  deleteLicense: (token: string, id: string) => call(`/licenses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  licenseDocuments: (token: string, licenseId: string) => call(`/licenses/${licenseId}/documents`, { headers: { Authorization: `Bearer ${token}` } }),
  uploadLicenseDocument: async (token: string, licenseId: string, data: { licenseNumber: string; proposedStartDate: string; proposedExpiryDate: string; note?: string }, document: File) => { const optimized = await optimizeUploadFile(document, 'DOCUMENT'); const body = new FormData(); body.append('licenseNumber', data.licenseNumber); body.append('proposedStartDate', data.proposedStartDate); body.append('proposedExpiryDate', data.proposedExpiryDate); if (data.note) body.append('note', data.note); body.append('document', optimized); return callMultipart(`/licenses/${licenseId}/documents`, token, body); },
  viewLicenseDocument: (token: string, documentId: string) => call(`/license-documents/${documentId}/view`, { headers: { Authorization: `Bearer ${token}` } }),
  approveLicenseDocument: (token: string, documentId: string) => call(`/license-documents/${documentId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
  returnLicenseDocumentForCorrection: (token: string, documentId: string, correctionReason: string) => call(`/license-documents/${documentId}/return-for-correction`, { method: 'POST', body: JSON.stringify({ correctionReason }), headers: { Authorization: `Bearer ${token}` } }),
  resubmitLicenseDocument: async (token: string, documentId: string, data: { licenseNumber: string; proposedStartDate: string; proposedExpiryDate: string; note?: string }, document?: File) => { const optimized = document ? await optimizeUploadFile(document, 'DOCUMENT') : undefined; const body = new FormData(); body.append('licenseNumber', data.licenseNumber); body.append('proposedStartDate', data.proposedStartDate); body.append('proposedExpiryDate', data.proposedExpiryDate); if (data.note) body.append('note', data.note); if (optimized) body.append('document', optimized); return callMultipart(`/license-documents/${documentId}/resubmit`, token, body); },
  rejectLicenseDocument: (token: string, documentId: string, rejectionReason: string) => call(`/license-documents/${documentId}/reject`, { method: 'POST', body: JSON.stringify({ rejectionReason }), headers: { Authorization: `Bearer ${token}` } }),
  cancelLicenseDocument: (token: string, documentId: string) => call(`/license-documents/${documentId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
  permanentlyDeleteLicenseDocument: (token: string, documentId: string) => call(`/license-documents/${documentId}/permanent`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  createShift: (token: string, data: unknown) => call('/shifts', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateShift: (token: string, id: string, data: unknown) => call(`/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  batchSaveShifts: (token: string, changes: Array<{ action: 'create' | 'update' | 'delete'; id?: string; payload?: unknown }>) => {
    const isUuid = (v?: string) => Boolean(v && typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
    const deletes = changes.filter((c) => c.action === 'delete' && isUuid(c.id));
    const upserts = changes
      .filter((c) => c.action !== 'delete')
      .map((c) => {
        const p = (c.payload as Record<string, unknown>) || {};
        return {
          employeeId: String(p.employeeId || ''),
          shiftTypeId: String(p.shiftTypeId || ''),
          workDate: String(p.workDate || '').slice(0, 10),
          remark: String(p.remark || ''),
          licenseOverride: Boolean(p.licenseOverride),
          overrideReason: String(p.overrideReason || '')
        };
      })
      .filter((item) => isUuid(item.employeeId) && isUuid(item.shiftTypeId) && item.workDate.length === 10);

    const tasks: Promise<unknown>[] = [];
    if (upserts.length > 0) {
      tasks.push(call('/schedules/batch', {
        method: 'POST',
        body: JSON.stringify({ assignments: upserts }),
        headers: { Authorization: `Bearer ${token}` }
      }));
    }
    for (const del of deletes) {
      tasks.push(api.deleteShift(token, del.id!));
    }
    return Promise.all(tasks);
  },
  deleteShift: (token: string, id: string) => call(`/shifts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  updateScheduleApproval: (token: string, id: string, data: unknown) => call(`/schedule-approvals/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  approveScheduleMonth: (token: string, month: string) => call('/schedule/approve-month', { method: 'POST', body: JSON.stringify({ month }), headers: { Authorization: `Bearer ${token}` } }),
  updateSchedulingRule: (token: string, id: string, data: unknown) => call(`/scheduling-rules/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createLeaveRequest: (token: string, data: unknown) => call('/leave-requests', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createLeaveRequestWithAttachment: async (token: string, data: Record<string, string>, attachment: File) => { const optimized = await optimizeUploadFile(attachment, 'DOCUMENT'); const body = new FormData(); Object.entries(data).forEach(([key, value]) => { if (value) body.append(key, value); }); body.append('attachment', optimized); return callMultipart('/leave-requests/with-attachment', token, body); },
  downloadLeaveAttachment: (token: string, id: string) => binaryCall(`/leave-requests/${id}/attachment`, { headers: { Authorization: `Bearer ${token}` } }),
  updateLeaveRequest: (token: string, id: string, data: unknown) => call(`/leave-requests/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
returnLeaveRequestForCorrection: (token: string, id: string, reason: string) => call(`/leave-requests/${id}/return-for-correction`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  updateReturnedLeaveRequest: (token: string, id: string, data: unknown) => call(`/leave-requests/${id}/correction`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  resubmitLeaveRequest: (token: string, id: string) => call(`/leave-requests/${id}/resubmit`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  cancelLeaveRequest: (token: string, id: string, reason?: string) => call(`/leave-requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } }),
  updateLeaveQuota: (token: string, id: string, data: unknown) => call(`/leave-quotas/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  linkLeaveQuota: (token: string, id: string, employeeId: string, quotaYear: number) => call(`/leave-quotas/${id}/link`, { method: 'PUT', body: JSON.stringify({ employeeId, quotaYear }), headers: { Authorization: `Bearer ${token}` } }),
  updateUser: (token: string, id: string, data: unknown) => call(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  resetUserPassword: (token: string, id: string, newPassword: string) => call(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }), headers: { Authorization: `Bearer ${token}` } }),
  viewAsUser: (token: string, id: string) => call(`/users/${id}/view-as`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } }),
  shiftsList: (token: string) => call('/shifts', { headers: { Authorization: `Bearer ${token}` } }),
  schedulesGetGrid: (token: string, month: string) => call(`/schedules?month=${encodeURIComponent(month)}`, { headers: { Authorization: `Bearer ${token}` } }),
  schedulesSaveBatch: (token: string, assignments: unknown[]) => call('/schedules/batch', { method: 'POST', body: JSON.stringify({ assignments }), headers: { Authorization: `Bearer ${token}` } }),
  schedulesAutoPlan: (token: string, month: string) => call('/schedules/auto-plan', { method: 'POST', body: JSON.stringify({ month }), headers: { Authorization: `Bearer ${token}` } }),
  schedulesApprove: (token: string, month: string, note?: string) => call('/schedules/approve', { method: 'POST', body: JSON.stringify({ month, note }), headers: { Authorization: `Bearer ${token}` } })
};

async function callMultipart(path: string, token: string, body: FormData) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', body, credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(payload.error || 'Request failed.', response.status, responseRequestId(response, payload));
  return payload;
}
