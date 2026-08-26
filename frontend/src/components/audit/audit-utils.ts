import type { AuditEvent } from './audit-types';

const sensitiveFragments = ['password', 'secret', 'token', 'authorization', 'cookie', 'otp', 'apikey', 'jwt', 'refresh', 'access', 'database', 'connection', 'storagekey', 'signedurl'];
const actionLabels: Record<string, string> = { CREATE: 'สร้างรายการ', UPDATE: 'แก้ไขรายการ', DELETE: 'ลบรายการ', LOGIN: 'เข้าสู่ระบบ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ', REFRESH: 'ต่ออายุเซสชัน', LOGOUT: 'ออกจากระบบ', LOGOUT_ALL: 'ออกจากทุกอุปกรณ์', TOKEN_REUSE: 'ตรวจพบการใช้โทเค็นซ้ำ' };
const moduleLabels: Record<string, string> = { LEAVE: 'การลา', LICENSE: 'ใบอนุญาต', SCHEDULE: 'ตารางกะ', USER_ACCESS: 'ผู้ใช้และสิทธิ์', QUOTA: 'โควต้าวันลา', SYSTEM: 'ระบบ', OTHER: 'อื่น ๆ' };
const entityLabels: Record<string, string> = { Employee: 'พนักงาน', EmployeeLifecycleEvent: 'ประวัติวงจรพนักงาน', EmployeeLicense: 'ใบอนุญาตพนักงาน', EmployeeReferencePhoto: 'รูปอ้างอิงพนักงาน', EmployeeLicenseDocument: 'เอกสารใบอนุญาต', LeaveRequest: 'คำขอลา', LeaveQuota: 'โควต้าวันลา', ShiftAssignment: 'รายการกะ', ShiftType: 'ประเภทกะ', ScheduleApproval: 'การอนุมัติตาราง', SchedulingRule: 'กฎการทำงาน', User: 'ผู้ใช้', UserCredential: 'ข้อมูลรับรองผู้ใช้', ViewAsSession: 'ดูแทนผู้ใช้', SystemSetting: 'การตั้งค่าระบบ' };

export const safe = (value: unknown, fallback = 'ไม่ระบุ') => value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);

export function formatAuditTime(value: unknown) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 'ไม่ระบุเวลา' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(parsed);
}

export function actionLabel(value: unknown) { return actionLabels[safe(value, '')] || safe(value); }
export function moduleLabel(value: unknown) { return moduleLabels[safe(value, '')] || safe(value); }
export function entityLabel(value: unknown) { return entityLabels[safe(value, '')] || safe(value); }

export function isSensitiveMetadataKey(key: unknown) {
  const normalized = String(key || '').toLowerCase().replace(/[_-]/g, '');
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

export function safeMetadataEntries(value: unknown, depth = 0): Array<[string, string]> {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]): Array<[string, string]> => {
    if (isSensitiveMetadataKey(key)) return [[key, '[REDACTED]']];
    if (nested && typeof nested === 'object') return safeMetadataEntries(nested, depth + 1).map(([childKey, childValue]): [string, string] => [`${key}.${childKey}`, childValue]);
    const text = safe(nested, '-');
    return [[key, text.length > 180 ? `${text.slice(0, 180)}…` : text]];
  }).slice(0, 24);
}

export function eventLabel(row: AuditEvent) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
  const event = typeof metadata.event === 'string' ? metadata.event.replace(/_/g, ' ') : '';
  return event ? `${actionLabel(row.action)} · ${event}` : actionLabel(row.action);
}

export function metadataSummary(value: unknown) {
  const entries = safeMetadataEntries(value);
  if (!entries.length) return 'ไม่มีรายละเอียดเพิ่มเติม';
  return entries.slice(0, 2).map(([key, nested]) => `${key}: ${nested}`).join(' · ');
}

export function filterAuditEvents(rows: AuditEvent[], search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) => [row.action, row.entityType, row.entityId, row.module, row.actor?.displayName, row.actor?.role].map((value) => String(value ?? '')).join(' ').toLowerCase().includes(term));
}

export function summarizeAuditEvents(rows: AuditEvent[]) {
  return { categories: new Set(rows.map((row) => `${String(row.action || '')}:${String(row.entityType || '')}`)).size, actors: new Set(rows.map((row) => `${String(row.actor?.displayName || '')}:${String(row.actor?.role || '')}`)).size };
}
