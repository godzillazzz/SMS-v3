import { describe, expect, it } from 'vitest';
import { thaiErrorMessage } from './error-messages-th';
import { safeUserErrorMessage } from './request-error';

describe('Thai wording for English backend errors (audit X-01)', () => {
  it('translates known messages exactly', () => {
    expect(thaiErrorMessage('Invalid email or password.')).toContain('เข้าสู่ระบบไม่สำเร็จ');
    expect(thaiErrorMessage('ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN')).toContain('3 วัน');
  });
  it('falls back to a Thai category for unknown but recognisable messages', () => {
    expect(thaiErrorMessage('Widget not found.')).toContain('ไม่พบข้อมูล');
    expect(thaiErrorMessage('Only ADMIN may approve this thing.')).toContain('ไม่มีสิทธิ์');
  });
  it('leaves Thai and unrecognised text untouched', () => {
    expect(thaiErrorMessage('บันทึกไม่สำเร็จ')).toBe('บันทึกไม่สำเร็จ');
    expect(thaiErrorMessage('Something specific happened')).toBe('Something specific happened');
  });
  it('is applied by the shared safe message helper and keeps technical text hidden', () => {
    expect(safeUserErrorMessage('Leave type not found.')).toBe('ไม่พบประเภทการลานี้ หรือถูกปิดใช้งาน');
    expect(safeUserErrorMessage('prisma error', 'fallback')).toBe('fallback');
  });
});
