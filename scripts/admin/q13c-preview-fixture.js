'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

const Q13C_CONFIRMATION = 'MUTATE_Q13C_PREVIEW_BUSINESS_V1';
const Q13C_DEPARTMENT_CODE = 'ZZZ_Q13C_DEPT_V1';
const Q13C_DEPARTMENT_NAME_PREFIX = 'Q13C Preview Department';
const Q13C_SITE_CODE = 'ZZZ_Q13C_SITE_V1';
const Q13C_SITE_NAME_PREFIX = 'Q13C Preview Site';
const Q13C_SETTING_KEY = 'LINE_TEMPLATE_NEW_LEAVE';
const Q13C_CHANGE_MARKER = 'Q13C-UAT';
const DEFAULT_SNAPSHOT_PATH = path.join('test-results', 'q13c-preview-baseline.json');
const HEX_64 = /^[0-9a-f]{64}$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

function q13cError(code, message = code) { const error = new Error(message); error.code = code; return error; }
function safeDiagnosticCode(error) { const value = String(error?.code || error?.errorCode || error?.name || 'Q13C_PREVIEW_FIXTURE_FAILED'); return /^[A-Za-z0-9_]+$/.test(value) ? value : 'Q13C_PREVIEW_FIXTURE_FAILED'; }

function assertQ13cPreviewExecutionContext(environment = process.env, { log = console.log } = {}) {
  if (environment.GITHUB_ACTIONS !== 'true') throw q13cError('Q13C_GITHUB_ACTIONS_REQUIRED');
  if (String(environment.UAT_TARGET_MODE || '').trim() !== 'preview') throw q13cError('Q13C_PREVIEW_ONLY');
  if (String(environment.Q13C_WRITE_CONFIRMATION || '') !== Q13C_CONFIRMATION) throw q13cError('Q13C_CONFIRMATION_REQUIRED');
  if (!DEPLOYMENT_ID.test(String(environment.UAT_EXPECTED_DEPLOYMENT_ID || ''))) throw q13cError('Q13C_DEPLOYMENT_IDENTITY_REQUIRED');
  if (!SHA_40.test(String(environment.UAT_SOURCE_SHA || ''))) throw q13cError('Q13C_SOURCE_IDENTITY_REQUIRED');
  if (!SHA_40.test(String(environment.UAT_HARNESS_SHA || ''))) throw q13cError('Q13C_HARNESS_IDENTITY_REQUIRED');
  validateTargetScope('preview', String(environment.UAT_BASE_URL || ''));
  const approvedPreview = String(environment.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  const approvedProduction = String(environment.APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  if (!HEX_64.test(approvedPreview)) throw q13cError('Q13C_PREVIEW_FINGERPRINT_REQUIRED');
  if (!HEX_64.test(approvedProduction)) throw q13cError('Q13C_PRODUCTION_FINGERPRINT_REQUIRED');
  if (approvedPreview === approvedProduction) throw q13cError('Q13C_DATABASE_FINGERPRINT_COLLISION');
  let databaseUrl; let directUrl;
  try { databaseUrl = parseTarget('DATABASE_URL', environment.DATABASE_URL); directUrl = parseTarget('DIRECT_URL', environment.DIRECT_URL); normalizeLogicalTarget(databaseUrl, directUrl); }
  catch { throw q13cError('Q13C_PREVIEW_DATABASE_TARGET_INVALID'); }
  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  if (fingerprint !== approvedPreview) throw q13cError('Q13C_PREVIEW_DATABASE_FINGERPRINT_MISMATCH');
  if (fingerprint === approvedProduction) throw q13cError('Q13C_PREVIEW_DATABASE_MATCHES_PRODUCTION');
  log('Q13C_PREVIEW_DATABASE_IDENTITY=PROVEN');
  log('Q13C_PREVIEW_NOT_PRODUCTION=PASS');
  log('Q13C_RAW_DATABASE_OUTPUT_EMITTED=false');
  return { fingerprint };
}

function disposableEnvironment(environment = process.env) {
  return { ...environment, UAT_DISPOSABLE_EMPLOYEE_MODE: 'shared-approved', UAT_DISPOSABLE_EMPLOYEE_CONFIRM: DISPOSABLE_CONFIRMATION, UAT_MODE: 'authenticated' };
}
function snapshotPath(environment = process.env) { return path.resolve(String(environment.Q13C_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH)); }
function writeSnapshot(environment, baseline) { const file = snapshotPath(environment); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8'); return file; }
function readSnapshot(environment) { const file = snapshotPath(environment); if (!fs.existsSync(file)) throw q13cError('Q13C_SNAPSHOT_MISSING'); const baseline = JSON.parse(fs.readFileSync(file, 'utf8')); if (!baseline || baseline.version !== 1 || baseline.fixtureInitiallyPresent !== false) throw q13cError('Q13C_SNAPSHOT_INVALID'); return baseline; }

function createPrismaClient(databaseUrl, environment = process.env) {
  if (!databaseUrl) throw q13cError('Q13C_DATABASE_URL_MISSING');
  const applicationRoot = String(environment.UAT_APPLICATION_ROOT || '').trim();
  if (!applicationRoot) throw q13cError('Q13C_APPLICATION_ROOT_REQUIRED');
  const modulePath = path.join(path.resolve(applicationRoot), 'node_modules', '@prisma', 'client');
  let PrismaClient;
  try { ({ PrismaClient } = require(modulePath)); } catch { throw q13cError('Q13C_APPLICATION_PRISMA_CLIENT_UNAVAILABLE'); }
  if (typeof PrismaClient !== 'function') throw q13cError('Q13C_APPLICATION_PRISMA_CLIENT_INVALID');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function exactFixtureIdentity(client) {
  const employee = await client.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } });
  const user = await client.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
  if (!employee && !user) return { employee: null, user: null };
  if (!employee || !user) throw q13cError('Q13C_FIXTURE_IDENTITY_MISMATCH');
  if (employee.employeeCode !== FIXTURE_EMPLOYEE_CODE || employee.legacyEmployeeId !== FIXTURE_LEGACY_EMPLOYEE_ID || employee.skill !== FIXTURE_SKILL_MARKER || user.email !== FIXTURE_USER_EMAIL || user.employeeId !== employee.id) throw q13cError('Q13C_FIXTURE_IDENTITY_MISMATCH');
  return { employee, user };
}

function assertDepartmentFixture(row) {
  if (!row) return;
  if (row.code !== Q13C_DEPARTMENT_CODE || !String(row.name || '').startsWith(Q13C_DEPARTMENT_NAME_PREFIX)) throw q13cError('Q13C_DEPARTMENT_FIXTURE_IDENTITY_MISMATCH');
}
function assertSiteFixture(row) {
  if (!row) return;
  if (row.code !== Q13C_SITE_CODE || !String(row.name || '').startsWith(Q13C_SITE_NAME_PREFIX)) throw q13cError('Q13C_SITE_FIXTURE_IDENTITY_MISMATCH');
}

async function diagnose({ environment = process.env, log = console.log } = {}) {
  assertQ13cPreviewExecutionContext(environment, { log });
  const prisma = createPrismaClient(environment.DATABASE_URL, environment);
  const result = { state: 'Q13C_PREVIEW_DIAGNOSTIC', previewDatabaseIdentity: 'PROVEN', productionDatabaseRejected: true };
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.databaseConnection = 'PASS';
    const identity = await exactFixtureIdentity(prisma);
    const department = await prisma.departmentMaster.findUnique({ where: { code: Q13C_DEPARTMENT_CODE } });
    const site = await prisma.securitySite.findUnique({ where: { code: Q13C_SITE_CODE } });
    assertDepartmentFixture(department); assertSiteFixture(site);
    result.fixtureAbsent = !identity.employee && !identity.user;
    result.departmentFixtureAbsent = !department;
    result.siteFixtureAbsent = !site;
    result.models = {
      employeeChangeRequest: typeof prisma.employeeChangeRequest?.findMany === 'function',
      departmentMaster: typeof prisma.departmentMaster?.findMany === 'function',
      securitySite: typeof prisma.securitySite?.findMany === 'function',
      systemSetting: typeof prisma.systemSetting?.findMany === 'function'
    };
    result.ok = result.fixtureAbsent && result.departmentFixtureAbsent && result.siteFixtureAbsent && Object.values(result.models).every(Boolean);
    log(JSON.stringify(result));
    if (!result.ok) throw q13cError('Q13C_PREVIEW_DIAGNOSTIC_FAILED');
    return result;
  } finally { await prisma.$disconnect(); }
}

