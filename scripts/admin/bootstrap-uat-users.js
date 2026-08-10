const bcrypt = require('bcryptjs');

const CONFIRMATION = 'CREATE_SMS_V3_STAGING_UAT_USERS';
const ACCOUNT_SPECS = [
  { key: 'UAT_ADMIN', displayName: 'UAT Automation Admin', role: 'ADMIN' },
  { key: 'UAT_MANAGER', displayName: 'UAT Automation Manager', role: 'MANAGER' },
  { key: 'UAT_VIEWER', displayName: 'UAT Automation Viewer', role: 'VIEWER' }
];

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function databaseErrorCode(error) {
  if (error?.code === 'P1000') return 'DATABASE_AUTH_FAILED';
  if (error?.code === 'P1001') return 'DATABASE_UNREACHABLE';
  if (error?.code === 'P2024') return 'DATABASE_POOL_TIMEOUT';
  return 'UAT_BOOTSTRAP_FAILED';
}

function createBootstrapPrismaClient(databaseUrl) {
  if (!databaseUrl) throw safeError('UAT_BOOTSTRAP_DATABASE_URL_MISSING');
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function requiredEnvironment(spec) {
  return [`${spec.key}_EMAIL`, `${spec.key}_PASSWORD`];
}

function readBootstrapConfig(environment = process.env, args = process.argv.slice(2)) {
  if (environment.UAT_BOOTSTRAP_CONFIRM !== CONFIRMATION) throw safeError('UAT_BOOTSTRAP_CONFIRMATION_REQUIRED');
  const missing = ACCOUNT_SPECS.flatMap(requiredEnvironment).filter((key) => !String(environment[key] || '').trim());
  if (missing.length) throw safeError(`UAT_BOOTSTRAP_CONFIGURATION_MISSING:${missing.join(',')}`);

  const accounts = ACCOUNT_SPECS.map((spec) => ({
    ...spec,
    email: String(environment[`${spec.key}_EMAIL`]).trim().toLowerCase(),
    password: String(environment[`${spec.key}_PASSWORD`])
  }));
  const emails = new Set(accounts.map((account) => account.email));
  if (emails.size !== accounts.length || accounts.some((account) => !/^\S+@\S+\.\S+$/.test(account.email))) throw safeError('UAT_BOOTSTRAP_INVALID_EMAILS');

  return { accounts, dryRun: args.includes('--dry-run') };
}

function intendedAccount(account) {
  return {
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    isActive: true,
    accountStatus: 'ACTIVE',
    passwordResetRequired: false,
    employeeId: null
  };
}

function accountConflict(existing, account) {
  return existing && (existing.displayName !== account.displayName || existing.employeeId !== null);
}

async function inspectAccount(client, account, verifyPassword) {
  const existing = await client.user.findUnique({
    where: { email: account.email },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isActive: true,
      accountStatus: true,
      passwordResetRequired: true,
      employeeId: true,
      passwordHash: true
    }
  });
  if (!existing) return { account, existing: null, action: 'CREATE' };
  if (accountConflict(existing, account)) return { account, existing, action: 'CONFLICT' };

  const passwordMatches = await verifyPassword(account.password, existing.passwordHash);
  const requiresRepair = !passwordMatches
    || existing.role !== account.role
    || existing.isActive !== true
    || existing.accountStatus !== 'ACTIVE'
    || existing.passwordResetRequired !== false;
  return { account, existing, action: requiresRepair ? 'UPDATE' : 'EXISTS' };
}

async function inspectAccounts(client, accounts, verifyPassword = bcrypt.compare) {
  return Promise.all(accounts.map((account) => inspectAccount(client, account, verifyPassword)));
}

function assertNoConflict(inspections) {
  if (inspections.some((inspection) => inspection.action === 'CONFLICT')) throw safeError('UAT_BOOTSTRAP_ACCOUNT_CONFLICT');
}

async function provisionUatUsers({ prismaClient, config, hashPassword = bcrypt.hash, verifyPassword = bcrypt.compare }) {
  const runner = async (client) => {
    const inspections = await inspectAccounts(client, config.accounts, verifyPassword);
    assertNoConflict(inspections);
    if (config.dryRun) return inspections;

    const results = [];
    for (const inspection of inspections) {
      const { account, existing, action } = inspection;
      if (action === 'EXISTS') {
        results.push(inspection);
        continue;
      }

      const passwordHash = await hashPassword(account.password, 12);
      if (!existing) {
        await client.user.create({ data: { ...intendedAccount(account), passwordHash } });
        results.push({ ...inspection, action: 'CREATE' });
        continue;
      }

      await client.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: account.role,
          isActive: true,
          accountStatus: 'ACTIVE',
          passwordResetRequired: false,
          failedLoginCount: 0,
          tokenVersion: { increment: 1 }
        }
      });
      results.push({ ...inspection, action: 'UPDATE' });
    }
    return results;
  };

  if (config.dryRun) return runner(prismaClient);
  return prismaClient.$transaction(runner, { isolationLevel: 'Serializable' });
}

function printSummary(inspections) {
  for (const inspection of inspections) {
    const action = inspection.action === 'UPDATE' ? 'EXISTS' : inspection.action;
    console.log(`${inspection.account.key} .... ${action}`);
  }
}

async function main() {
  let prisma;
  try {
    const config = readBootstrapConfig();
    prisma = createBootstrapPrismaClient(process.env.DATABASE_URL);
    const results = await provisionUatUsers({ prismaClient: prisma, config });
    printSummary(results);
  } catch (error) {
    console.error(`UAT bootstrap failed: ${error?.code || databaseErrorCode(error)}`);
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

if (require.main === module) main();

module.exports = {
  ACCOUNT_SPECS,
  CONFIRMATION,
  accountConflict,
  createBootstrapPrismaClient,
  databaseErrorCode,
  inspectAccounts,
  intendedAccount,
  provisionUatUsers,
  readBootstrapConfig
};
