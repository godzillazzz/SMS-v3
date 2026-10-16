'use strict';

const path = require('node:path');
const { Client } = require('pg');
const { EXPECTED_ROLE, inspectReadOnlyRole } = require('./preview-readonly-role-privileges');

function emitProof(proof, log = console.log) {
  log(`READ_ONLY_PRIVILEGE_PROOF=${proof.passed ? 'PASS' : 'FAIL'}`);
  log(`READ_ONLY_PRIVILEGE_CATEGORY=${proof.category || 'READ_ONLY_CHECK_FAILED'}`);
  for (const [name, passed] of Object.entries(proof.checks || {})) {
    log(`READ_ONLY_CHECK_${name.toUpperCase()}=${passed ? 'PASS' : 'FAIL'}`);
  }
  log('RAW_CONNECTION_VALUES_EMITTED=false');
  log('APPLICATION_ROWS_READ=false');
}

async function verifyPreviewReadOnlyRole(args = {}) {
  const env = args.env || process.env;
  const log = args.log || console.log;
  try {
    const releaseControlRoot = args.releaseControlRoot || env.RELEASE_CONTROL_ROOT;
    const guardPath = path.join(releaseControlRoot || '', 'scripts', 'ci', 'verify-preview-migration-target.js');
    require(guardPath).verifyPreviewMigrationTarget({ env, log });
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview'
      || !env.DATABASE_URL || !env.DIRECT_URL
      || env.DATABASE_URL !== env.DIRECT_URL) {
      throw Object.assign(new Error(), { safeCategory: 'READ_ONLY_TARGET_CONFIGURATION_INVALID' });
    }
    const client = args.client || new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      application_name: 'smsv3-preview-readonly-proof',
    });
    const proof = await inspectReadOnlyRole(client, args.expectedRole || EXPECTED_ROLE);
    emitProof(proof, log);
    if (!proof.passed) return { ...proof, isolationGuard: 'PASS' };
    return { ...proof, isolationGuard: 'PASS' };
  } catch (error) {
    const safeCategory = error?.safeCategory || (String(error?.message || '').includes('module')
      ? 'READ_ONLY_GUARD_UNAVAILABLE' : 'READ_ONLY_TARGET_CONFIGURATION_INVALID');
    const result = { passed: false, category: safeCategory, checks: {}, isolationGuard: 'FAIL' };
    emitProof(result, log);
    return result;
  }
}

async function main() {
  const proof = await verifyPreviewReadOnlyRole();
  return proof.passed ? 0 : 1;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { emitProof, main, verifyPreviewReadOnlyRole };
