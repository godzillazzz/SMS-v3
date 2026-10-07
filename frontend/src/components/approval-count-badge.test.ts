import { describe, expect, it } from 'vitest';
import { approvalBadgeText, approvalCountValue, approvalNotificationLabel } from './approval-count-badge';

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
});
