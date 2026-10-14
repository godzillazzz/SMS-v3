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

// One auth scope, bounded memory, and a short lifetime for authoritative counts.
const SUMMARY_TTL_MS = 2000;
let summaryEntry: { token: string; expiresAt: number; promise: ReturnType<typeof approvalCenterRequest> } | undefined;

export function invalidateApprovalCenterSummary(): void {
  summaryEntry = undefined;
}

export function getApprovalCenterSummary(token: string, options: { forceRefresh?: boolean } = {}) {
  if (options.forceRefresh) invalidateApprovalCenterSummary();
  if (summaryEntry?.token === token && summaryEntry.expiresAt > Date.now()) return summaryEntry.promise;
  const entry = { token, expiresAt: Infinity, promise: approvalCenterRequest(token, '/approval-center/summary') };
  // Readers of a superseded request follow the new generation too, so a slow
  // pre-mutation response cannot overwrite freshly refreshed global counts.
  entry.promise = entry.promise.then(
    result => summaryEntry !== entry && summaryEntry?.token === token ? summaryEntry.promise : result,
    error => {
      if (summaryEntry !== entry && summaryEntry?.token === token) return summaryEntry.promise;
      throw error;
    }
  );
  summaryEntry = entry;
  void entry.promise.then(() => {
    if (summaryEntry === entry) entry.expiresAt = Date.now() + SUMMARY_TTL_MS;
  }, () => {
    if (summaryEntry === entry) invalidateApprovalCenterSummary();
  });
  return entry.promise;
}

export async function getApprovalCenter(token: string) {
  return approvalCenterRequest(token, '/approval-center?limit=100');
}
