'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { validateTargetScope } = require('../../e2e/helpers/uat-target-contract');
const { normalizeLogicalTarget, parseTarget, targetFingerprint } = require('../ci/verify-deployment-target');
const {
  FIXTURE_CONFIRMATION: DISPOSABLE_CONFIRMATION,
  FIXTURE_EMPLOYEE_CODE,
  FIXTURE_LEGACY_EMPLOYEE_ID,
  FIXTURE_SKILL_MARKER,
  FIXTURE_USER_EMAIL,
  prepareDisposableUatEmployee,
  resetDisposableUatEmployee,
  assertDisposableUatEmployeeBaseline
} = require('./disposable-uat-employee');

const Q13B_CONFIRMATION = 'MUTATE_Q13B_PREVIEW_SPECIALIST_V1';
const Q13B_AUTO_PATTERN_CODE = 'ZZZ_Q13B_UAT_PATTERN_V1';
const Q13B_AUTO_PATTERN_NAME_PREFIX = 'Q13B Preview Fixture';
const Q13B_LEAVE_REASON_MARKER = 'Q13B-UAT';
const Q13B_QUOTA_YEAR = 2026;
const Q13B_QUOTA_FINGERPRINT = crypto.createHash('sha256').update('Q13B_PREVIEW_LEAVE_QUOTA_V1').digest('hex');
const DEFAULT_SNAPSHOT_PATH = path.join('test-results', 'q13b-preview-baseline.json');
const HEX_64 = /^[0-9a-f]{64}$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

function q13bError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertQ13bPreviewExecutionContext(environment = process.env, { log = console.log } = {}) {
  if (environment.GITHUB_ACTIONS !== 'true') throw q13bError('Q13B_GITHUB_ACTIONS_REQUIRED');
  if (String(environment.UAT_TARGET_MODE || '').trim() !== 'preview') throw q13bError('Q13B_PREVIEW_ONLY');
  if (String(environment.Q13B_WRITE_CONFIRMATION || '') !== Q13B_CONFIRMATION) throw q13bError('Q13B_CONFIRMATION_REQUIRED');
  if (!DEPLOYMENT_ID.test(String(environment.UAT_EXPECTED_DEPLOYMENT_ID || ''))) throw q13bError('Q13B_DEPLOYMENT_IDENTITY_REQUIRED');
  if (!SHA_40.test(String(environment.UAT_SOURCE_SHA || ''))) throw q13bError('Q13B_SOURCE_IDENTITY_REQUIRED');
  if (!SHA_40.test(String(environment.UAT_HARNESS_SHA || ''))) throw q13bError('Q13B_HARNESS_IDENTITY_REQUIRED');
  validateTargetScope('preview', String(environment.UAT_BASE_URL || ''));

  const approvedPreview = String(environment.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  const approvedProduction = String(environment.APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  if (!HEX_64.test(approvedPreview)) throw q13bError('Q13B_PREVIEW_FINGERPRINT_REQUIRED');
  if (!HEX_64.test(approvedProduction)) throw q13bError('Q13B_PRODUCTION_FINGERPRINT_REQUIRED');
  if (approvedPreview === approvedProduction) throw q13bError('Q13B_DATABASE_FINGERPRINT_COLLISION', 'Preview and Production target fingerprints must be distinct');

  let databaseUrl;
  let directUrl;
  try {
    databaseUrl = parseTarget('DATABASE_URL', environment.DATABASE_URL);
    directUrl = parseTarget('DIRECT_URL', environment.DIRECT_URL);
    normalizeLogicalTarget(databaseUrl, directUrl);
  } catch {
    throw q13bError('Q13B_PREVIEW_DATABASE_TARGET_INVALID');
  }
  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  if (fingerprint !== approvedPreview) throw q13bError('Q13B_PREVIEW_DATABASE_FINGERPRINT_MISMATCH');
  if (fingerprint === approvedProduction) throw q13bError('Q13B_PREVIEW_DATABASE_MATCHES_PRODUCTION');

  log('Q13B_PREVIEW_DATABASE_IDENTITY=PROVEN');
  log('Q13B_PREVIEW_NOT_PRODUCTION=PASS');
  log('Q13B_RAW_DATABASE_OUTPUT_EMITTED=false');
  return { fingerprint, databaseMode: databaseUrl.mode, directMode: directUrl.mode };
}

function disposableEnvironment(environment = process.env) {
  return {
    ...environment,
    UAT_DISPOSABLE_EMPLOYEE_MODE: 'shared-approved',
    UAT_DISPOSABLE_EMPLOYEE_CONFIRM: DISPOSABLE_CONFIRMATION,
    UAT_MODE: 'authenticated'
  };
}

function snapshotPath(environment = process.env) {
  return path.resolve(String(environment.Q13B_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH));
}

function createPrismaClient(databaseUrl) {
  if (!databaseUrl) throw q13bError('Q13B_DATABASE_URL_MISSING');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function exactFixtureIdentity(client) {
  const employee = await client.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } });
  const user = await client.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
  if (!employee && !user) return { employee: null, user: null };
  if (!employee || !user) throw q13bError('Q13B_FIXTURE_IDENTITY_MISMATCH');
  if (
    employee.employeeCode !== FIXTURE_EMPLOYEE_CODE
    || employee.legacyEmployeeId !== FIXTURE_LEGACY_EMPLOYEE_ID
    || employee.skill !== FIXTURE_SKILL_MARKER
    || user.email !== FIXTURE_USER_EMAIL
    || user.employeeId !== employee.id
  ) throw q13bError('Q13B_FIXTURE_IDENTITY_MISMATCH');
  return { employee, user };
}