async function snapshot({ environment = process.env, log = console.log } = {}) {
  assertQ13cPreviewExecutionContext(environment, { log });
  const prisma = createPrismaClient(environment.DATABASE_URL, environment);
  try {
    const identity = await exactFixtureIdentity(prisma);
    if (identity.employee || identity.user) throw q13cError('Q13C_DISPOSABLE_FIXTURE_MUST_START_ABSENT');
    const department = await prisma.departmentMaster.findUnique({ where: { code: Q13C_DEPARTMENT_CODE } });
    const site = await prisma.securitySite.findUnique({ where: { code: Q13C_SITE_CODE } });
    assertDepartmentFixture(department); assertSiteFixture(site);
    if (department || site) throw q13cError('Q13C_FIXED_FIXTURE_RESIDUE_PRESENT');
    const setting = await prisma.systemSetting.findUnique({ where: { key: Q13C_SETTING_KEY } });
    const settingAuditIds = (await prisma.auditLog.findMany({ where: { entityType: 'SystemSetting', entityId: Q13C_SETTING_KEY }, select: { id: true }, orderBy: { createdAt: 'asc' } })).map((row) => row.id);
    const baseline = { version: 1, fixtureInitiallyPresent: false, departmentCode: Q13C_DEPARTMENT_CODE, siteCode: Q13C_SITE_CODE, settingKey: Q13C_SETTING_KEY, setting: setting ? { value: setting.value, description: setting.description, createdAt: setting.createdAt.toISOString(), updatedAt: setting.updatedAt.toISOString() } : null, settingAuditIds };
    writeSnapshot(environment, baseline);
    log('Q13C_PREVIEW_BASELINE_CAPTURED=PASS');
    return baseline;
  } finally { await prisma.$disconnect(); }
}

