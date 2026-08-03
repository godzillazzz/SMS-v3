'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyConnectivityOutput,
  classifyTargetValues,
  redactDiagnosticText,
  validateTargetSha,
  probeDatabase
} = require('../scripts/ci/production-database-diagnostic');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workflowSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '.github', 'workflows', 'diagnose-production-database.yml'), 'utf8');

const transactionUrl = (project = 'projectref') => `postgresql://postgres.${project}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;
const sessionUrl = (project = 'projectref') => `postgresql://db-user.${project}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const directUrl = (project = 'projectref') => `postgresql://postgres@db.${project}.supabase.co:5432/postgres`;

test('classifies transaction pooler 6543 without exposing identity', () => {
  const result = classifyTargetValues({ DATABASE_URL: transactionUrl(), DIRECT_URL: sessionUrl() });
  assert.equal(result.databaseUrl.mode, 'transaction-pooler');
  assert.equal(result.databaseUrl.port, '6543');
  assert.equal(result.directUrl.mode, 'verified-supabase-session');
  assert.equal(result.directUrl.port, '5432');
  assert.equal(result.logicalPairMatch, 'true');
  assert.doesNotMatch(JSON.stringify(result), /projectref|aws-1-us-east-1|db\.projectref/);
});

test('classifies direct 5432 and matching session pair', () => {
  const result = classifyTargetValues({ DATABASE_URL: directUrl(), DIRECT_URL: sessionUrl() });
  assert.equal(result.databaseUrl.mode, 'direct');
  assert.equal(result.databaseUrl.port, '5432');
  assert.equal(result.logicalPairMatch, 'true');
});

test('detects logical pair mismatch and malformed URL', () => {
  assert.equal(classifyTargetValues({ DATABASE_URL: transactionUrl('one'), DIRECT_URL: sessionUrl('two') }).logicalPairMatch, 'false');
  const malformed = classifyTargetValues({ DATABASE_URL: 'not-a-url', DIRECT_URL: sessionUrl() });
  assert.equal(malformed.databaseUrl.mode, 'unknown');
  assert.equal(malformed.logicalPairMatch, 'unknown');
});

test('redacts secrets and connection data', () => {
  const token = ['unit', 'token'].join('-');
  const raw = `Bearer ${token} postgresql://user:pass@db.example.test:6543/postgres?token=${token}`;
  const safe = redactDiagnosticText(raw, [token]);
  assert.doesNotMatch(safe, new RegExp(token));
  assert.doesNotMatch(safe, /postgresql|db\.example|pass|6543/);
});

test('classifies Prisma connectivity failures', () => {
  assert.equal(classifyConnectivityOutput('P1001 cannot reach database', 1).classification, 'CONNECTION_ERROR');
  assert.equal(classifyConnectivityOutput('P1002 timed out', 1).classification, 'TIMEOUT');
  assert.equal(classifyConnectivityOutput('P2024 connection pool timeout', 1).classification, 'POOL_EXHAUSTED');
  assert.equal(classifyConnectivityOutput('P1012 invalid datasource', 1).classification, 'CONFIG_ERROR');
  assert.equal(classifyConnectivityOutput('', 1).classification, 'UNKNOWN');
});

test('validates only full SHA-1 target commits', () => {
  assert.equal(validateTargetSha('0123456789abcdef0123456789abcdef01234567'), true);
  assert.equal(validateTargetSha('0123456'), false);
  assert.equal(validateTargetSha('0123456789abcdef0123456789abcdef0123456g'), false);
  assert.equal(validateTargetSha(''), false);
});

test('workflow fetches the validated target and keeps commit existence guard', () => {
  assert.match(workflowSource, /\[\[ \"\$TARGET_SHA\" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflowSource, /set -euo pipefail/);
  assert.match(workflowSource, /git fetch --no-tags --depth=1 origin \"\$TARGET_SHA\"/);
  assert.match(workflowSource, /git cat-file -e \"\$\{TARGET_SHA\}\^\{commit\}\"/);
  assert.doesNotMatch(workflowSource, /node scripts\/ci\/production-database-diagnostic\.js validate-sha/);
  const validationStart = workflowSource.indexOf('Fetch and validate exact diagnostic target commit');
  const dependencyInstall = workflowSource.indexOf('run: npm ci');
  assert.ok(validationStart >= 0 && dependencyInstall > validationStart);
  assert.doesNotMatch(workflowSource, /fetch-depth:\s*0/);
});

test('runs one SELECT 1 with the existing client and disconnects without a Prisma schema', async () => {
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-diagnostic-test-')), 'vercel.env');
  fs.writeFileSync(envFile, 'DATABASE_URL=postgresql://redacted\nDIRECT_URL=postgresql://redacted\n');
  let queryCount = 0;
  let disconnectCount = 0;
  const result = await probeDatabase(envFile, {
    clientFactory: () => ({
      $queryRawUnsafe: async (query) => {
        queryCount += 1;
        assert.equal(query, 'SELECT 1');
        return [{ '?column?': 1 }];
      },
      $disconnect: async () => {
        disconnectCount += 1;
      }
    })
  });
  fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  assert.equal(result.classification, 'PASS');
  assert.equal(queryCount, 1);
  assert.equal(disconnectCount, 1);
});
