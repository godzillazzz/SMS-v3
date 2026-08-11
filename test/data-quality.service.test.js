const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildRuleDefinitions,
  dataQualityQuery,
  getDataQualityIssues
} = require('../src/services/data-quality.service');

function fakeClient(rowsByModel) {
  const calls = [];
  const client = {};
  for (const [modelName, rows] of Object.entries(rowsByModel)) {
    client[modelName] = {
      count: async (options) => { calls.push({ modelName, method: 'count', options }); return rows.length; },
      findMany: async (options) => { calls.push({ modelName, method: 'findMany', options }); return rows.slice(options.skip || 0, (options.skip || 0) + options.take); }
    };
  }
  return { client, calls };
}

test('data quality query is bounded and defaults to page 1/pageSize 25', () => {
  const parsed = dataQualityQuery.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, DEFAULT_PAGE_SIZE);
  assert.throws(() => dataQualityQuery.parse({ pageSize: MAX_PAGE_SIZE + 1 }));
  assert.throws(() => dataQualityQuery.parse({ severity: 'LOW' }));
});

test('rule definitions use existing quota statuses and non-overlapping license windows', () => {
  const rules = buildRuleDefinitions({}, new Date('2026-08-11T04:00:00.000Z'));
  assert.deepEqual(rules.map((rule) => rule.name), [
    'LEAVE_QUOTA_UNMATCHED',
    'LICENSE_EXPIRED',
    'LICENSE_EXPIRING_WITHIN_30_DAYS',
    'LICENSE_EXPIRING_31_TO_90_DAYS'
  ]);
  assert.deepEqual(rules[0].where().matchStatus, { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] });
  assert.deepEqual(rules[2].where().proposedExpiryDate, { gte: new Date('2026-08-11T00:00:00.000Z'), lte: new Date('2026-09-10T00:00:00.000Z') });
  assert.deepEqual(rules[3].where().proposedExpiryDate, { gt: new Date('2026-09-10T00:00:00.000Z'), lte: new Date('2026-11-09T00:00:00.000Z') });
});

test('summary and issue ordering are deterministic across rule severities', async () => {
  const { client, calls } = fakeClient({
    leaveQuota: [
      { id: 'quota-1', employeeNameSnapshot: 'A', matchStatus: 'UNMATCHED', employee: null },
      { id: 'quota-2', employeeNameSnapshot: 'B', matchStatus: 'DUPLICATE_UNMATCHED', employee: null }
    ],
    employeeLicenseDocument: [
      { id: 'license-1', employeeId: 'employee-1', proposedExpiryDate: new Date('2026-08-01T00:00:00.000Z'), employee: { employeeCode: 'E1', firstName: 'A', lastName: 'One', displayName: 'A One', department: 'North' } }
    ]
  });
  const result = await getDataQualityIssues({ prismaClient: client, query: {}, now: new Date('2026-08-11T04:00:00.000Z') });
  assert.deepEqual(result.summary, { total: 5, critical: 3, warning: 1, info: 1 });
  assert.equal(result.data.length, 5);
  assert.equal(result.data[0].severity, 'CRITICAL');
  assert.equal(new Set(result.data.map((issue) => issue.id)).size, result.data.length);
  assert.ok(calls.every((call, index) => call.method !== 'findMany' || calls[index - 1]?.method === 'count' || calls[index - 1]?.method === 'findMany'));
});

test('server-side filters are applied to rule definitions and no write methods are used', async () => {
  const { client, calls } = fakeClient({ leaveQuota: [], employeeLicenseDocument: [] });
  const result = await getDataQualityIssues({ prismaClient: client, query: { severity: 'WARNING', module: 'LICENSE', page: 2, pageSize: 50, department: 'North', search: 'E-1' } });
  assert.equal(result.meta.page, 2);
  assert.equal(result.meta.pageSize, 50);
  assert.equal(calls.length, 1);
  assert.ok(calls.every((call) => call.method === 'count'));
  const rules = buildRuleDefinitions({ severity: 'WARNING', module: 'LICENSE', department: 'North', search: 'E-1' });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].where().employee, { is: { deletedAt: null, department: 'North', OR: [
    { employeeCode: { contains: 'E-1', mode: 'insensitive' } },
    { firstName: { contains: 'E-1', mode: 'insensitive' } },
    { lastName: { contains: 'E-1', mode: 'insensitive' } },
    { displayName: { contains: 'E-1', mode: 'insensitive' } },
    { department: { contains: 'E-1', mode: 'insensitive' } }
  ] } });
});
