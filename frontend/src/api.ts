const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const csrf = () => document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(csrf() && { 'X-CSRF-Token': decodeURIComponent(csrf()!) }), ...init.headers }, ...init });
  if (response.status === 204) return undefined;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}
export const api = {
  login: (email: string, password: string) => call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, clientType: 'browser' }) }),
  refresh: () => call('/auth/refresh', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  logout: () => call('/auth/logout', { method: 'POST', body: JSON.stringify({ clientType: 'browser' }) }),
  employees: (token: string) => call('/employees', { headers: { Authorization: `Bearer ${token}` } })
};
