import { attendanceAuthenticatedRequest } from '../attendance-auth-request';
import type {
  SecuritySite,
  SecuritySiteDepartmentMapping,
  SecuritySiteInput,
  SecuritySiteListResponse,
  SecuritySiteQrCredential,
  SecuritySiteQrRotateResponse,
  SecuritySiteUpdateInput
} from '../api';

function csrfToken() {
  const encoded = document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

function headers(token: string, json = false) {
  const result = new Headers({ Authorization: `Bearer ${token}` });
  if (json) result.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) result.set('X-CSRF-Token', csrf);
  return result;
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await attendanceAuthenticatedRequest(path, token, { credentials: 'include', ...init });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error || 'Security Site operation failed.');
  return payload.data as T;
}

export const securitySiteOperations = {
  list: (token: string) => request<SecuritySiteListResponse>('/admin/security-sites', token, { headers: headers(token) }),
  departments: (token: string) => request<SecuritySiteDepartmentMapping[]>('/admin/security-sites/departments', token, { headers: headers(token) }),
  create: (token: string, data: SecuritySiteInput) => request<SecuritySite>('/admin/security-sites', token, { method: 'POST', headers: headers(token, true), body: JSON.stringify(data) }),
  update: (token: string, id: string, data: SecuritySiteUpdateInput) => request<SecuritySite>(`/admin/security-sites/${encodeURIComponent(id)}`, token, { method: 'PUT', headers: headers(token, true), body: JSON.stringify(data) }),
  duplicate: (token: string, id: string, data: { code: string; name?: string }) => request<SecuritySite>(`/admin/security-sites/${encodeURIComponent(id)}/duplicate`, token, { method: 'POST', headers: headers(token, true), body: JSON.stringify(data) }),
  rotateQr: (token: string, id: string, reason: string) => request<SecuritySiteQrRotateResponse>(`/admin/security-sites/${encodeURIComponent(id)}/qr/rotate`, token, { method: 'POST', headers: headers(token, true), body: JSON.stringify({ reason }) }),
  revokeQr: (token: string, siteId: string, credentialId: string, reason: string) => request<SecuritySiteQrCredential>(`/admin/security-sites/${encodeURIComponent(siteId)}/qr/${encodeURIComponent(credentialId)}/revoke`, token, { method: 'POST', headers: headers(token, true), body: JSON.stringify({ reason }) })
};
