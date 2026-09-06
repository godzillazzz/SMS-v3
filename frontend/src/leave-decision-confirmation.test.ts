import { describe, expect, it } from 'vitest';
import { leaveDecisionPresentation } from './components/LeaveDecisionConfirmation';

describe('Leave decision confirmation contract', () => {
  it('keeps approval decisions explicit and reason-free', () => {
    expect(leaveDecisionPresentation('approve')).toMatchObject({
      tone: 'success',
      requiresReason: false,
      confirmLabel: 'ยืนยันอนุมัติคำขอ'
    });
    expect(leaveDecisionPresentation('reject')).toMatchObject({
      tone: 'danger',
      requiresReason: false,
      confirmLabel: 'ยืนยันไม่อนุมัติ'
    });
  });

  it('keeps return and cancellation decisions reason-required', () => {
    expect(leaveDecisionPresentation('return')).toMatchObject({
      tone: 'warning',
      requiresReason: true,
      reasonLabel: 'ระบุเหตุผลที่ส่งกลับไปแก้ไข (จำเป็น)'
    });
    expect(leaveDecisionPresentation('cancel', 'APPROVED')).toMatchObject({
      tone: 'danger',
      requiresReason: true,
      reasonLabel: 'ระบุเหตุผลการยกเลิกใบลาที่อนุมัติแล้ว (จำเป็น)'
    });
    expect(leaveDecisionPresentation('cancel', 'PENDING')).toMatchObject({
      tone: 'danger',
      requiresReason: true,
      reasonLabel: 'ระบุเหตุผลการยกเลิกคำขอ (จำเป็น)'
    });
  });
});
