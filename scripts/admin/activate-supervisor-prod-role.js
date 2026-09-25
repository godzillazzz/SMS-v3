const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../../src/config/prisma');
const { createUserAccessService } = require('../../src/services/user-access.service');

function getSupervisorClassifier() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/routes/operations.routes.js'), 'utf8');
  const match = source.match(/const isSupervisorPosition = \(employee\) => \/(.+?)\/\.test\(positionText\(employee\)\);/);
  if (!match) throw new Error('SUPERVISOR_CLASSIFIER_NOT_FOUND');
  const regex = new RegExp(match[1]);
  return (employee) => regex.test(String(employee?.jobTitle || '').toLowerCase());
}

function safeRecord(employee) {
  const user = employee.user || null;
  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    jobTitle: employee.jobTitle,
    employeeActive: employee.isActive,
    deletedAt: employee.deletedAt,
    userId: user?.id || null,
    email: user?.email || null,
    role: user?.role || null,
    userActive: user?.isActive ?? null,
    accountStatus: user?.accountStatus || null,
    passwordResetRequired: user?.passwordResetRequired ?? null
  };
}

async function main() {
  const classifySupervisor = getSupervisorClassifier();
  const startedAt = new Date();
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      employeeCode: true,
      displayName: true,
      jobTitle: true,
      isActive: true,
      deletedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          accountStatus: true,
          passwordResetRequired: true
        }
      }
    },
    orderBy: { employeeCode: 'asc' }
  });

  const classified = employees.filter(classifySupervisor).map(safeRecord);
  const active = classified.filter((r) => r.employeeActive === true && !r.deletedAt);
  const blockers = active.filter((r) => !r.userId || r.userActive !== true || r.accountStatus !== 'ACTIVE');
  const adminPreserve = active.filter((r) => r.role === 'ADMIN');
  const unsupported = active.filter((r) => r.userId && r.role && !['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(r.role));
  const targets = active.filter((r) =>
    r.userId &&
    r.userActive === true &&
    r.accountStatus === 'ACTIVE' &&
    ['MANAGER', 'VIEWER', 'SUPERVISOR'].includes(r.role)
  );

  fs.writeFileSync('supervisor-role-inventory.json', JSON.stringify({
    generatedAt: startedAt.toISOString(),
    classified,
    active,
    blockers,
    adminPreserve,
    targets
  }, null, 2));

  console.log('SUPERVISOR_CLASSIFIED_COUNT=' + classified.length);
  console.log('ACTIVE_SUPERVISOR_COUNT=' + active.length);
  console.log('TARGET_COUNT=' + targets.length);
  console.log('BLOCKER_COUNT=' + blockers.length);
  console.log('ADMIN_PRESERVE_COUNT=' + adminPreserve.length);
  console.log('ALREADY_SUPERVISOR_COUNT=' + targets.filter((r) => r.role === 'SUPERVISOR').length);
  console.log('NEEDS_MAPPING_COUNT=' + targets.filter((r) => r.role !== 'SUPERVISOR').length);
  console.log('TARGETS=' + JSON.stringify(targets));

  if (blockers.length) {
    console.log('BLOCKERS=' + JSON.stringify(blockers));
    throw new Error('SUPERVISOR_ROLE_MAPPING_BLOCKED_BY_ACCOUNT_STATE');
  }
  if (unsupported.length) throw new Error('SUPERVISOR_ROLE_MAPPING_UNSUPPORTED_ROLE');

  const admin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      isActive: true,
      accountStatus: 'ACTIVE',
      passwordResetRequired: false
    },
    orderBy: { id: 'asc' },
    select: { id: true, email: true }
  });
  if (!admin) throw new Error('ELIGIBLE_ADMIN_ACTOR_NOT_FOUND');

  const needsMapping = targets.filter((r) => r.role !== 'SUPERVISOR');
  fs.writeFileSync('supervisor-role-rollback.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    actorUserId: admin.id,
    entries: needsMapping.map((r) => ({
      userId: r.userId,
      email: r.email,
      employeeId: r.employeeId,
      employeeCode: r.employeeCode,
      previousRole: r.role
    }))
  }, null, 2));

  const service = createUserAccessService();
  for (const target of needsMapping) {
    await service.updateUserAccount({
      id: target.userId,
      input: { role: 'SUPERVISOR' },
      actorUserId: admin.id,
      actorRole: 'ADMIN'
    });
    console.log('ROLE_MAPPED=' + target.employeeCode + ';FROM=' + target.role + ';TO=SUPERVISOR');
  }

  const verifyUsers = targets.length
    ? await prisma.user.findMany({
        where: { id: { in: targets.map((r) => r.userId) } },
        select: { id: true, email: true, role: true, isActive: true, accountStatus: true, employeeId: true }
      })
    : [];

  const verifyMap = new Map(verifyUsers.map((u) => [u.id, u]));
  const failures = targets.filter((t) => {
    const u = verifyMap.get(t.userId);
    return !u || u.role !== 'SUPERVISOR' || u.isActive !== true || u.accountStatus !== 'ACTIVE' || u.employeeId !== t.employeeId;
  });
  if (failures.length) throw new Error('POST_MAPPING_VERIFY_FAILED:' + failures.length);

  fs.writeFileSync('supervisor-role-activation-summary.json', JSON.stringify({
    completedAt: new Date().toISOString(),
    actorUserId: admin.id,
    classifiedCount: classified.length,
    activeSupervisorCount: active.length,
    adminPreserveCount: adminPreserve.length,
    targetCount: targets.length,
    changedCount: needsMapping.length,
    verifiedCount: verifyUsers.length,
    auditPath: 'user-access.service.updateUserAccount',
    verified: verifyUsers
  }, null, 2));

  console.log('ROLE_MAPPING_CHANGED=' + needsMapping.length);
  console.log('ROLE_MAPPING_VERIFIED=' + verifyUsers.length);
  console.log('AUDIT_PATH=user-access.service.updateUserAccount');
  console.log('SUPERVISOR_ROLE_MAPPING=PASS');
}

main()
  .catch((error) => {
    console.error('SUPERVISOR_ROLE_MAPPING_FAILED=' + (error?.message || 'UNKNOWN'));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
