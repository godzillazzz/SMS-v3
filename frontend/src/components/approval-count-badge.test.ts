import { approvalCountsFromSummary } from '../approval-count-summary';
import { describe, expect, it } from 'vitest';
import { approvalBadgeText, approvalCountValue, approvalMenuCount, approvalNotificationLabel } from './approval-count-badge';

const emptyByType = {
  EMPLOYEE_MASTER_CHANGE: 0,
  EMPLOYEE_REFERENCE_PHOTO: 0,
  LICENSE_DOCUMENT: 0,
  SCHEDULE_APPROVAL: 0,
  ATTENDANCE_DEVICE_REQUEST: 0,
  ATTENDANCE_ADJUSTMENT_REQUEST: 0,
  REGISTRATION_REQUEST: 0,
  USER_ACCESS: 0,
  LEAVE_REQUEST: 0
};

describe('approval count badge presentation', () => {
  it('does not show a badge or a zero label before the first summary value', () => {
    expect(approvalCountValue(undefined)).toBeNull();
    expect(approvalCountValue(null)).toBeNull();
    expect(approvalCountValue('')).toBeNull();
    expect(approvalCountValue(0)).toBe(0);
    expect(approvalBadgeText(null)).toBeUndefined();
    expect(approvalNotificationLabel(null)).toBe('เปิดศูนย์อนุมัติ');
  });

  it('keeps zero badges hidden after loading and caps large values', () => {
    expect(approvalBadgeText(0)).toBeUndefined();
    expect(approvalNotificationLabel(0)).toBe('คำขออนุมัติ 0 รายการ');
    expect(approvalBadgeText(1)).toBe('1');
    expect(approvalBadgeText(120)).toBe('99+');
  });

  it('maps permission-scoped backend types to their native menus without double counting', () => {
    const byType = {
      ...emptyByType,
      EMPLOYEE_MASTER_CHANGE: 2,
      EMPLOYEE_REFERENCE_PHOTO: 3,
      LICENSE_DOCUMENT: 5,
      SCHEDULE_APPROVAL: 7,
      ATTENDANCE_DEVICE_REQUEST: 11,
      ATTENDANCE_ADJUSTMENT_REQUEST: 13,
      REGISTRATION_REQUEST: 17,
      USER_ACCESS: 19,
      LEAVE_REQUEST: 23
    };
    const summary = approvalCountsFromSummary({ total: 100, byType });

    expect(summary).not.toBeNull();
    expect(approvalMenuCount('approvalCenter', summary)).toBe(100);
    expect(approvalMenuCount('employees', summary)).toBe(5);
    expect(approvalMenuCount('licenses', summary)).toBe(5);
    expect(approvalMenuCount('approvals', summary)).toBe(7);
    expect(approvalMenuCount('attendanceDevice', summary)).toBe(11);
    expect(approvalMenuCount('attendanceSupervisor', summary)).toBe(13);
    expect(approvalMenuCount('users', summary)).toBe(36);
    expect(approvalMenuCount('leavePending', summary)).toBe(23);
    expect(approvalMenuCount('unmapped', summary)).toBeNull();
  });

  it('accepts a complete zero summary and rejects missing, failed, or inconsistent data', () => {
    expect(approvalCountsFromSummary({ total: 0, byType: emptyByType })?.total).toBe(0);
    expect(approvalCountsFromSummary(undefined)).toBeNull();
    expect(approvalCountsFromSummary({ total: 0, byType: {} })).toBeNull();
    expect(approvalCountsFromSummary({ total: 1, byType: emptyByType })).toBeNull();
    expect(approvalCountsFromSummary({ total: 0.5, byType: { ...emptyByType, LEAVE_REQUEST: 0.5 } })).toBeNull();
    expect(approvalCountsFromSummary({ total: 1, byType: { ...emptyByType, LEAVE_REQUEST: true } })).toBeNull();
    expect(approvalCountValue(false)).toBeNull();
    expect(approvalCountValue([])).toBeNull();
  });

  it('shows exact values through 99 and caps larger menu totals', () => {
    const one = approvalCountsFromSummary({ total: 1, byType: { ...emptyByType, LEAVE_REQUEST: 1 } });
    const ninetyNine = approvalCountsFromSummary({ total: 99, byType: { ...emptyByType, EMPLOYEE_MASTER_CHANGE: 99 } });
    const oneHundred = approvalCountsFromSummary({ total: 100, byType: { ...emptyByType, EMPLOYEE_MASTER_CHANGE: 100 } });
    expect(approvalBadgeText(approvalMenuCount('leavePending', one))).toBe('1');
    expect(approvalBadgeText(approvalMenuCount('employees', ninetyNine))).toBe('99');
    expect(approvalBadgeText(approvalMenuCount('employees', oneHundred))).toBe('99+');
  });
});
