const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const csrf = () => document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (response.status === 204) return undefined;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}
export const api = {
  login: (email: string, password: string) => call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, clientType: 'browser' }) }),
  refresh: () => call('/auth/refresh', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  logout: () => call('/auth/logout', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  logoutAll: (accessToken: string) => call('/auth/logout-all', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }), headers: { Authorization: `Bearer ${accessToken}` } }),
  employees: (token: string) => call('/employees?page=1&pageSize=100', { headers: { Authorization: `Bearer ${token}` } }),
  licenses: (token: string, page = 1) => call(`/licenses?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  shifts: (token: string, page = 1) => call(`/shifts?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  scheduleApprovals: (token: string, page = 1) => call(`/schedule-approvals?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  schedulingRules: (token: string) => call('/scheduling-rules', { headers: { Authorization: `Bearer ${token}` } }),
  leaveRequests: (token: string, page = 1) => call(`/leave-requests?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  leaveQuotas: (token: string, page = 1) => call(`/leave-quotas?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  users: (token: string) => call('/users', { headers: { Authorization: `Bearer ${token}` } }),
  auditEvents: (token: string, page = 1) => call(`/audit-events?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }),
  reportSummary: (token: string) => call('/reports/summary', { headers: { Authorization: `Bearer ${token}` } }),
  createEmployee: (token: string, data: unknown) => call('/employees', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateEmployee: (token: string, id: string, data: unknown) => call(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  deleteEmployee: (token: string, id: string) => call(`/employees/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  createLicense: (token: string, data: unknown) => call('/licenses', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateLicense: (token: string, id: string, data: unknown) => call(`/licenses/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  deleteLicense: (token: string, id: string) => call(`/licenses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  createShift: (token: string, data: unknown) => call('/shifts', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateShift: (token: string, id: string, data: unknown) => call(`/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  deleteShift: (token: string, id: string) => call(`/shifts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  updateScheduleApproval: (token: string, id: string, data: unknown) => call(`/schedule-approvals/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateSchedulingRule: (token: string, id: string, data: unknown) => call(`/scheduling-rules/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  createLeaveRequest: (token: string, data: unknown) => call('/leave-requests', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateLeaveRequest: (token: string, id: string, data: unknown) => call(`/leave-requests/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateLeaveQuota: (token: string, id: string, data: unknown) => call(`/leave-quotas/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  updateUser: (token: string, id: string, data: unknown) => call(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
  resetUserPassword: (token: string, id: string, newPassword: string) => call(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }), headers: { Authorization: `Bearer ${token}` } })
};
