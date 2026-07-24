const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const emptyTargetModels = [
  'shiftType',
  'shiftAssignment',
  'employeeLicense',
  'leaveRequest',
  'leaveQuota',
  'scheduleApproval',
  'scheduleApprovalEvent',
  'schedulingRule',
  'systemSetting',
  'legacyUserAuditEvent',
  'legacyLicenseAuditEvent'
];

async function runStage(name, work) {
  try {
    return await work();
  } catch (error) {
    const category = /^P\d{4}$/.test(error?.code)
      ? error.code
      : String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    throw new Error(`Legacy import stage ${name} failed (${category}).`);
  }
}

async function assertCleanTarget(tx, plan) {
  const counts = await Promise.all(emptyTargetModels.map((model) => tx[model].count()));
  if (counts.some((count) => count !== 0)) {
    throw new Error('Legacy migration target tables are not empty; manual review is required.');
  }
  if (await tx.employee.count({ where: { legacyEmployeeId: { not: null } } })) {
    throw new Error('Target already contains legacy employee records.');
  }
  if (await tx.user.count({ where: { legacyUserId: { not: null } } })) {
    throw new Error('Target already contains legacy user records.');
  }
  if (await tx.shiftType.count({ where: { code: { in: plan.shiftTypes.map((row) => row.code) } } })) {
    throw new Error('Target contains a conflicting shift type.');
  }
  if (await tx.employee.count({ where: { OR: [
    { employeeCode: { in: plan.employees.map((row) => row.employeeCode) } },
    { legacyEmployeeId: { in: plan.employees.map((row) => row.legacyEmployeeId) } }
  ] } })) {
    throw new Error('Target contains a conflicting employee identity.');
  }
  if (await tx.user.count({ where: { OR: [
    { email: { in: plan.users.map((row) => row.email) } },
    { legacyUserId: { in: plan.users.map((row) => row.legacyUserId) } }
  ] } })) {
    throw new Error('Target contains a conflicting user identity.');
  }
}

function without(row, ...keys) {
  const result = { ...row };
  keys.forEach((key) => delete result[key]);
  return result;
}

async function importLegacyPlan(prisma, plan) {
  const usersWithSafeHashes = await Promise.all(plan.users.map(async (user) => ({
    ...user,
    passwordHash: await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12)
  })));

  return prisma.$transaction(async (tx) => {
    await assertCleanTarget(tx, plan);

    await runStage('employees', () => tx.employee.createMany({ data: plan.employees }));
    await runStage('shift-types', () => tx.shiftType.createMany({ data: plan.shiftTypes }));

    const employeeRecords = await tx.employee.findMany({
      where: { legacyEmployeeId: { in: plan.employees.map((row) => row.legacyEmployeeId) } },
      select: { id: true, legacyEmployeeId: true }
    });
    const shiftTypeRecords = await tx.shiftType.findMany({
      where: { code: { in: plan.shiftTypes.map((row) => row.code) } },
      select: { id: true, code: true }
    });
    const employeeIds = new Map(employeeRecords.map((row) => [row.legacyEmployeeId.toLowerCase(), row.id]));
    const shiftTypeIds = new Map(shiftTypeRecords.map((row) => [row.code.toLowerCase(), row.id]));
    const employeeIdFor = (legacyId) => employeeIds.get(legacyId.toLowerCase());
    const shiftTypeIdFor = (code) => shiftTypeIds.get(code.toLowerCase());

    await runStage('users', async () => {
      for (const row of usersWithSafeHashes) {
        await tx.user.create({
          data: {
            ...without(row, 'employeeLegacyId'),
            employeeId: row.employeeLegacyId ? employeeIdFor(row.employeeLegacyId) : null
          }
        });
      }
    });
    await runStage('employee-licenses', () => tx.employeeLicense.createMany({
      data: plan.employeeLicenses.map((row) => ({
        ...without(row, 'employeeLegacyId'),
        employeeId: employeeIdFor(row.employeeLegacyId)
      }))
    }));
    await runStage('shift-assignments', () => tx.shiftAssignment.createMany({
      data: plan.shiftAssignments.map((row) => ({
        ...without(row, 'employeeLegacyId', 'shiftCode'),
        employeeId: employeeIdFor(row.employeeLegacyId),
        shiftTypeId: shiftTypeIdFor(row.shiftCode)
      }))
    }));
    await runStage('leave-requests', () => tx.leaveRequest.createMany({
      data: plan.leaveRequests.map((row) => ({
        ...without(row, 'employeeLegacyId'),
        employeeId: employeeIdFor(row.employeeLegacyId)
      }))
    }));
    await runStage('leave-quotas', () => tx.leaveQuota.createMany({
      data: plan.leaveQuotas.map((row) => ({
        ...without(row, 'employeeLegacyId'),
        employeeId: row.employeeLegacyId ? employeeIdFor(row.employeeLegacyId) : null
      }))
    }));
    await runStage('schedule-approvals', () => tx.scheduleApproval.createMany({ data: plan.scheduleApprovals }));
    await runStage('schedule-approval-events', () => tx.scheduleApprovalEvent.createMany({ data: plan.scheduleApprovalEvents }));
    await runStage('rules', () => tx.schedulingRule.createMany({ data: plan.rules }));
    await runStage('settings', () => tx.systemSetting.createMany({ data: plan.settings }));
    await runStage('user-audit-events', () => tx.legacyUserAuditEvent.createMany({ data: plan.userAuditEvents }));
    await runStage('license-audit-events', () => tx.legacyLicenseAuditEvent.createMany({ data: plan.licenseAuditEvents }));
    await runStage('migration-audit', () => tx.auditLog.create({
      data: {
        actorUserId: null,
        action: 'CREATE',
        entityType: 'LegacyMigration',
        entityId: 'google-sheets-sms-import',
        metadata: { counts: plan.summary, passwordHashesImported: false }
      }
    }));

    const verification = {
      employees: await tx.employee.count({ where: { legacyEmployeeId: { not: null } } }),
      users: await tx.user.count({ where: { legacyUserId: { not: null } } }),
      shiftTypes: await tx.shiftType.count(),
      shiftAssignments: await tx.shiftAssignment.count(),
      employeeLicenses: await tx.employeeLicense.count(),
      leaveRequests: await tx.leaveRequest.count(),
      leaveQuotas: await tx.leaveQuota.count(),
      scheduleApprovals: await tx.scheduleApproval.count(),
      scheduleApprovalEvents: await tx.scheduleApprovalEvent.count(),
      userAuditEvents: await tx.legacyUserAuditEvent.count(),
      licenseAuditEvents: await tx.legacyLicenseAuditEvent.count(),
      rules: await tx.schedulingRule.count(),
      settings: await tx.systemSetting.count()
    };
    const expected = Object.fromEntries(Object.keys(verification).map((key) => [key, plan.summary[key]]));
    if (JSON.stringify(verification) !== JSON.stringify(expected)) {
      throw new Error('Post-import row-count verification failed; the transaction was rolled back.');
    }
    return verification;
  }, { maxWait: 20000, timeout: 180000 });
}

module.exports = { importLegacyPlan, assertCleanTarget, runStage };
