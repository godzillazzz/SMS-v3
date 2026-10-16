'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyConnectivityOutput,
  classifyTargetValues,
  formatProcessEnvironment,
  parseProcessUrl,
  probeDatabase,
  redactDiagnosticText
} = require('../scripts/ci/production-database-diagnostic');

const workflowSource = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'diagnose-production-database.yml'), 'utf8');
const transactionUrl = (project = 'projectref') => `postgresql://postgres.${project}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;
const sessionUrl = (project = 'projectref') => `postgresql://db-user.${project}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;

test('classifies transaction pooler and session pair without exposing identity', () => {
  const result = classifyTargetValues({ DATABASE_URL: transactionUrl(), DIRECT_URL: sessionUrl() });
  assert.equal(result.databaseUrl.mode, 'transaction-pooler');
  assert.equal(result.databaseUrl.port, '6543');
  assert.equal(result.directUrl.mode, 'verified-supabase-session');
  assert.equal(result.directUrl.port, '5432');
  assert.equal(result.logicalPairMatch, 'true');
  assert.doesNotMatch(JSON.stringify(result), /projectref|aws-1-us-east-1/);
});

test('rejects malformed URL and detects logical mismatch', () => {
  assert.equal(parseProcessUrl('not-a-url').ok, false);
  assert.equal(classifyTargetValues({ DATABASE_URL: transactionUrl('one'), DIRECT_URL: sessionUrl('two') }).logicalPairMatch, 'false');
});

test('reports process environment metadata without raw values', () => {
  const databaseUrl = transactionUrl();
  const directUrl = sessionUrl();
  const output = formatProcessEnvironment({ DATABASE_URL: databaseUrl, DIRECT_URL: directUrl });
  assert.match(output, /ENV_INJECTION=PASS/);
  assert.match(output, /DATABASE_URL_PROTOCOL=postgresql/);
  assert.match(output, /DATABASE_URL_PARSE=PASS/);
  assert.match(output, /DATABASE_URL_PORT=6543/);
  assert.match(output, /DATABASE_URL_LENGTH=/);
  assert.match(output, /DIRECT_URL_PROTOCOL=postgresql/);
  assert.match(output, /URI_PARSE=PASS/);
  assert.doesNotMatch(output, /projectref|pooler\.supabase|postgresql:\/\//);
});

test('redacts secrets and connection data', () => {
  const token = 'unit-token';
  const raw = `Bearer ${token} postgresql://user:pass@db.example.test:6543/postgres?token=${token}`;
  const safe = redactDiagnosticText(raw, [token]);
  assert.doesNotMatch(safe, /unit-token|postgresql|db\.example|pass|6543/);
});

test('classifies connectivity failures safely', () => {
  assert.equal(classifyConnectivityOutput('P1001 cannot reach database', 1).classification, 'CONNECTION_ERROR');
  assert.equal(classifyConnectivityOutput('P1002 timed out', 1).classification, 'TIMEOUT');
  assert.equal(classifyConnectivityOutput('P2024 connection pool timeout', 1).classification, 'POOL_EXHAUSTED');
  assert.equal(classifyConnectivityOutput('MALFORMED_URL', 1).classification, 'CONFIG_ERROR');
});

test('runs one SELECT 1 with pg client and closes it', async () => {
  let queryCount = 0;
  let endCount = 0;
  const result = await probeDatabase({ DATABASE_URL: transactionUrl(), DIRECT_URL: sessionUrl() }, {
    clientFactory: () => ({
      connect: async () => {},
      query: async (query) => {
        queryCount += 1;
        assert.equal(query, 'SELECT 1');
      },
      end: async () => {
        endCount += 1;
      }
    })
  });
  assert.equal(result.classification, 'PASS');
  assert.equal(queryCount, 1);
  assert.equal(endCount, 1);
});

test('workflow uses official env run and never pulls an env file', () => {
  assert.match(workflowSource, /project inspect/);
  assert.match(workflowSource, /env run -e production/);
  assert.match(workflowSource, /--project "\$VERCEL_PROJECT_ID"/);
  assert.match(workflowSource, /--scope "\$VERCEL_ORG_ID"/);
  assert.doesNotMatch(workflowSource, /env pull|dotenv|vercel\.env/);
  assert.doesNotMatch(workflowSource, /fetch-depth:\s*0/);
  assert.doesNotMatch(workflowSource, /prisma\s+(db\s+execute|validate)|migrate|db push/);
  assert.doesNotMatch(workflowSource, /on:\s*\n\s+(push|schedule|repository_dispatch):/);
});
