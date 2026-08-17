'use strict';

const { persistedUsageByQuotaYear, AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT } = require('./leave-annual-accounting.service');

function safeIssue(rule, id, description, detectedValue) {
  return {
    id: `${rule}:${id}`,
    rule,
    severity: 'CRITICAL',
    module: 'LEAVE_QUOTA',
    title: rule === 'LEAVE_QUOTA_YEAR_UNCLASSIFIED'
      ? 'ข้อมูลโควตาเดิมยังไม่ระบุปี'
      : rule === 'LEAVE_QUOTA_ANNUAL_DUPLICATE'
        ? 'พบสิทธิ์วันลารายปีซ้ำ'
        : 'ใบลาข้ามปีเดิมระบุจำนวนวันแบบแบ่งปีไม่ได้',
    description,
    entityType: rule === 'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT' ? 'LeaveRequest' : 'LeaveQuota',
    entityId: String(id),
    employeeCode: null,
    employeeName: null,
    department: null,
    detectedValue,
    targetPage: rule === 'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT' ? 'leaveHistory' : 'quota'
  };
}

async function unclassifiedRows(client) {
  if (typeof client.leaveQuota?.findMany !== 'function') return [];
  const rows = await client.leaveQuota.findMany({
    where: { quotaYear: null },
    select: { id: true, matchStatus: true },
    orderBy: { id: 'asc' }
  });
  return rows.map((row) => safeIssue('LEAVE_QUOTA_YEAR_UNCLASSIFIED', row.id, 'ต้องจัดประเภทปีอย่างชัดเจนก่อนใช้เป็นสิทธิ์รายปี', row.matchStatus));
}

async function duplicateAnnualRows(client) {
  if (typeof client.leaveQuota?.groupBy !== 'function') return [];
  const groups = await client.leaveQuota.groupBy({
    by: ['employeeId', 'quotaYear'],
    where: { employeeId: { not: null }, quotaYear: { not: null } },
    _count: { _all: true }
  });
  return groups
    .filter((row) => row._count._all > 1)
    .map((row, index) => safeIssue('LEAVE_QUOTA_ANNUAL_DUPLICATE', `group-${index + 1}`, 'พบมากกว่าหนึ่ง authoritative row สำหรับ Employee + Year', `year:${row.quotaYear};count:${row._count._all}`));
}

async function ambiguousCrossYearRows(client) {
  if (typeof client.leaveRequest?.findMany !== 'function') return [];
  const rows = await client.leaveRequest.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, startDate: true, endDate: true, dayCount: true },
    orderBy: { id: 'asc' }
  });
  const result = [];
  for (const row of rows) {
    if (new Date(row.startDate).getUTCFullYear() === new Date(row.endDate).getUTCFullYear()) continue;
    try {
      persistedUsageByQuotaYear(row);
    } catch (error) {
      if (error?.details?.code !== AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT) throw error;
      result.push(safeIssue('AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT', row.id, 'จำนวนวันเดิมไม่เท่ากับ native inclusive date span จึงห้ามเดาการแบ่งปี', 'DAY_COUNT_MISMATCH'));
    }
  }
  return result;
}

const CUSTOM_RULES = Object.freeze([
  { name: 'LEAVE_QUOTA_YEAR_UNCLASSIFIED', severity: 'CRITICAL', module: 'LEAVE_QUOTA', title: 'ข้อมูลโควตาเดิมยังไม่ระบุปี', rows: unclassifiedRows },
  { name: 'LEAVE_QUOTA_ANNUAL_DUPLICATE', severity: 'CRITICAL', module: 'LEAVE_QUOTA', title: 'พบสิทธิ์วันลารายปีซ้ำ', rows: duplicateAnnualRows },
  { name: 'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT', severity: 'CRITICAL', module: 'LEAVE_QUOTA', title: 'ใบลาข้ามปีเดิมแบ่งปีไม่ได้', rows: ambiguousCrossYearRows }
]);

module.exports = { safeIssue, unclassifiedRows, duplicateAnnualRows, ambiguousCrossYearRows, CUSTOM_RULES };
