'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const LEAVE_QUOTA_BUCKETS = Object.freeze(['SICK', 'PERSONAL', 'VACATION', 'NONE']);
const CORE_LEAVE_TYPES = Object.freeze([
  Object.freeze({ id: 'core-sick', code: 'SICK', name: 'ลาป่วย', quotaBucket: 'SICK', isActive: true, isSystem: true, sortOrder: 10 }),
  Object.freeze({ id: 'core-personal', code: 'PERSONAL', name: 'ลากิจ', quotaBucket: 'PERSONAL', isActive: true, isSystem: true, sortOrder: 20 }),
  Object.freeze({ id: 'core-vacation', code: 'VACATION', name: 'ลาพักร้อน', quotaBucket: 'VACATION', isActive: true, isSystem: true, sortOrder: 30 })
]);

const AUDIT_FIELDS = ['code', 'name', 'quotaBucket', 'isActive', 'isSystem', 'sortOrder'];
const CORE_LEAVE_TYPE_THAI_NAMES = Object.freeze({
  SICK: 'ลาป่วย',
  PERSONAL: 'ลากิจ',
  VACATION: 'ลาพักร้อน'
});

function leaveTypeDisplayName(leaveType, leaveTypeNameSnapshot) {
  const snapshot = String(leaveTypeNameSnapshot || '').trim();
  if (snapshot) return snapshot;
  const code = String(leaveType || '').trim().toUpperCase();
  return CORE_LEAVE_TYPE_THAI_NAMES[code] || String(leaveType || '').trim();
}

function safeRecord(record) {
  return Object.fromEntries(AUDIT_FIELDS.map((field) => [field, record?.[field]]));
}

function canonicalLeaveTypeCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new HttpError(400, 'Leave type is required.', { code: 'LEAVE_TYPE_REQUIRED' });
  const lower = raw.toLowerCase();
  if (lower.includes('ป่วย') || lower.includes('sick')) return 'SICK';
  if (lower.includes('กิจ') || lower.includes('personal')) return 'PERSONAL';
  if (lower.includes('พักร้อน') || lower.includes('vacation')) return 'VACATION';
  const code = raw.toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
    throw new HttpError(400, 'Leave type code must use A-Z, 0-9, underscore, or hyphen.', { code: 'LEAVE_TYPE_CODE_INVALID' });
  }
  return code;
}

function canonicalQuotaBucket(value) {
  const bucket = String(value ?? '').trim().toUpperCase();
  if (!LEAVE_QUOTA_BUCKETS.includes(bucket)) {
    throw new HttpError(400, 'Unsupported leave quota bucket.', { code: 'LEAVE_TYPE_QUOTA_BUCKET_INVALID' });
  }
  return bucket;
}

function coreFallback(code) {
  return CORE_LEAVE_TYPES.find((item) => item.code === code) || null;
}

function leaveTypeSnapshot(row) {
  return Object.freeze({
    leaveTypeId: row?.id && !String(row.id).startsWith('core-') ? row.id : null,
    leaveType: String(row?.code || ''),
    leaveTypeNameSnapshot: String(row?.name || row?.code || ''),
    leaveQuotaBucketSnapshot: canonicalQuotaBucket(row?.quotaBucket || 'NONE')
  });
}