async function removeQ13bAutoPattern(client) {
  const row = await client.autoSchedulePattern.findUnique({ where: { code: Q13B_AUTO_PATTERN_CODE } });
  if (!row) return 0;
  if (row.isSystem || row.targetGroup !== 'MANUAL' || !String(row.name || '').startsWith(Q13B_AUTO_PATTERN_NAME_PREFIX)) {
    throw q13bError('Q13B_AUTO_PATTERN_IDENTITY_MISMATCH');
  }
  await client.autoSchedulePattern.delete({ where: { id: row.id } });
  return 1;
}

async function removeQ13bEmployeeDependencies(client, employee) {
  if (!employee) return { leaves: 0, quotas: 0 };
  const leaves = await client.leaveRequest.findMany({ where: { employeeId: employee.id }, select: { id: true, reason: true } });
  const foreignLeaves = leaves.filter((row) => !String(row.reason || '').includes(Q13B_LEAVE_REASON_MARKER));
  if (foreignLeaves.length) throw q13bError('Q13B_FIXTURE_FOREIGN_LEAVE_DEPENDENCY');
  if (leaves.length) await client.leaveRequest.deleteMany({ where: { id: { in: leaves.map((row) => row.id) } } });

  const quotas = await client.leaveQuota.findMany({ where: { employeeId: employee.id }, select: { id: true, sourceFingerprint: true } });
  const foreignQuotas = quotas.filter((row) => row.sourceFingerprint !== Q13B_QUOTA_FINGERPRINT);
  if (foreignQuotas.length) throw q13bError('Q13B_FIXTURE_FOREIGN_QUOTA_DEPENDENCY');
  if (quotas.length) await client.leaveQuota.deleteMany({ where: { id: { in: quotas.map((row) => row.id) } } });
  return { leaves: leaves.length, quotas: quotas.length };
}

async function approvalPolicySnapshot(client) {
  const rows = await client.systemSetting.findMany({
    where: { key: { startsWith: 'APPROVAL_POLICY.LEAVE_REQUEST.' } },
    select: { key: true, value: true, description: true },
    orderBy: { key: 'asc' }
  });
  if (rows.length !== 5) throw q13bError('Q13B_APPROVAL_POLICY_BASELINE_INCOMPLETE');
  return rows;
}

async function restoreApprovalPolicySnapshot(client, rows) {
  if (!Array.isArray(rows) || rows.length !== 5) throw q13bError('Q13B_APPROVAL_POLICY_SNAPSHOT_INVALID');
  await client.$transaction(async (tx) => {
    for (const row of rows) {
      if (!String(row.key || '').startsWith('APPROVAL_POLICY.LEAVE_REQUEST.')) throw q13bError('Q13B_APPROVAL_POLICY_SNAPSHOT_INVALID');
      await tx.systemSetting.upsert({
        where: { key: row.key },
        update: { value: row.value, description: row.description ?? null },
        create: { key: row.key, value: row.value, description: row.description ?? null }
      });
    }
  });
}

