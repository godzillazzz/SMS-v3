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
  } finally { await prisma.$disconnect(); }
});