async function listLeaveTypes(client = prismaDefault, { includeInactive = false } = {}) {
  if (!client?.leaveTypeMaster?.findMany) {
    return CORE_LEAVE_TYPES.filter((item) => includeInactive || item.isActive).map((item) => ({ ...item }));
  }
  return client.leaveTypeMaster.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      quotaBucket: true,
      isActive: true,
      isSystem: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

async function resolveLeaveTypeForRequest(client, input, { allowInactiveId } = {}) {
  const code = canonicalLeaveTypeCode(input);

  let row;
  if (client?.leaveTypeMaster?.findUnique) {
    row = await client.leaveTypeMaster.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        name: true,
        quotaBucket: true,
        isActive: true,
        isSystem: true,
        sortOrder: true
      }
    });
  } else {
    row = coreFallback(code);
  }

  if (!row) throw new HttpError(400, 'Unsupported leave type.', { code: 'LEAVE_TYPE_NOT_FOUND', leaveTypeCode: code });
  if (!row.isActive && row.id !== allowInactiveId) {
    throw new HttpError(409, 'This leave type is inactive and cannot be used for a new request.', {
      code: 'LEAVE_TYPE_INACTIVE',
      leaveTypeCode: row.code
    });
  }
  canonicalQuotaBucket(row.quotaBucket);
  return row;
}

function createLeaveTypeService({ prisma = prismaDefault, audit = auditDefault } = {}) {
  async function create(data, actorUserId) {
    const code = canonicalLeaveTypeCode(data.code);
    const name = String(data.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Leave type name is required.', { code: 'LEAVE_TYPE_NAME_REQUIRED' });
    const quotaBucket = canonicalQuotaBucket(data.quotaBucket);
    const sortOrder = Number.isInteger(Number(data.sortOrder)) ? Number(data.sortOrder) : 100;
    const isActive = data.isActive !== false;

    return prisma.$transaction(async (tx) => {
      const existing = await tx.leaveTypeMaster.findUnique({ where: { code } });
      if (existing) throw new HttpError(409, 'Leave type code already exists.', { code: 'LEAVE_TYPE_CODE_EXISTS' });

      const created = await tx.leaveTypeMaster.create({
        data: { code, name, quotaBucket, isActive, isSystem: false, sortOrder }
      });

      await audit.log({
        actorUserId,
        action: 'CREATE',
        entityType: 'LeaveTypeMaster',
        entityId: created.id,
        metadata: { after: safeRecord(created) }
      }, tx);

      return created;
    });
  }

  async function update(id, data, actorUserId) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.leaveTypeMaster.findUnique({ where: { id } });
      if (!before) throw new HttpError(404, 'Leave type not found.', { code: 'LEAVE_TYPE_NOT_FOUND' });

      const next = {};
      if (Object.hasOwn(data, 'name')) {
        const name = String(data.name ?? '').trim();
        if (!name) throw new HttpError(400, 'Leave type name is required.', { code: 'LEAVE_TYPE_NAME_REQUIRED' });
        next.name = name;
      }
      if (Object.hasOwn(data, 'quotaBucket')) {
        const quotaBucket = canonicalQuotaBucket(data.quotaBucket);
        if (before.isSystem && quotaBucket !== before.quotaBucket) {
          throw new HttpError(409, 'Core leave type quota bucket cannot be changed.', {
            code: 'CORE_LEAVE_TYPE_QUOTA_BUCKET_IMMUTABLE',
            leaveTypeCode: before.code
          });
        }
        next.quotaBucket = quotaBucket;
      }
      if (Object.hasOwn(data, 'isActive')) next.isActive = Boolean(data.isActive);
      if (Object.hasOwn(data, 'sortOrder')) next.sortOrder = Number(data.sortOrder);

      if (!Object.keys(next).length) return before;
      const updated = await tx.leaveTypeMaster.update({ where: { id }, data: next });

      await audit.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'LeaveTypeMaster',
        entityId: id,
        metadata: { before: safeRecord(before), after: safeRecord(updated) }
      }, tx);

      return updated;
    });
  }

  async function list(options) {
    return listLeaveTypes(prisma, options);
  }

  return { list, create, update };
}

module.exports = {
  LEAVE_QUOTA_BUCKETS,
  CORE_LEAVE_TYPES,
  canonicalLeaveTypeCode,
  canonicalQuotaBucket,
  leaveTypeDisplayName,
  leaveTypeSnapshot,
  listLeaveTypes,
  resolveLeaveTypeForRequest,
  createLeaveTypeService
};
