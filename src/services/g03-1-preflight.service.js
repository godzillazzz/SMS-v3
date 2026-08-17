'use strict';

const { persistedUsageByQuotaYear, AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT } = require('./leave-annual-accounting.service');

async function classifyG031Data(prismaClient) {
  const [totalQuotaRows, linkedRows, unmatchedRows, rowsByMatchStatusRaw, linkedNullYearRows, annualYearRows, linkedRowsAll, annualRows, approvedCrossYear] = await Promise.all([
    prismaClient.leaveQuota.count(),
    prismaClient.leaveQuota.count({ where: { employeeId: { not: null } } }),
    prismaClient.leaveQuota.count({ where: { matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }),
    prismaClient.leaveQuota.groupBy({ by: ['matchStatus'], _count: { _all: true } }),
    prismaClient.leaveQuota.count({ where: { employeeId: { not: null }, quotaYear: null } }),
    prismaClient.leaveQuota.count({ where: { employeeId: { not: null }, quotaYear: { not: null } } }),
    prismaClient.leaveQuota.findMany({ where: { employeeId: { not: null } }, select: { employeeId: true, quotaYear: true } }),
    prismaClient.leaveQuota.findMany({ where: { employeeId: { not: null }, quotaYear: { not: null } }, select: { employeeId: true, quotaYear: true } }),
    prismaClient.leaveRequest.findMany({ where: { status: 'APPROVED' }, select: { id: true, startDate: true, endDate: true, dayCount: true } })
  ]);

  const linkedCounts = new Map();
  const linkedNullCounts = new Map();
  for (const row of linkedRowsAll) {
    linkedCounts.set(row.employeeId, (linkedCounts.get(row.employeeId) || 0) + 1);
    if (row.quotaYear === null) linkedNullCounts.set(row.employeeId, (linkedNullCounts.get(row.employeeId) || 0) + 1);
  }
  const employeesWithMultipleLinkedRows = [...linkedCounts.values()].filter((count) => count > 1).length;
  const employeesWithMultipleUnclassifiedLinkedRows = [...linkedNullCounts.values()].filter((count) => count > 1).length;

  const annualKeys = new Map();
  for (const row of annualRows) {
    const key = `${row.employeeId}:${row.quotaYear}`;
    annualKeys.set(key, (annualKeys.get(key) || 0) + 1);
  }
  const duplicateEmployeeYearAuthorities = [...annualKeys.values()].filter((count) => count > 1).length;

  let approvedCrossYearRequests = 0;
  let crossYearPersistedDayCountMismatch = 0;
  let fractionalCrossYearRequests = 0;
  let ambiguousLegacyCrossYearRequests = 0;
  for (const row of approvedCrossYear) {
    const startYear = new Date(row.startDate).getUTCFullYear();
    const endYear = new Date(row.endDate).getUTCFullYear();
    if (startYear === endYear) continue;
    approvedCrossYearRequests += 1;
    if (!Number.isInteger(Number(row.dayCount))) fractionalCrossYearRequests += 1;
    try {
      persistedUsageByQuotaYear(row);
    } catch (error) {
      if (error?.details?.code === AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT) {
        crossYearPersistedDayCountMismatch += 1;
        ambiguousLegacyCrossYearRequests += 1;
      } else throw error;
    }
  }

  const rowsByMatchStatus = Object.fromEntries(rowsByMatchStatusRaw.map((row) => [row.matchStatus, row._count._all]));
  const metrics = {
    totalQuotaRows,
    linkedRows,
    unmatchedRows,
    rowsByMatchStatus,
    linkedNullYearRows,
    annualYearRows,
    employeesWithMultipleLinkedRows,
    employeesWithMultipleUnclassifiedLinkedRows,
    duplicateEmployeeYearAuthorities,
    approvedCrossYearRequests,
    crossYearPersistedDayCountMismatch,
    fractionalCrossYearRequests,
    ambiguousLegacyCrossYearRequests
  };
  const remediationRequired = employeesWithMultipleUnclassifiedLinkedRows > 0 || duplicateEmployeeYearAuthorities > 0 || ambiguousLegacyCrossYearRequests > 0;
  return { classification: remediationRequired ? 'G03_1_DATA_INVARIANT_REQUIRES_REMEDIATION' : 'SAFE_FOR_G03_1_CUTOVER', metrics };
}

module.exports = { classifyG031Data };
