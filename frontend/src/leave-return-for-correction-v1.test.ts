import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const main = fs.readFileSync(path.join(root, 'main.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api.ts'), 'utf8');

describe('Leave Return for Correction V1 frontend', () => {
  it('presents three distinct reviewer decisions with semantic action styles', () => {
    expect(main).toContain('อนุมัติคำขอ');
    expect(main).toContain('ส่งกลับไปแก้ไข');
    expect(main).toContain('ไม่อนุมัติ');
    expect(main).toContain('className="btn-success"');
    expect(main).toContain('className="btn-warning"');
    expect(main).toContain('className="btn-danger-outline"');
  });

  it('shows returned owners both edit/resubmit and cancel choices', () => {
    expect(main).toContain('แก้ไขและส่งตรวจสอบอีกครั้ง');
    expect(main).toContain('ยกเลิกคำขอ');
    expect(main).toContain("row.status === 'RETURNED_FOR_CORRECTION' && row.canEditReturned");
    expect(main).toContain("row.status === 'RETURNED_FOR_CORRECTION' && row.canCancelReturned");
  });

  it('uses the same LeaveRequest id for correction followed by resubmit', () => {
    expect(api).toContain('updateReturnedLeaveRequest');
    expect(api).toContain('/correction`');
    expect(api).toContain('resubmitLeaveRequest');
    expect(api).toContain('/resubmit`');
    expect(main).toContain("api.updateReturnedLeaveRequest(auth.token!, String(row.id), form)");
    expect(main).toContain("api.resubmitLeaveRequest(auth.token!, String(row.id))");
  });

  it('requires a visible reason before return or cancellation', () => {
    expect(main).toContain("['return', 'cancel'].includes(action)");
    expect(main).toContain('ระบุเหตุผลที่ส่งกลับไปแก้ไข (จำเป็น)');
    expect(main).toContain('ระบุเหตุผลการยกเลิกใบลาที่อนุมัติแล้ว (จำเป็น)');
    expect(main).toContain('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
  });

  it('distinguishes returned request cancellation from approved Admin cancellation', () => {
    expect(main).toContain('ยกเลิกใบลาที่อนุมัติแล้ว');
    expect(main).toContain("row.status === 'APPROVED' && canCancelApprovedLeave");
    expect(main).toContain("row.status === 'RETURNED_FOR_CORRECTION' && row.canCancelReturned");
  });

  it('shows the return reason and actor in history views', () => {
    expect(main).toContain('row.returnReason');
    expect(main).toContain('row.returnedByDisplayName');
    expect(main).toContain('เหตุผลที่ส่งกลับ');
  });
});