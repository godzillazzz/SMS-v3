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

export async function getApprovalCenterSummary(token: string) {
  return approvalCenterRequest(token, '/approval-center/summary');
}

export async function getApprovalCenter(token: string) {
  return approvalCenterRequest(token, '/approval-center?limit=100');
}
