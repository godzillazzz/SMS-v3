'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODE = 'deploy';
const EXPECTED_BRANCH = 'feature/approval-workflow-standard-v1';
const PREVIEW_PROJECT_REF = 'ezxanpfagitckpfsnflp';
const PRODUCTION_PROJECT_REF = 'jkexwnlxnxbemwavsebv';
const EXPECTED_PENDING = '202608220001_license_document_workflow_alignment_v1';
const EXPECTED_HASHES = new Map([
  ['202608190001_signature_v12_webauthn_passkeys', '2f810beb1bce532f1708ad4f69c718ce63942bd226fb45be8cabc12228eca5e7'],
  ['202608210001_employee_master_governed_edit_v1', 'f3db50a18cb85f6b62ab4d433fcac3ba8326bf3dbe5eb7577fe54dc43735c377'],
  ['202608220001_license_document_workflow_alignment_v1', '498e3ded8cfd47890f792f0d2595f56c15204e1335d5092f1b30eaf54c08b3a6'],
]);

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function extractProjectRef(value) {
  if (!value || typeof value !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) return direct[1].toLowerCase();

  let username = '';
  try {
    username = decodeURIComponent(parsed.username || '');
  } catch {
    username = parsed.username || '';
  }
  const pooler = String(username).match(/^postgres\.([a-z0-9]+)$/i);
  if (pooler) return pooler[1].toLowerCase();

  return null;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertRuntimeIdentity(env = process.env) {
  if (env.VERCEL !== '1') throw new Error('PREVIEW_GATE_VERCEL_REQUIRED');
  if (env.VERCEL_ENV !== 'preview') throw new Error('PREVIEW_GATE_ENV_MISMATCH');
  if (env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) throw new Error('PREVIEW_GATE_BRANCH_MISMATCH');

  const databaseRef = extractProjectRef(env.DATABASE_URL);
  const directRef = extractProjectRef(env.DIRECT_URL);
  if (databaseRef !== PREVIEW_PROJECT_REF || directRef !== PREVIEW_PROJECT_REF) {
    throw new Error('PREVIEW_GATE_PROJECT_REF_MISMATCH');
  }
  if (databaseRef === PRODUCTION_PROJECT_REF || directRef === PRODUCTION_PROJECT_REF) {
    throw new Error('PREVIEW_GATE_PRODUCTION_REF_DETECTED');
  }
  return { databaseRef, directRef };
}

function assertCanonicalMigrationBytes(root = process.cwd()) {
  for (const [name, expected] of EXPECTED_HASHES) {
    const filePath = path.join(root, 'prisma', 'migrations', name, 'migration.sql');
    const actual = sha256(filePath);
    if (actual !== expected) throw new Error(`PREVIEW_GATE_CANONICAL_HASH_MISMATCH:${name}`);
  }
}

function runPrisma(args, env = process.env) {
  const cmd = npxCommand();
  const result = spawnSync(cmd, ['--no-install', 'prisma', ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
  };
}

function migrationNames(output) {
  return [...new Set(String(output || '').match(/\b20\d{10}_[a-z0-9_]+\b/gi) || [])];
}

function hasUnsafeStatusSignal(output) {
  return /(failed migration|rolled back|diverg|migration history.*not match|modified after it was applied|changed since it was applied|drift detected)/i.test(String(output || ''));
}

function assertExpectedPreDeployStatus(result) {
  const names = migrationNames(result.output);
  if (hasUnsafeStatusSignal(result.output)) throw new Error('PREVIEW_GATE_STATUS_UNSAFE');
  if (!names.includes(EXPECTED_PENDING)) throw new Error('PREVIEW_GATE_EXPECTED_PENDING_MISSING');
  const unexpected = names.filter((name) => name !== EXPECTED_PENDING);
  if (unexpected.length) throw new Error('PREVIEW_GATE_UNEXPECTED_PENDING_MIGRATION');
}

function assertPostDeployStatus(result) {
  if (result.status !== 0) throw new Error('PREVIEW_GATE_POST_DEPLOY_STATUS_FAILED');
  if (hasUnsafeStatusSignal(result.output)) throw new Error('PREVIEW_GATE_POST_DEPLOY_UNSAFE');
  if (migrationNames(result.output).includes(EXPECTED_PENDING)) throw new Error('PREVIEW_GATE_POST_DEPLOY_PENDING_REMAINS');
  if (!/database schema is up to date|no pending migrations|already in sync/i.test(result.output)) {
    throw new Error('PREVIEW_GATE_POST_DEPLOY_NOT_CONFIRMED');
  }
}

function main(env = process.env) {
  assertRuntimeIdentity(env);
  assertCanonicalMigrationBytes();
  console.log('PREVIEW_MIGRATION_IDENTITY_GATE=PASS');
  console.log('CANONICAL_MIGRATION_BYTES=PASS');

  const before = runPrisma(['migrate', 'status', '--schema', 'prisma/schema.prisma'], env);

  if (MODE === 'status') {
    assertExpectedPreDeployStatus(before);
    console.log('PREVIEW_MIGRATION_STATUS=EXPECTED_20_APPLIED_1_PENDING');
    console.log(`PREVIEW_PENDING_MIGRATION=${EXPECTED_PENDING}`);
    return 0;
  }

  if (MODE !== 'deploy') throw new Error('PREVIEW_GATE_INVALID_MODE');
  assertExpectedPreDeployStatus(before);
  console.log('PREVIEW_MIGRATION_PREDEPLOY_STATUS=PASS');

  const deployed = runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], env);
  if (deployed.status !== 0) throw new Error('PREVIEW_MIGRATE_DEPLOY_FAILED');
  if (!String(deployed.output).includes(EXPECTED_PENDING)) throw new Error('PREVIEW_MIGRATE_DEPLOY_EXPECTED_MIGRATION_NOT_CONFIRMED');
  console.log(`PREVIEW_MIGRATION_APPLIED=${EXPECTED_PENDING}`);

  const after = runPrisma(['migrate', 'status', '--schema', 'prisma/schema.prisma'], env);
  assertPostDeployStatus(after);
  console.log('PREVIEW_MIGRATION_POSTDEPLOY_STATUS=UP_TO_DATE');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`PREVIEW_MIGRATION_GATE_ERROR=${error && error.message ? error.message : 'UNKNOWN'}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MODE,
  EXPECTED_BRANCH,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  EXPECTED_PENDING,
  EXPECTED_HASHES,
  extractProjectRef,
  assertRuntimeIdentity,
  assertCanonicalMigrationBytes,
  migrationNames,
  hasUnsafeStatusSignal,
  assertExpectedPreDeployStatus,
  assertPostDeployStatus,
  main,
};
