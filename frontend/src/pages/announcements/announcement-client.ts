import { ApiRequestError, normalizeRequestId } from '../../api';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';

export type AnnouncementCategory = 'GENERAL' | 'POLICY' | 'EVENT';
export type Announcement = {
  id: string; title: string; body: string; category: AnnouncementCategory; pinned: boolean; showPopup?: boolean;
  hasImage?: boolean; imageUrl?: string | null;
  expiresAt: string | null; expiresOn: string | null; expired: boolean; createdAt: string; updatedAt: string | null;
};
export type AnnouncementInput = { title: string; body: string; category: AnnouncementCategory; pinned: boolean; showPopup?: boolean; expiresOn: string | null };

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = { GENERAL: 'ทั่วไป', POLICY: 'นโยบาย', EVENT: 'กิจกรรม' };
export const ANNOUNCEMENT_CATEGORIES = Object.keys(ANNOUNCEMENT_CATEGORY_LABELS) as AnnouncementCategory[];
export const ANNOUNCEMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function announcementDateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+07:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(date);
}

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

export type AnnouncementClient = {
  list(token: string, query?: { limit?: number; includeExpired?: boolean }): Promise<Announcement[]>;
  popups?(token: string): Promise<Announcement[]>;
  create(token: string, input: AnnouncementInput): Promise<Announcement>;
  update(token: string, id: string, input: Partial<AnnouncementInput>): Promise<Announcement>;
  remove(token: string, id: string): Promise<unknown>;
  uploadImage?(token: string, id: string, file: File): Promise<Announcement>;
  removeImage?(token: string, id: string): Promise<Announcement>;
  imageObjectUrl?(token: string, imageUrl: string): Promise<string>;
};

export const announcementClient: Required<AnnouncementClient> = {
  async list(token, query = {}) {
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.includeExpired) params.set('includeExpired', 'true');
    const suffix = params.toString();
    return (await parse<Announcement[]>(await json(`/announcements${suffix ? `?${suffix}` : ''}`, token), 'โหลดประกาศไม่สำเร็จ')) || [];
  },
  async popups(token) { return (await parse<Announcement[]>(await json('/announcements/popups', token), 'โหลดประกาศไม่สำเร็จ')) || []; },
  async create(token, input) { return parse<Announcement>(await json('/announcements', token, 'POST', input), 'บันทึกประกาศไม่สำเร็จ'); },
  async update(token, id, input) { return parse<Announcement>(await json(`/announcements/${encodeURIComponent(id)}`, token, 'PATCH', input), 'บันทึกประกาศไม่สำเร็จ'); },
  async remove(token, id) { return parse(await json(`/announcements/${encodeURIComponent(id)}`, token, 'DELETE'), 'ลบประกาศไม่สำเร็จ'); },
  async uploadImage(token, id, file) {
    const body = new FormData();
    body.append('image', file, file.name || 'announcement');
    return parse<Announcement>(await attendanceAuthenticatedRequest(`/announcements/${encodeURIComponent(id)}/image`, token, { method: 'PUT', credentials: 'include', body }), 'อัปโหลดรูปไม่สำเร็จ');
  },
  async removeImage(token, id) { return parse<Announcement>(await json(`/announcements/${encodeURIComponent(id)}/image`, token, 'DELETE'), 'ลบรูปไม่สำเร็จ'); },
  async imageObjectUrl(token, imageUrl) {
    const response = await attendanceAuthenticatedRequest(imageUrl.replace(/^\/api\/v1/, ''), token, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new ApiRequestError('เปิดรูปประกาศไม่สำเร็จ', response.status, normalizeRequestId(response.headers.get('x-request-id')));
    return URL.createObjectURL(await response.blob());
  }
};
