import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function csrf() {
  return document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
}

async function approvalCenterRequest(token: string, path: string) {
  const headers = new Headers({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' });
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  const response = await fetch(baseUrl + path, { credentials: 'include', headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers.get('x-request-id')) || normalizeRequestId(payload?.requestId);
    const message = payload?.error || (response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'ไม่สามารถอ่านคำขออนุมัติได้');
    throw new ApiRequestError(message, response.status, requestId, payload?.details);
  }
  return payload;
}

// One auth scope, bounded memory, and a short lifetime for authoritative reads.
const APPROVAL_CENTER_TTL_MS = 2000;
type ApprovalCenterEntry = { token: string; expiresAt: number; promise: ReturnType<typeof approvalCenterRequest> };
let summaryEntry: ApprovalCenterEntry | undefined;
let listEntry: ApprovalCenterEntry | undefined;

function getCachedApprovalCenterRead(
  token: string,
  path: string,
  current: () => ApprovalCenterEntry | undefined,
  replace: (entry: ApprovalCenterEntry | undefined) => void,
  options: { forceRefresh?: boolean } = {}
) {
  if (options.forceRefresh) replace(undefined);
  const cached = current();
  if (cached?.token === token && cached.expiresAt > Date.now()) return cached.promise;
  const entry: ApprovalCenterEntry = { token, expiresAt: Infinity, promise: approvalCenterRequest(token, path) };
  // Readers of a superseded request follow the newest generation, so a slow
  // pre-refresh response cannot overwrite a forced refresh result.
  entry.promise = entry.promise.then(
    result => current() !== entry && current()?.token === token ? current()!.promise : result,
    error => {
      if (current() !== entry && current()?.token === token) return current()!.promise;
      throw error;
    }
  );
  replace(entry);
  void entry.promise.then(() => {
    if (current() === entry) entry.expiresAt = Date.now() + APPROVAL_CENTER_TTL_MS;
  }, () => {
    if (current() === entry) replace(undefined);
  });
  return entry.promise;
}

export function invalidateApprovalCenterSummary(): void {
  summaryEntry = undefined;
}

export function invalidateApprovalCenterList(): void {
  listEntry = undefined;
}

export function invalidateApprovalCenter(): void {
  invalidateApprovalCenterSummary();
  invalidateApprovalCenterList();
}

export function getApprovalCenterSummary(token: string, options: { forceRefresh?: boolean } = {}) {
  return getCachedApprovalCenterRead(token, '/approval-center/summary', () => summaryEntry, entry => { summaryEntry = entry; }, options);
}

export function getApprovalCenter(token: string, options: { forceRefresh?: boolean } = {}) {
  return getCachedApprovalCenterRead(token, '/approval-center?limit=100', () => listEntry, entry => { listEntry = entry; }, options);
}

export function getApprovalCenterItem(token: string, type: string, requestId: string) {
  return approvalCenterRequest(token, `/approval-center/items/${encodeURIComponent(type)}/${encodeURIComponent(requestId)}`);
}
