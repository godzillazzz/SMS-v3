process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unclassifiedRows,
  duplicateAnnualRows,
  ambiguousCrossYearRows
} = require('../src/services/annual-leave-data-quality.service');

test('annual quota data-quality signals are bounded and PII-free', async () => {
  const client = {
    leaveQuota: {
      findMany: async () => [{ id: 'legacy-null-year', matchStatus: 'MATCHED' }],
      groupBy: async () => [{ employeeId: 'not-returned', quotaYear: 2027, _count: { _all: 2 } }]
    },
    leaveRequest: {
      findMany: async () => [{ id: 'legacy-cross-year', startDate: new Date('2026-12-30T00:00:00Z'), endDate: new Date('2027-01-05T00:00:00Z'), dayCount: 5 }]
    }
  };
  const issues = [
    ...(await unclassifiedRows(client)),
    ...(await duplicateAnnualRows(client)),
    ...(await ambiguousCrossYearRows(client))
  ];
  assert.deepEqual(issues.map((row) => row.rule), [
    'LEAVE_QUOTA_YEAR_UNCLASSIFIED',
    'LEAVE_QUOTA_ANNUAL_DUPLICATE',
    'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT'
  ]);
  for (const issue of issues) {
    assert.equal(issue.employeeCode, null);
    assert.equal(issue.employeeName, null);
    assert.equal(issue.department, null);
    assert.equal(Object.values(issue).includes('not-returned'), false);
  }
});
