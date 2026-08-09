import { describe, expect, it } from 'vitest';
import { actionLabel, filterAuditEvents, formatAuditTime, isSensitiveMetadataKey, safeMetadataEntries, summarizeAuditEvents } from './audit-utils';
const rows = [
  { id: 'review-a', action: 'LOGIN', entityType: 'User', createdAt: '2026-01-01T00:00:00Z', actor: { displayName: 'ผู้ตรวจสอบตัวอย่าง', role: 'ADMIN' } },
  { id: 'review-b', action: 'UPDATE', entityType: 'Employee', createdAt: '2026-01-02T00:00:00Z', actor: { displayName: 'ผู้ตรวจสอบตัวอย่าง', role: 'ADMIN' } },
  { id: 'review-c', action: 'LOGIN', entityType: 'User', createdAt: '2026-01-03T00:00:00Z', actor: { displayName: 'ผู้จัดการตัวอย่าง', role: 'MANAGER' } }
];
describe('audit presentation utilities', () => {
  it('filters only the currently loaded page', () => { expect(filterAuditEvents(rows, 'employee')).toHaveLength(1); expect(filterAuditEvents(rows, '')).toHaveLength(3); });
  it('counts safe page-level categories and actors', () => { expect(summarizeAuditEvents(rows)).toEqual({ categories: 2, actors: 2 }); });
  it('formats Bangkok timestamps and redacts sensitive metadata before presentation', () => {
    expect(formatAuditTime('2026-08-10T00:30:00.000Z')).toContain('2569');
    expect(actionLabel('LOGIN_FAILED')).toBe('เข้าสู่ระบบไม่สำเร็จ');
    expect(isSensitiveMetadataKey('refresh_token')).toBe(true);
    expect(safeMetadataEntries({ note: 'safe', nested: { password: 'never-show' } })).toEqual([['note', 'safe'], ['nested.password', '[REDACTED]']]);
  });
});
