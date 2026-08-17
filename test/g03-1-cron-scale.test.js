process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { provisionAnnualLeaveQuotas } = require('../src/services/annual-leave-quota-cron.service');

function fakePrisma(employeeCount = 250) {
  const employees = Array.from({ length: employeeCount }, (_, index) => ({ id: `employee-${String(index + 1).padStart(4, '0')}` }));
  const quotas = new Map();
  const audits = [];
  let pageReads = 0;
  let transactions = 0;
  const root = {
    employee: {
      findMany: async ({ take, cursor }) => {
        pageReads += 1;
        const start = cursor ? employees.findIndex((row) => row.id === cursor.id) + 1 : 0;
        return employees.slice(start, start + take);
      }
    },
    leaveQuota: {
      findUnique: async ({ where }) => quotas.get(`${where.employeeId_quotaYear.employeeId}:${where.employeeId_quotaYear.quotaYear}`) || null
    },
    $transaction: async (callback) => {
      transactions += 1;
      const tx = {
        employee: {
          findFirst: async ({ where }) => employees.find((row) => row.id === where.id) || null
        },
        leaveQuota: {
          findUnique: async ({ where }) => quotas.get(`${where.employeeId_quotaYear.employeeId}:${where.employeeId_quotaYear.quotaYear}`) || null,
          findMany: async () => [],
          createMany: async ({ data }) => {
            const row = data[0];
            const key = `${row.employeeId}:${row.quotaYear}`;
            if (quotas.has(key)) return { count: 0 };
            quotas.set(key, { id: `quota-${key}`, ...row });
            return { count: 1 };
          }
        },
        auditLog: {
          create: async ({ data }) => { audits.push(data); return data; }
        }
      };
      return callback(tx);
    }
  };
  return { root, quotas, audits, stats: () => ({ pageReads, transactions }) };
}

test('annual cron provisions 250 employees in bounded pages and reruns without resetting rows', async () => {
  const fixture = fakePrisma(250);
  const now = new Date('2026-12-31T17:00:00.000Z');
  const first = await provisionAnnualLeaveQuotas({ prismaClient: fixture.root, now, batchSize: 50 });
  assert.deepEqual(first, { eligible: 250, created: 250, existing: 0, ambiguous: 0, failed: 0, quotaYear: 2027 });
  assert.equal(fixture.quotas.size, 250);
  assert.equal(fixture.audits.length, 250);
  assert.equal(fixture.stats().pageReads, 6);
  assert.equal(fixture.stats().transactions, 250);

  const customKey = 'employee-0001:2027';
  fixture.quotas.get(customKey).vacationLeave = 10;
  const second = await provisionAnnualLeaveQuotas({ prismaClient: fixture.root, now, batchSize: 50 });
  assert.deepEqual(second, { eligible: 250, created: 0, existing: 250, ambiguous: 0, failed: 0, quotaYear: 2027 });
  assert.equal(fixture.quotas.get(customKey).vacationLeave, 10);
  assert.equal(fixture.audits.length, 250, 'rerun emits no duplicate create audits');
  assert.equal(fixture.stats().transactions, 500);
});
