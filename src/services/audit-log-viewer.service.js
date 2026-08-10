'use strict';

const { z } = require('zod');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 24;
const MAX_METADATA_ARRAY_ITEMS = 24;
const MAX_METADATA_STRING_LENGTH = 512;
const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'REFRESH', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REUSE'];
const TECHNICAL_ACTIONS = new Set(['REFRESH', 'TOKEN_REUSE']);
const SENSITIVE_KEY_FRAGMENTS = ['password', 'secret', 'token', 'authorization', 'cookie', 'otp', 'apikey', 'jwt', 'refresh', 'access', 'database', 'connectionstring', 'storagekey', 'signedurl'];

const optionalText = (max) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).max(max).optional()
);
const dateText = optionalText(10).refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date must use YYYY-MM-DD.');

const auditLogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  dateFrom: dateText,
  dateTo: dateText,
  actorUserId: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().uuid().optional()),
  actor: optionalText(120),
  entityType: optionalText(100),
  action: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.enum(AUDIT_ACTIONS).optional()),
  search: optionalText(120),
  category: z.preprocess((value) => value === undefined || value === '' ? 'default' : value, z.enum(['default', 'technical', 'all']))
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'dateTo must not be before dateFrom.' });
  }
});

function bangkokDateStart(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - (7 * 60 * 60 * 1000));
}

function nextBangkokDateStart(value) {
  const start = bangkokDateStart(value);
  return new Date(start.getTime() + 86400000);
}

function isTechnicalEvent(event) {
  return TECHNICAL_ACTIONS.has(String(event.action || '')) || String(event.entityType || '') === 'RefreshSession';
}

function auditCategory(event) {
  if (isTechnicalEvent(event)) return 'TECHNICAL';
  if (['LOGIN', 'LOGIN_FAILED', 'LOGOUT_ALL'].includes(String(event.action || ''))) return 'SECURITY';
  return 'BUSINESS';
}

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > MAX_METADATA_STRING_LENGTH ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_METADATA_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, MAX_METADATA_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const output = {};
  for (const [key, nested] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    output[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(nested, depth + 1);
  }
  return output;
}

function sanitizeAuditMetadata(value) {
  const sanitized = sanitizeValue(value);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_METADATA_BYTES) return sanitized;
  return { notice: 'Metadata is too large to display safely.', truncated: true };
}

function technicalWhere() {
  return { OR: [{ action: { in: [...TECHNICAL_ACTIONS] } }, { entityType: 'RefreshSession' }] };
}

function buildAuditLogWhere(filters) {
  const where = {};
  const conditions = [];

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = bangkokDateStart(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lt = nextBangkokDateStart(filters.dateTo);
  }
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  if (filters.entityType) where.entityType = { equals: filters.entityType, mode: 'insensitive' };
  if (filters.action) where.action = filters.action;
  if (filters.actor) {
    conditions.push({ actor: { is: { displayName: { contains: filters.actor, mode: 'insensitive' } } } });
  }
  if (filters.search) {
    const actionMatch = AUDIT_ACTIONS.includes(filters.search.toUpperCase()) ? [{ action: filters.search.toUpperCase() }] : [];
    conditions.push({
      OR: [
        { entityType: { contains: filters.search, mode: 'insensitive' } },
        { entityId: { contains: filters.search, mode: 'insensitive' } },
        { actor: { is: { displayName: { contains: filters.search, mode: 'insensitive' } } } },
        ...actionMatch
      ]
    });
  }
  if (filters.category === 'default') conditions.push({ NOT: technicalWhere() });
  if (filters.category === 'technical') conditions.push(technicalWhere());
  if (conditions.length) where.AND = conditions;
  return where;
}

function moduleForEntity(entityType) {
  const value = String(entityType || '');
  if (/^Leave/.test(value)) return 'LEAVE';
  if (/License/.test(value) || /^EmployeeLicense/.test(value)) return 'LICENSE';
  if (/Shift|Schedule/.test(value)) return 'SCHEDULE';
  if (/Employee|User|ViewAs|Refresh/.test(value)) return 'USER_ACCESS';
  if (/Quota/.test(value)) return 'QUOTA';
  if (/Setting/.test(value)) return 'SYSTEM';
  return 'OTHER';
}

function presentAuditLog(row) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    module: moduleForEntity(row.entityType),
    category: auditCategory(row),
    metadata: sanitizeAuditMetadata(row.metadata),
    createdAt: row.createdAt,
    actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName, role: row.actor.role } : null
  };
}

async function getAuditLogPage({ prismaClient, query }) {
  const filters = auditLogQuery.parse(query);
  const where = buildAuditLogWhere(filters);
  const select = {
    id: true,
    action: true,
    entityType: true,
    entityId: true,
    metadata: true,
    createdAt: true,
    actor: { select: { id: true, displayName: true, role: true } }
  };
  const [total, rows] = await prismaClient.$transaction([
    prismaClient.auditLog.count({ where }),
    prismaClient.auditLog.findMany({
      where,
      select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize
    })
  ]);
  return {
    data: rows.map(presentAuditLog),
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize)
    },
    filters
  };
}

module.exports = {
  AUDIT_ACTIONS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  auditCategory,
  auditLogQuery,
  bangkokDateStart,
  buildAuditLogWhere,
  getAuditLogPage,
  isSensitiveKey,
  isTechnicalEvent,
  moduleForEntity,
  presentAuditLog,
  sanitizeAuditMetadata
};
