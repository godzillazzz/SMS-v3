import { attendanceAuthenticatedRequest } from './attendance-auth-request';

export type AttendanceSelfiePolicy = { role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER'; clockInRequired: boolean; clockOutRequired: boolean; updatedAt?: string | null };

async function read(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.message || 'ไม่สามารถอ่านนโยบาย Selfie ได้');
  return body?.data;
}
export async function loadAttendanceSelfiePolicies(token: string): Promise<AttendanceSelfiePolicy[]> {
  return await read(await attendanceAuthenticatedRequest('/operations/attendance/selfie-policies', token, { credentials: 'include' }));
}
export async function saveAttendanceSelfiePolicy(token: string, policy: AttendanceSelfiePolicy): Promise<AttendanceSelfiePolicy> {
  return await read(await attendanceAuthenticatedRequest(`/operations/attendance/selfie-policies/${policy.role}`, token, {
    method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clockInRequired: policy.clockInRequired, clockOutRequired: policy.clockOutRequired })
  }));
}
