'use strict';

const { z } = require('zod');
const prisma = require('../config/prisma');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEVERITIES = ['CRITICAL', 'WARNING', 'INFO'];
const MODULES = ['LEAVE_QUOTA', 'LICENSE'];
const RULE_NAMES = [
  'LEAVE_QUOTA_UNMATCHED',
  'LICENSE_EXPIRED',
  'LICENSE_EXPIRING_WITHIN_30_DAYS',
  'LICENSE_EXPIRING_31_TO_90_DAYS'
];
const UNMATCHED_QUOTA_STATUSES = ['UNMATCHED', 'DUPLICATE_UNMATCHED'];

const dataQualityQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  severity: z.enum(SEVERITIES).optional(),
  module: z.enum(MODULES).optional(),
  rule: z.enum(RULE_NAMES).optional(),
  department: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).optional()
});

function dateStart(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateAfterDays(value, days) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function employeeTextWhere(search) {
  if (!search) return undefined;
  return [
    { employeeCode: { contains: search, mode: 'insensitive' } },
    { firstName: { contains: search, mode: 'insensitive' } },
    { lastName: { contains: search, mode: 'insensitive' } },
    { displayName: { contains: search, mode: 'insensitive' } },
    { department: { contains: search, mode: 'insensitive' } }
  ];
}

function employeeRelationWhere(filters) {
  const where = { deletedAt: null };
  if (filters.department) where.department = filters.department;
  if (filters.employeeId) where.id = filters.employeeId;
  const textWhere = employeeTextWhere(filters.search);
  if (textWhere) where.OR = textWhere;
  return { is: where };
}

function appendAnd(where, clauses) {
  const existing = Array.isArray(where.AND) ? where.AND : [];
  return { ...where, AND: [...existing, ...clauses] };
}

function quotaWhere(filters) {
  let where = { matchStatus: { in: UNMATCHED_QUOTA_STATUSES } };
  if (filters.department || filters.employeeId || filters.search) where = appendAnd(where, [{ employee: employeeRelationWhere(filters) }]);
  if (filters.search) {
    where = appendAnd(where, [{
      OR: [
        { employeeNameSnapshot: { contains: filters.search, mode: 'insensitive' } },
        { employee: employeeRelationWhere(filters) }
      ]
    }]);
  }
  return where;
}

function licenseWhere(filters, expiryWhere) {
  let where = { status: 'APPROVED', isCurrent: true, ...expiryWhere, employee: employeeRelationWhere(filters) };
  if (filters.search) {
    where = appendAnd(where, [{
      OR: [
        { proposedLicenseNumber: { contains: filters.search, mode: 'insensitive' } },
        { employee: employeeRelationWhere(filters) }
      ]
    }]);
  }
  return where;
}

function expiredLicenseWhere(filters, todayStart) {
  let where = {
    isCurrent: true,
    employee: employeeRelationWhere(filters),
    OR: [
      { status: 'EXPIRED' },
      { status: 'APPROVED', proposedExpiryDate: { lt: todayStart } }
    ]
  };
  if (filters.search) {
    where = appendAnd(where, [{
      OR: [
        { proposedLicenseNumber: { contains: filters.search, mode: 'insensitive' } },
        { employee: employeeRelationWhere(filters) }
      ]
    }]);
  }
  return where;
}

function employeeSelect() {
  return { employeeCode: true, firstName: true, lastName: true, displayName: true, department: true };
}

function employeeName(employee) {
  return String(employee?.displayName || `${employee?.firstName || ''} ${employee?.lastName || ''}`).trim() || null;
}

function mapQuotaIssue(row, rule) {
  return {
    id: `${rule.name}:${row.id}`,
    rule: rule.name,
    severity: rule.severity,
    module: rule.module,
    title: 'โควต้าวันลายังไม่จับคู่',
    description: `สถานะการจับคู่ ${row.matchStatus}`,
    entityType: 'LeaveQuota',
    entityId: row.id,
    employeeCode: row.employee?.employeeCode || null,
    employeeName: employeeName(row.employee) || row.employeeNameSnapshot,
    department: row.employee?.department || null,
    detectedValue: row.matchStatus,
    targetPage: 'quota'
  };
}

function mapLicenseIssue(row, rule) {
  const expiryDate = row.proposedExpiryDate instanceof Date ? row.proposedExpiryDate : new Date(row.proposedExpiryDate);
  return {
    id: `${rule.name}:${row.id}`,
    rule: rule.name,
    severity: rule.severity,
    module: rule.module,
    title: rule.title,
    description: rule.description,
    entityType: 'EmployeeLicenseDocument',
    entityId: row.id,
    employeeCode: row.employee?.employeeCode || null,
    employeeName: employeeName(row.employee),
    department: row.employee?.department || null,
    detectedValue: Number.isNaN(expiryDate.getTime()) ? null : expiryDate.toISOString().slice(0, 10),
    targetPage: 'licenses'
  };
}

function buildRuleDefinitions(filters, now = new Date()) {
  const todayStart = dateStart(now);
  const expiry30 = dateAfterDays(todayStart, 30);
  const expiry90 = dateAfterDays(todayStart, 90);
  const licenseSelect = {
    id: true,
    employeeId: true,
    proposedExpiryDate: true,
    proposedLicenseNumber: true,
    employee: { select: employeeSelect() }
  };
  const quotaSelect = {
    id: true,
    employeeId: true,
    employeeNameSnapshot: true,
    matchStatus: true,
    employee: { select: employeeSelect() }
  };
  const rules = [
    {
      name: 'LEAVE_QUOTA_UNMATCHED', severity: 'CRITICAL', module: 'LEAVE_QUOTA',
      title: 'โควต้าวันลายังไม่จับคู่', description: 'พบรายการโควต้าที่ระบบยังจับคู่กับพนักงานไม่ได้',
      model: 'leaveQuota', select: quotaSelect, orderBy: [{ employeeNameSnapshot: 'asc' }, { id: 'asc' }],
      where: () => quotaWhere(filters), map: mapQuotaIssue
    },
    {
      name: 'LICENSE_EXPIRED', severity: 'CRITICAL', module: 'LICENSE',
      title: 'ใบอนุญาตหมดอายุ', description: 'พบใบอนุญาตปัจจุบันที่หมดอายุแล้ว',
      model: 'employeeLicenseDocument', select: licenseSelect, orderBy: [{ proposedExpiryDate: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
      where: () => expiredLicenseWhere(filters, todayStart), map: mapLicenseIssue
    },
    {
      name: 'LICENSE_EXPIRING_WITHIN_30_DAYS', severity: 'WARNING', module: 'LICENSE',
      title: 'ใบอนุญาตใกล้หมดอายุภายใน 30 วัน', description: 'พบใบอนุญาตปัจจุบันที่ใกล้หมดอายุภายใน 30 วัน',
      model: 'employeeLicenseDocument', select: licenseSelect, orderBy: [{ proposedExpiryDate: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
      where: () => licenseWhere(filters, { proposedExpiryDate: { gte: todayStart, lte: expiry30 } }), map: mapLicenseIssue
    },
    {
      name: 'LICENSE_EXPIRING_31_TO_90_DAYS', severity: 'INFO', module: 'LICENSE',
      title: 'ใบอนุญาตใกล้หมดอายุภายใน 31–90 วัน', description: 'พบใบอนุญาตปัจจุบันที่ใกล้หมดอายุในช่วง 31–90 วัน',
      model: 'employeeLicenseDocument', select: licenseSelect, orderBy: [{ proposedExpiryDate: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
      where: () => licenseWhere(filters, { proposedExpiryDate: { gt: expiry30, lte: expiry90 } }), map: mapLicenseIssue
    }
  ];
  return rules
    .filter((rule) => !filters.severity || rule.severity === filters.severity)
    .filter((rule) => !filters.module || rule.module === filters.module)
    .filter((rule) => !filters.rule || rule.name === filters.rule);
}

async function getDataQualityIssues({ prismaClient = prisma, query = {}, now = new Date() } = {}) {
  const filters = dataQualityQuery.parse(query);
  const rules = buildRuleDefinitions(filters, now);
  const counts = [];

  for (const rule of rules) {
    const count = await prismaClient[rule.model].count({ where: rule.where() });
    counts.push({ rule, count });
  }

  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const summary = { total, critical: 0, warning: 0, info: 0 };
  counts.forEach(({ rule, count }) => { summary[rule.severity.toLowerCase()] += count; });
  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.pageSize);
  const data = [];
  let offset = (filters.page - 1) * filters.pageSize;

  for (const { rule, count } of counts) {
    if (data.length >= filters.pageSize) break;
    if (offset >= count) {
      offset -= count;
      continue;
    }
    const rows = await prismaClient[rule.model].findMany({
      where: rule.where(),
      select: rule.select,
      orderBy: rule.orderBy,
      skip: offset,
      take: Math.min(filters.pageSize - data.length, count - offset)
    });
    data.push(...rows.map((row) => rule.map(row, rule)));
    offset = 0;
  }

  return {
    summary,
    data,
    meta: { page: filters.page, pageSize: filters.pageSize, total, totalPages }
  };
}

async function getDataQualitySummary({ prismaClient = prisma, filters = {}, now = new Date() } = {}) {
  const rules = buildRuleDefinitions(filters, now);
  const summary = { total: 0, critical: 0, warning: 0, info: 0 };
  const categories = [];

  for (const rule of rules) {
    const count = await prismaClient[rule.model].count({ where: rule.where() });
    summary.total += count;
    summary[rule.severity.toLowerCase()] += count;
    categories.push({ rule: rule.name, severity: rule.severity, module: rule.module, title: rule.title, count });
  }

  return { summary, categories };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  RULE_NAMES,
  dataQualityQuery,
  buildRuleDefinitions,
  getDataQualityIssues,
  getDataQualitySummary
};
