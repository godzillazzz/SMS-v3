'use strict';

const prisma = require('../config/prisma');
const { bangkokQuotaYear, ensureAnnualQuota, LEAVE_QUOTA_LEGACY_AMBIGUOUS } = require('./annual-leave-quota.service');
const { isMultiYearWriteActivated } = require('./g03-1-multi-year-activation.service');
const { createLeavePolicyService } = require('./leave-policy.service');

async function provisionAnnualLeaveQuotas({ prismaClient = prisma, now = new Date(), batchSize = 100 } = {}) {
  const quotaYear = bangkokQuotaYear(now);
  const activated = await isMultiYearWriteActivated(prismaClient);
  if (!activated) {
    return { status: 'disabled', activation: 'inactive', eligible: 0, created: 0, existing: 0, ambiguous: 0, failed: 0, quotaYear };
  }
  const leavePolicySnapshot = await createLeavePolicyService({ prisma: prismaClient }).getPolicy(prismaClient);
  let cursor;
  const totals = { eligible: 0, created: 0, existing: 0, ambiguous: 0, failed: 0, quotaYear };
  while (true) {
    const employees = await prismaClient.employee.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!employees.length) break;
    totals.eligible += employees.length;
    for (const employee of employees) {
      try {
        const result = await ensureAnnualQuota({ employeeId: employee.id, quotaYear, source: 'CRON', prismaClient, leavePolicySnapshot });
        if (result.created) totals.created += 1;
        else totals.existing += 1;
      } catch (error) {
        if (error?.details?.code === LEAVE_QUOTA_LEGACY_AMBIGUOUS || error?.details?.code === 'LEAVE_QUOTA_LEGACY_AMBIGUOUS') totals.ambiguous += 1;
        else totals.failed += 1;
      }
    }
    cursor = employees[employees.length - 1].id;
    if (employees.length < batchSize) break;
  }
  return totals;
}

module.exports = { provisionAnnualLeaveQuotas };