async function prepare({ environment = process.env, log = console.log } = {}) {
  assertQ13cPreviewExecutionContext(environment, { log });
  readSnapshot(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL, environment);
  try {
    const identity = await exactFixtureIdentity(prisma);
    if (identity.employee || identity.user) throw q13cError('Q13C_DISPOSABLE_FIXTURE_MUST_START_ABSENT');
    if (await prisma.departmentMaster.findUnique({ where: { code: Q13C_DEPARTMENT_CODE } })) throw q13cError('Q13C_DEPARTMENT_FIXTURE_ALREADY_EXISTS');
    if (await prisma.securitySite.findUnique({ where: { code: Q13C_SITE_CODE } })) throw q13cError('Q13C_SITE_FIXTURE_ALREADY_EXISTS');
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment: disposableEnvironment(environment) });
    const prepared = await exactFixtureIdentity(prisma);
    if (!prepared.employee || !prepared.user) throw q13cError('Q13C_FIXTURE_PREPARE_FAILED');
    log(JSON.stringify({ state: 'Q13C_PREVIEW_FIXTURE_READY', employeeCode: FIXTURE_EMPLOYEE_CODE }));
    return true;
  } finally { await prisma.$disconnect(); }
}

async function cleanup({ environment = process.env, log = console.log } = {}) {
  assertQ13cPreviewExecutionContext(environment, { log });
  const baseline = readSnapshot(environment);
  const prisma = createPrismaClient(environment.DATABASE_URL, environment);
  const result = { state: 'Q13C_PREVIEW_FIXTURE_CLEAN' };
  try {
    const site = await prisma.securitySite.findUnique({ where: { code: Q13C_SITE_CODE }, include: { qrCredentials: true } });
    if (site) {
      assertSiteFixture(site);
      const credentialIds = site.qrCredentials.map((row) => row.id);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM security_site_departments WHERE security_site_id = ${site.id}::uuid`;
        await tx.securitySiteQrCredential.deleteMany({ where: { securitySiteId: site.id } });
        await tx.auditLog.deleteMany({ where: { entityId: { in: [site.id, ...credentialIds] } } });
        await tx.securitySite.delete({ where: { id: site.id } });
      });
      result.securitySiteRemoved = true;
    } else result.securitySiteRemoved = false;

    const identity = await exactFixtureIdentity(prisma);
    if (identity.employee) {
      const requests = await prisma.employeeChangeRequest.findMany({ where: { employeeId: identity.employee.id }, select: { id: true, draftReason: true } });
      const foreign = requests.filter((row) => !String(row.draftReason || '').includes(Q13C_CHANGE_MARKER));
      if (foreign.length) throw q13cError('Q13C_FOREIGN_EMPLOYEE_CHANGE_REQUEST');
      await resetDisposableUatEmployee({ prismaClient: prisma, environment: disposableEnvironment(environment) });
      await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment: disposableEnvironment(environment) });
      const requestIds = requests.map((row) => row.id);
      if (requestIds.length) {
        const linkedLifecycle = await prisma.employeeLifecycleEvent.count({ where: { sourceChangeRequestId: { in: requestIds } } });
        if (linkedLifecycle) throw q13cError('Q13C_CHANGE_REQUEST_LIFECYCLE_NOT_RESET');
        await prisma.$transaction(async (tx) => {
          await tx.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
          await tx.employeeChangeRequestEvent.deleteMany({ where: { requestId: { in: requestIds } } });
          await tx.employeeChangeRequestRevision.deleteMany({ where: { requestId: { in: requestIds } } });
          await tx.employeeChangeRequest.deleteMany({ where: { id: { in: requestIds } } });
        });
      }
      const employeeId = identity.employee.id; const userId = identity.user.id;
      await prisma.$transaction(async (tx) => {
        await tx.refreshSession.deleteMany({ where: { userId } });
        await tx.authOtpChallenge.deleteMany({ where: { userId } });
        await tx.auditLog.deleteMany({ where: { OR: [{ entityId: employeeId }, { entityId: userId }, { entityType: 'DisposableUatEmployeeFixture', entityId: employeeId }] } });
        await tx.user.delete({ where: { id: userId } });
        await tx.employee.delete({ where: { id: employeeId } });
      });
      result.employeeChangeRequestsRemoved = requestIds.length;
      result.disposableFixtureRemoved = true;
    } else {
      if (identity.user) throw q13cError('Q13C_FIXTURE_IDENTITY_MISMATCH');
      result.employeeChangeRequestsRemoved = 0;
      result.disposableFixtureRemoved = false;
    }

    const department = await prisma.departmentMaster.findUnique({ where: { code: Q13C_DEPARTMENT_CODE } });
    if (department) {
      assertDepartmentFixture(department);
      const references = await prisma.employee.count({ where: { deletedAt: null, department: department.name } });
      if (references) throw q13cError('Q13C_DEPARTMENT_FIXTURE_STILL_REFERENCED');
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM security_site_departments WHERE department_master_id = ${department.id}::uuid`;
        await tx.auditLog.deleteMany({ where: { entityId: department.id } });
        await tx.departmentMaster.delete({ where: { id: department.id } });
      });
      result.departmentRemoved = true;
    } else result.departmentRemoved = false;

    const newSettingAudits = await prisma.auditLog.findMany({ where: { entityType: 'SystemSetting', entityId: Q13C_SETTING_KEY, ...(baseline.settingAuditIds.length ? { id: { notIn: baseline.settingAuditIds } } : {}) }, select: { id: true } });
    if (newSettingAudits.length) await prisma.auditLog.deleteMany({ where: { id: { in: newSettingAudits.map((row) => row.id) } } });
    if (baseline.setting) {
      await prisma.$executeRaw`INSERT INTO system_settings (key, value, description, created_at, updated_at) VALUES (${Q13C_SETTING_KEY}, ${baseline.setting.value}, ${baseline.setting.description}, ${new Date(baseline.setting.createdAt)}, ${new Date(baseline.setting.updatedAt)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: Q13C_SETTING_KEY } });
    }
    result.systemSettingRestored = true;

    const [remainingEmployee, remainingUser, remainingDepartment, remainingSite, remainingRequests, restoredSetting] = await Promise.all([
      prisma.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } }),
      prisma.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } }),
      prisma.departmentMaster.findUnique({ where: { code: Q13C_DEPARTMENT_CODE } }),
      prisma.securitySite.findUnique({ where: { code: Q13C_SITE_CODE } }),
      prisma.employeeChangeRequest.count({ where: { draftReason: { contains: Q13C_CHANGE_MARKER } } }),
      prisma.systemSetting.findUnique({ where: { key: Q13C_SETTING_KEY } })
    ]);
    if (remainingEmployee || remainingUser || remainingDepartment || remainingSite || remainingRequests) throw q13cError('Q13C_FIXTURE_CLEANUP_INCOMPLETE');
    if (baseline.setting) {
      if (!restoredSetting || restoredSetting.value !== baseline.setting.value || restoredSetting.description !== baseline.setting.description || restoredSetting.createdAt.toISOString() !== baseline.setting.createdAt || restoredSetting.updatedAt.toISOString() !== baseline.setting.updatedAt) throw q13cError('Q13C_SYSTEM_SETTING_RESTORE_MISMATCH');
    } else if (restoredSetting) throw q13cError('Q13C_SYSTEM_SETTING_RESTORE_MISMATCH');
    log('Q13C_PREVIEW_FIXTURE_CLEANUP=PASS');
    log(JSON.stringify(result));
    return result;
  } finally { await prisma.$disconnect(); }
}

async function main() {
  const command = String(process.argv[2] || '').trim().toLowerCase();
  try {
    if (command === 'diagnose') await diagnose();
    else if (command === 'snapshot') await snapshot();
    else if (command === 'prepare') await prepare();
    else if (command === 'cleanup') await cleanup();
    else throw q13cError('Q13C_COMMAND_INVALID');
  } catch (error) { console.error(safeDiagnosticCode(error)); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { Q13C_CONFIRMATION, Q13C_DEPARTMENT_CODE, Q13C_SITE_CODE, Q13C_SETTING_KEY, Q13C_CHANGE_MARKER, assertQ13cPreviewExecutionContext, cleanup, diagnose, prepare, snapshot };