import { ApiRequestError, normalizeRequestId } from '../../api';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';
import type { PatrolCheckpoint, PatrolProgress, PatrolReport, PatrolScan } from './patrol-model';

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = normalizeRequestId(response.headers.get('x-request-id')) || normalizeRequestId(payload?.requestId);
    throw new ApiRequestError(payload?.error || fallback, response.status, requestId, payload?.details);
  }
  return payload.data as T;
}

function json(path: string, token: string, method = 'GET', body?: unknown) {
  return attendanceAuthenticatedRequest(path, token, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const patrolApi = {
  async checkpoints(token: string, manage = false) {
    return parse<PatrolCheckpoint[]>(await json(`/patrol/checkpoints${manage ? '?manage=true' : ''}`, token), 'ไม่สามารถโหลดจุดตรวจได้');
  },
  async createCheckpoint(token: string, input: { code: string; name: string; department: string; locationNote?: string; sortOrder?: number }) {
    return parse<PatrolCheckpoint>(await json('/patrol/checkpoints', token, 'POST', input), 'ไม่สามารถสร้างจุดตรวจได้');
  },
  async updateCheckpoint(token: string, id: string, input: Partial<{ name: string; department: string; locationNote: string | null; sortOrder: number; isActive: boolean }>) {
    return parse<PatrolCheckpoint>(await json(`/patrol/checkpoints/${encodeURIComponent(id)}`, token, 'PATCH', input), 'ไม่สามารถบันทึกจุดตรวจได้');
  },
  async rotateQr(token: string, id: string) {
    return parse<PatrolCheckpoint>(await json(`/patrol/checkpoints/${encodeURIComponent(id)}/rotate-qr`, token, 'POST', {}), 'ไม่สามารถออก QR ใหม่ได้');
  },
  async resolve(token: string, qrPayload: string) {
    return parse<PatrolCheckpoint>(await json('/patrol/resolve', token, 'POST', { qrPayload }), 'QR นี้ไม่ใช่จุดตรวจที่ใช้งานอยู่');
  },
  async scan(token: string, input: { qrPayload: string; clientScanId: string; latitude?: number; longitude?: number; accuracyMeters?: number; note?: string }, photo: Blob) {
    const body = new FormData();
    body.append('qrPayload', input.qrPayload);
    body.append('clientScanId', input.clientScanId);
    if (Number.isFinite(input.latitude)) body.append('latitude', String(input.latitude));
    if (Number.isFinite(input.longitude)) body.append('longitude', String(input.longitude));
    if (Number.isFinite(input.accuracyMeters)) body.append('accuracyMeters', String(Math.round(input.accuracyMeters!)));
    if (input.note?.trim()) body.append('note', input.note.trim());
    body.append('photo', photo, 'checkpoint.jpg');
    return parse<PatrolScan>(await attendanceAuthenticatedRequest('/patrol/scans', token, { method: 'POST', credentials: 'include', body }), 'บันทึกการตรวจไม่สำเร็จ');
  },
  async progress(token: string, department?: string) {
    return parse<PatrolProgress>(await json(`/patrol/progress${department ? `?department=${encodeURIComponent(department)}` : ''}`, token), 'ไม่สามารถโหลดรอบการตรวจได้');
  },
  async myScans(token: string, date?: string) {
    return parse<PatrolScan[]>(await json(`/patrol/scans/mine${date ? `?date=${encodeURIComponent(date)}` : ''}`, token), 'ไม่สามารถโหลดประวัติการตรวจได้');
  },
  async report(token: string, filters: { from: string; to: string; department?: string }) {
    const params = new URLSearchParams({ from: filters.from, to: filters.to });
    if (filters.department) params.set('department', filters.department);
    return parse<PatrolReport>(await json(`/patrol/report?${params.toString()}`, token), 'ไม่สามารถโหลดรายงานการตรวจได้');
  },
  async photoObjectUrl(token: string, photoUrl: string) {
    const path = photoUrl.replace(/^\/api\/v1/, '');
    const response = await attendanceAuthenticatedRequest(path, token, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new ApiRequestError('ไม่สามารถเปิดรูปจุดตรวจได้', response.status, normalizeRequestId(response.headers.get('x-request-id')));
    return URL.createObjectURL(await response.blob());
  }
};