async function prepare({ environment = process.env, log = console.log } = {}) {
  assertQ13bPreviewExecutionContext(environment, { log });
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    const prior = await exactFixtureIdentity(prisma);
    await removeQ13bAutoPattern(prisma);
    if (prior.employee) await removeQ13bEmployeeDependencies(prisma, prior.employee);

    const disposableEnv = disposableEnvironment(environment);
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment: disposableEnv });
    const { employee } = await exactFixtureIdentity(prisma);
    if (!employee) throw q13bError('Q13B_FIXTURE_PREPARE_FAILED');

    await prisma.leaveQuota.create({
      data: {
        sourceFingerprint: Q13B_QUOTA_FINGERPRINT,
        employeeId: employee.id,
        quotaYear: Q13B_QUOTA_YEAR,
        employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`.trim(),
        sickLeave: 99,
        personalLeave: 99,
        vacationLeave: 99,
        matchStatus: 'MATCHED'
      }
    });

    const baseline = {
      version: 1,
      fixtureEmployeeCode: FIXTURE_EMPLOYEE_CODE,
      quotaYear: Q13B_QUOTA_YEAR,
      autoPatternCode: Q13B_AUTO_PATTERN_CODE,
      approvalPolicySettings: await approvalPolicySnapshot(prisma)
    };
    const file = snapshotPath(environment);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    log(JSON.stringify({ state: 'Q13B_PREVIEW_FIXTURE_READY', fixtureEmployeeCode: FIXTURE_EMPLOYEE_CODE, quotaYear: Q13B_QUOTA_YEAR, approvalPolicyRows: baseline.approvalPolicySettings.length }));
    return baseline;
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanup({ environment = process.env, log = console.log } = {}) {
  assertQ13bPreviewExecutionContext(environment, { log });
  const file = snapshotPath(environment);
  if (!fs.existsSync(file)) throw q13bError('Q13B_SNAPSHOT_MISSING');
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await restoreApprovalPolicySnapshot(prisma, baseline.approvalPolicySettings);
    const autoPatternsRemoved = await removeQ13bAutoPattern(prisma);
    const identity = await exactFixtureIdentity(prisma);
    if (!identity.employee) throw q13bError('Q13B_FIXTURE_IDENTITY_MISSING');
    const removed = await removeQ13bEmployeeDependencies(prisma, identity.employee);
    const disposableEnv = disposableEnvironment(environment);
    await resetDisposableUatEmployee({ prismaClient: prisma, environment: disposableEnv });
    await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment: disposableEnv });

    const remainingPattern = await prisma.autoSchedulePattern.findUnique({ where: { code: Q13B_AUTO_PATTERN_CODE } });
    const remainingLeave = await prisma.leaveRequest.count({ where: { employeeId: identity.employee.id, reason: { contains: Q13B_LEAVE_REASON_MARKER } } });
    const remainingQuota = await prisma.leaveQuota.count({ where: { employeeId: identity.employee.id, sourceFingerprint: Q13B_QUOTA_FINGERPRINT } });
    const restoredPolicy = await approvalPolicySnapshot(prisma);
    if (remainingPattern || remainingLeave || remainingQuota) throw q13bError('Q13B_FIXTURE_CLEANUP_INCOMPLETE');
    if (JSON.stringify(restoredPolicy) !== JSON.stringify(baseline.approvalPolicySettings)) throw q13bError('Q13B_APPROVAL_POLICY_RESTORE_MISMATCH');

    const result = { state: 'Q13B_PREVIEW_FIXTURE_CLEAN', autoPatternsRemoved, leavesRemoved: removed.leaves, quotasRemoved: removed.quotas, disposableEmployeeBaseline: true, approvalPolicyRestored: true };
    log('Q13B_PREVIEW_FIXTURE_CLEANUP=PASS');
    log(JSON.stringify(result));
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const command = String(process.argv[2] || '').trim().toLowerCase();
  try {
    if (command === 'prepare') await prepare();
    else if (command === 'cleanup') await cleanup();
    else throw q13bError('Q13B_COMMAND_INVALID');
  } catch (error) {
    console.error(error?.code || 'Q13B_PREVIEW_FIXTURE_FAILED');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  Q13B_AUTO_PATTERN_CODE,
  Q13B_CONFIRMATION,
  Q13B_LEAVE_REASON_MARKER,
  Q13B_QUOTA_FINGERPRINT,
  Q13B_QUOTA_YEAR,
  approvalPolicySnapshot,
  assertQ13bPreviewExecutionContext,
  cleanup,
  prepare,
  restoreApprovalPolicySnapshot
};