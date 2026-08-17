process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nativeUsageByQuotaYear,
  persistedUsageByQuotaYear,
  AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT
} = require('../src/services/leave-annual-accounting.service');
const { ANNUAL_LEAVE_ENTITLEMENT, bangkokQuotaYear, validateQuotaYear } = require('../src/services/annual-leave-quota.service');

test('annual policy is 30/3/6', () => {
  assert.deepEqual(ANNUAL_LEAVE_ENTITLEMENT, { sickLeave: 30, personalLeave: 3, vacationLeave: 6 });
});

test('quota year validation accepts Gregorian year and rejects invalid values', () => {
  assert.equal(validateQuotaYear(2027), 2027);
  for (const value of [1999, 2201, 2027.5, 'not-year']) assert.throws(() => validateQuotaYear(value));
});

test('Bangkok quota year changes at Bangkok midnight', () => {
  assert.equal(bangkokQuotaYear(new Date('2026-12-31T16:59:59.000Z')), 2026);
  assert.equal(bangkokQuotaYear(new Date('2026-12-31T17:00:00.000Z')), 2027);
});

test('native same-year allocation uses inclusive calendar days', () => {
  assert.deepEqual(nativeUsageByQuotaYear('2026-01-01', '2026-01-03'), { 2026: 3 });
});

test('native cross-year allocation is 2 days in 2026 and 5 in 2027', () => {
  assert.deepEqual(nativeUsageByQuotaYear('2026-12-30', '2027-01-05'), { 2026: 2, 2027: 5 });
});

test('Dec31/Jan1 and leap dates remain inclusive with no weekend exclusion', () => {
  assert.deepEqual(nativeUsageByQuotaYear('2026-12-31', '2027-01-01'), { 2026: 1, 2027: 1 });
  assert.deepEqual(nativeUsageByQuotaYear('2028-02-28', '2028-03-01'), { 2028: 3 });
});

test('same-year persisted fractional day count is preserved', () => {
  assert.deepEqual(persistedUsageByQuotaYear({ startDate: '2026-06-01', endDate: '2026-06-01', dayCount: 0.5 }), { 2026: 0.5 });
});

test('same-year persisted non-span total is preserved', () => {
  assert.deepEqual(persistedUsageByQuotaYear({ startDate: '2026-06-01', endDate: '2026-06-03', dayCount: 2 }), { 2026: 2 });
});

test('cross-year persisted total equal to native total allocates safely', () => {
  assert.deepEqual(persistedUsageByQuotaYear({ startDate: '2026-12-30', endDate: '2027-01-05', dayCount: 7 }), { 2026: 2, 2027: 5 });
});

test('cross-year persisted mismatch and fractional total fail closed', () => {
  for (const dayCount of [5, 6.5]) {
    assert.throws(
      () => persistedUsageByQuotaYear({ id: 'legacy-cross-year', startDate: '2026-12-30', endDate: '2027-01-05', dayCount }),
      (error) => error.statusCode === 409 && error.details?.code === AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT
    );
  }
});
