import { describe, expect, it } from 'vitest';
import { filterAuditEvents, summarizeAuditEvents } from './audit-utils';
const rows = [
  { id: 'review-a', action: 'LOGIN', entityType: 'User', createdAt: '2026-01-01T00:00:00Z', actor: { displayName: 'ผู้ตรวจสอบตัวอย่าง', role: 'ADMIN' } },
  { id: 'review-b', action: 'UPDATE', entityType: 'Employee', createdAt: '2026-01-02T00:00:00Z', actor: { displayName: 'ผู้ตรวจสอบตัวอย่าง', role: 'ADMIN' } },
  { id: 'review-c', action: 'LOGIN', entityType: 'User', createdAt: '2026-01-03T00:00:00Z', actor: { displayName: 'ผู้จัดการตัวอย่าง', role: 'MANAGER' } }
];
describe('audit presentation utilities', () => {
  it('filters only the currently loaded page', () => { expect(filterAuditEvents(rows, 'employee')).toHaveLength(1); expect(filterAuditEvents(rows, '')).toHaveLength(3); });
  it('counts safe page-level categories and actors', () => { expect(summarizeAuditEvents(rows)).toEqual({ categories: 2, actors: 2 }); });
});
