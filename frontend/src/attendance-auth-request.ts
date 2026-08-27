import { api } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const csrf = () => document.cookie.split('; ').find((item) => item.startsWith('smsv3_csrf='))?.split('=')[1];

let refreshPromise: Promise<any> | null = null;
let onAttendanceTokenRefreshed: ((token: string, user: any) => void) | null = null;
let attendanceTokenRefreshGuard: ((requestToken: string) => boolean) | null = null;

export function setAttendanceTokenRefreshHandler(handler: ((token: string, user: any) => void) | null) {
  onAttendanceTokenRefreshed = handler;
}

export function setAttendanceTokenRefreshGuard(guard: ((requestToken: string) => boolean) | null) {
  attendanceTokenRefreshGuard = guard;
}

export async function attendanceAuthenticatedRequest(
  path: string,
  token: string,
  init: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const csrfToken = csrf();
  if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));

  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (response.status !== 401 || isRetry || path.startsWith('/auth/')) return response;
  if (!attendanceTokenRefreshGuard || attendanceTokenRefreshGuard(token) !== true) return response;

  try {
    if (!refreshPromise) {
      refreshPromise = api.refresh().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshResult = await refreshPromise;
    if (!refreshResult?.accessToken) return response;
    if (onAttendanceTokenRefreshed) {
      onAttendanceTokenRefreshed(refreshResult.accessToken, refreshResult.user);
    }
    return attendanceAuthenticatedRequest(path, refreshResult.accessToken, init, true);
  } catch (_error) {
    return response;
  }
}
