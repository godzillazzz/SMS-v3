import { describe, expect, it } from 'vitest';
import { countLicenseBuckets, licenseBuckets } from './license-buckets';

const now = new Date('2026-10-25T03:00:00Z');
describe('W-08 license buckets', () => {
  it('splits expiry into 0-30, 31-90 and expired using whole days', () => {
    expect([...licenseBuckets({ expiryDate: '2026-11-24', status: 'ACTIVE' }, now)]).toEqual(['ALL', 'EXP_30']);
    expect([...licenseBuckets({ expiryDate: '2026-11-25', status: 'ACTIVE' }, now)]).toEqual(['ALL', 'EXP_90']);
    expect([...licenseBuckets({ expiryDate: '2027-01-24', status: 'ACTIVE' }, now)]).toEqual(['ALL']);
    expect([...licenseBuckets({ expiryDate: '2026-10-24', status: 'ACTIVE' }, now)]).toEqual(['ALL', 'EXPIRED']);
    expect(licenseBuckets({ expiryDate: '2027-05-01', status: 'EXPIRED' }, now).has('EXPIRED')).toBe(true);
  });
  it('reads document review state from the existing documentSummary', () => {
    expect(licenseBuckets({ documentSummary: { state: 'CURRENT_WITH_PENDING' } }, now).has('DOC_PENDING')).toBe(true);
    expect(licenseBuckets({ documentSummary: { state: 'RETURNED_FOR_CORRECTION' } }, now).has('DOC_RETURNED')).toBe(true);
  });
  it('counts every row once per bucket', () => {
    const counts = countLicenseBuckets([{ expiryDate: '2026-11-01' }, { expiryDate: '2026-09-01' }, { expiryDate: '2028-01-01' }], now);
    expect(counts).toMatchObject({ ALL: 3, EXP_30: 1, EXPIRED: 1, EXP_90: 0 });
  });
});
