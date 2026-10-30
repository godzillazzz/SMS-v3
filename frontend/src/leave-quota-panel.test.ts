import { describe, expect, it } from 'vitest';
import { leaveQuotaRows } from './leave-quota-panel';

describe('leave quota panel', () => {
  it('uses the three real quota buckets and preserves missing values', () => {
    expect(leaveQuotaRows({ entitlement: { sickLeave: 30 }, used: { sickLeave: 5 }, remaining: { sickLeave: 25 } })).toEqual([
      { label: 'ลาป่วย', entitlement: 30, used: 5, remaining: 25, percent: 83.33333333333334 },
      { label: 'ลากิจ', entitlement: null, used: null, remaining: null, percent: null },
      { label: 'ลาพักร้อน', entitlement: null, used: null, remaining: null, percent: null }
    ]);
  });
  it('never invents a bar for absent or zero entitlement', () => {
    expect(leaveQuotaRows({ entitlement: { sickLeave: 0 }, remaining: { sickLeave: 0 } })[0].percent).toBeNull();
  });
});
