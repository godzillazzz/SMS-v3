'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runPreflight, safeEvidence } = require('../scripts/ci/g03-1-auth-persona-preflight');

const EMAILS = Object.freeze({
  ADMIN: 'admin@example.test',
  MANAGER: 'manager@example.test',
  VIEWER: 'viewer@example.test'
});

function environment() {
  return Object.fromEntries(Object.entries(EMAILS).map(([role, email]) => [`UAT_${role}_EMAIL`, email]));
}

function fakePrisma({ missingQuotaRole } = {}) {
  const calls = [];
  const ids = {
    ADMIN: '11111111-1111-4111-8111-111111111111',
    MANAGER: '22222222-2222-4222-8222-222222222222',
    VIEWER: '33333333-3333-4333-8333-333333333333'
  };
  const roleByEmail = Object.fromEntries(Object.entries(EMAILS).map(([role, email]) => [email, role]));
  const roleById = Object.fromEntries(Object.entries(ids).map(([role, id]) => [id, role]));
  const tx = {
    async $executeRawUnsafe(sql, ...params) {
      calls.push({ kind: 'execute', sql, params });
      return 0;
    },
    async $queryRawUnsafe(sql, ...params) {
      calls.push({ kind: 'query', sql, params });
      if (sql === 'SHOW transaction_read_only') return [{ transaction_read_only: 'on' }];
      if (sql.startsWith('SELECT role, employee_id FROM users')) {
        const role = roleByEmail[params[0]];
        return role ? [{ role, employee_id: ids[role] }] : [];
      }
      if (sql.includes("quota_year = $2 AND match_status = 'MATCHED'")) {
        const role = roleById[params[0]];
        return [{ count: role === missingQuotaRole ? 0 : 1 }];
      }
      if (sql.includes('quota_year IS NOT NULL AND quota_year <> $2')) return [{ count: 0 }];
      if (sql === 'SELECT txid_current_if_assigned()::text AS txid') return [{ txid: null }];
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    }
  };
  return {
    calls,
    async $transaction(callback) { return callback(tx); }
  };
}

test('safe persona evidence contains only aggregate booleans/counts', () => {
  const evidence = safeEvidence({
    userRows: [{ role: 'ADMIN', employee_id: 'opaque-private-id' }],
    annualRows: [{ count: 1 }],
    otherYearRows: [{ count: 0 }]
  }, 'ADMIN');
  assert.deepEqual(evidence, {
    userFoundExactlyOnce: true,
    roleMatched: true,
    employeeLinked: true,
    annual2026Rows: 1,
    otherAnnualRows: 0,
    safe: true
  });
  assert.doesNotMatch(JSON.stringify(evidence), /opaque-private-id|example\.test/i);
});

test('persona preflight is transaction-enforced read-only and requires one 2026 authority for every role', async () => {
  const prisma = fakePrisma();
  const result = await runPreflight({ prisma, environment: environment() });
  assert.equal(result.transactionReadOnly, 'on');
  assert.equal(result.transactionIdAssigned, null);
  assert.equal(result.baseYear, 2026);
  assert.equal(result.allSafe, true);
  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
    assert.equal(result.roles[role].safe, true);
    assert.equal(result.roles[role].annual2026Rows, 1);
    assert.equal(result.roles[role].otherAnnualRows, 0);
  }
  const sql = prisma.calls.map((call) => call.sql).join('\n');
  assert.match(sql, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  const serialized = JSON.stringify(result);
  for (const value of Object.values(EMAILS)) assert.doesNotMatch(serialized, new RegExp(value.replace('.', '\\.')));
  assert.doesNotMatch(serialized, /11111111|22222222|33333333/);
});

test('persona preflight fails closed before UAT when any role lacks 2026 authority', async () => {
  const prisma = fakePrisma({ missingQuotaRole: 'VIEWER' });
  await assert.rejects(
    () => runPreflight({ prisma, environment: environment() }),
    (error) => error?.code === 'G03_1_AUTH_PERSONA_2026_AUTHORITY_UNSAFE'
  );
});

test('authenticated workflow runs protected DB target guard and persona preflight before browser install/UAT', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
  const preflight = workflow.indexOf('Verify G03.1 Auth personas have existing 2026 annual authority');
  const browser = workflow.lastIndexOf('Install Playwright Chromium');
  const uat = workflow.indexOf('Run authenticated UAT V3');
  assert.ok(preflight > 0 && preflight < browser && browser < uat);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.match(workflow, /application-under-test\/scripts\/ci\/verify-deployment-target\.js --verify/);
  assert.match(workflow, /node scripts\/ci\/g03-1-auth-persona-preflight\.js/);
  assert.doesNotMatch(workflow, /prisma migrate deploy|prisma-migration\.js deploy/i);
});
