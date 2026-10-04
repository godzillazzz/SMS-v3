'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const enabled = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'
  && target.hostname === '127.0.0.1' && target.port === '5432'
  && target.pathname === '/sms_v3_test';
test('Production catalog inspector verifies actual migrated disposable PostgreSQL schema without business rows', { skip: !enabled }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const { inspect } = require('../../scripts/ci/verify-attendance-time-policy-production-migration');
  const prisma = new PrismaClient();
  try {
    // Browser-role fixture is restricted above to the CI disposable database.
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    const output = [];
    const result = await inspect({ prisma, post: true, log: (line) => output.push(line) });
    assert.equal(result.state, 'BOTH_ALREADY_APPLIED_AND_VALID');
    assert(output.includes('PREDECESSOR_SCHEMA=VALID'));
    assert(output.includes('TARGET_SCHEMA=VALID'));
    assert(output.includes('RAW_BUSINESS_ROWS_READ=NO'));
    assert(!output.join('\n').includes(process.env.DATABASE_URL));
    const { sourceMigrations } = require('../../scripts/ci/verify-attendance-time-policy-production-migration');
    const { readFacts } = require('../../scripts/ci/reconcile-production-attendance-migrations');
    const fs = require('node:fs');
    const candidates = new Map(sourceMigrations().map((m) => [m.name,[{
      digest:m.checksum, bytes:fs.readFileSync('prisma/migrations/'+m.name+'/migration.sql')
    }]]));
    const canonical = new Map(sourceMigrations().map((m) => [m.name,{digest:m.checksum}]));
    const detailedOutput = [];
    const detailed = await readFacts(prisma,{canonical,candidates},(line)=>detailedOutput.push(line));
    assert.equal(detailed.history.state,'HISTORY_CLEAN');
    assert.equal(detailed.predecessor,'LEDGER_APPLIED_SCHEMA_VALID');
    assert.equal(detailed.target,'LEDGER_APPLIED_SCHEMA_VALID');
    assert.equal(detailed.plan,'PLAN_NO_DATABASE_CHANGE');
    assert(detailedOutput.some((line)=>line.startsWith('LEDGER_MIGRATION=')));
    assert(!detailedOutput.join('\n').includes(process.env.DATABASE_URL));
    assert(!detailedOutput.join('\n').includes('checksum='));
  } finally { await prisma.$disconnect(); }
});
