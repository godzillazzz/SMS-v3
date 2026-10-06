import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canDecideScheduleApproval,
  isSupersededScheduleApproval,
  scheduleApprovalChangeTypeLabel,
  scheduleApprovalErrorMessage,
  scheduleApprovalStatusLabel,
  scheduleApprovalTone
} from './approval-display';

describe('schedule approval presentation and decision guard', () => {
  it('normalizes known statuses and keeps unknown values out of the UI', () => {
    expect(scheduleApprovalStatusLabel('Pending')).toBe('รออนุมัติ');
    expect(scheduleApprovalStatusLabel('APPROVED')).toBe('อนุมัติแล้ว');
    expect(scheduleApprovalStatusLabel('REJECTED')).toBe('ไม่อนุมัติ');
    expect(scheduleApprovalStatusLabel('DRAFT')).toBe('ฉบับร่าง');
    expect(scheduleApprovalStatusLabel('CANCELLED')).toBe('ยกเลิก');
    expect(scheduleApprovalStatusLabel('UNRECOGNIZED_ENUM')).toBe('อื่น ๆ');
  });

  it('shows older pending revisions as superseded and allows decisions only on the latest pending revision', () => {
    expect(isSupersededScheduleApproval({ status: 'PENDING', isLatestRevision: false })).toBe(true);
    expect(scheduleApprovalStatusLabel('PENDING', true)).toBe('ถูกแทนที่');
    expect(canDecideScheduleApproval({ status: 'PENDING', isLatestRevision: false })).toBe(false);
    expect(canDecideScheduleApproval({ status: 'APPROVED', isLatestRevision: true })).toBe(false);
    expect(canDecideScheduleApproval({ status: 'REJECTED', isLatestRevision: true })).toBe(false);
    expect(canDecideScheduleApproval({ status: 'PENDING', isLatestRevision: true })).toBe(true);
    expect(canDecideScheduleApproval({ status: 'PENDING' })).toBe(false);
  });

  it('maps change types, badge tones, and state-guard errors to Thai labels', () => {
    expect(scheduleApprovalChangeTypeLabel('batch_update_shift')).toBe('แก้ไขกะหลายรายการ');
    expect(scheduleApprovalChangeTypeLabel('AUTO_SCHEDULE_EMPLOYEE')).toBe('จัดกะอัตโนมัติ');
    expect(scheduleApprovalChangeTypeLabel('UNKNOWN_CHANGE')).toBe('อื่น ๆ');
    expect(scheduleApprovalTone('APPROVED')).toBe('success');
    expect(scheduleApprovalTone('PENDING')).toBe('warning');
    expect(scheduleApprovalTone('SUPERSEDED')).toBe('neutral');
    expect(scheduleApprovalErrorMessage('SCHEDULE_APPROVAL_INVALID_STATE')).toContain('สถานะรออนุมัติ');
    expect(scheduleApprovalErrorMessage('SCHEDULE_APPROVAL_SUPERSEDED')).toBe('รายการนี้มีฉบับที่ใหม่กว่าแล้ว จึงดำเนินการต่อไม่ได้');
    expect(scheduleApprovalErrorMessage('SCHEDULE_REJECTION_REASON_REQUIRED')).toContain('เหตุผล');
  });

  it('wires the latest-revision guard, Thai display map, and required rejection reason into the UI', () => {
    const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(main).toContain('canDecideScheduleApproval(row)');
    expect(main).toContain('canDecideScheduleApproval(selectedRow)');
    expect(main).toContain('scheduleApprovalStatusLabel(row.status, superseded)');
    expect(main).toContain('scheduleApprovalChangeTypeLabel(row.changeType)');
    expect(main).toContain("const isScheduleRejection = activePage === 'approvals' && action === 'reject';");
    expect(main).toContain('const confirmed = isScheduleRejection ? true : await actionDialog.confirm({');
    expect(main).toContain('minLength: 5');
    expect(main).toContain('approvalNote');
  });
});
