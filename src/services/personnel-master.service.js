'use strict';

const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('en-US');
const modelFor = (client, kind) => kind === 'department' ? client.departmentMaster : client.positionMaster;
const entityFor = (kind) => kind === 'department' ? 'DepartmentMaster' : 'PositionMaster';

function cleanInput(input = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'ชื่อ Master ต้องมี 1-100 ตัวอักษร', { code: 'PERSONNEL_MASTER_INVALID_NAME' });
  const sortOrder = Number(input.sortOrder || 0);
  if (!Number.isInteger(sortOrder) || sortOrder < -9999 || sortOrder > 9999) throw new HttpError(400, 'sortOrder ไม่ถูกต้อง', { code: 'PERSONNEL_MASTER_INVALID_SORT_ORDER' });
  return { name, normalizedName: normalizeName(name), isActive: input.isActive !== false, sortOrder };
}

async function list({ prismaClient = prisma, activeOnly = false } = {}) {
  const where = activeOnly ? { isActive: true } : {};
  const orderBy = [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }];
  const [departments, positions] = await prismaClient.$transaction([
    prismaClient.departmentMaster.findMany({ where, orderBy }),
    prismaClient.positionMaster.findMany({ where, orderBy })
  ]);
  return { departments, positions };
}

async function assertActiveValue(client, kind, value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const row = await modelFor(client, kind).findUnique({ where: { normalizedName: normalizeName(value) } });
  if (!row || !row.isActive) throw new HttpError(409, kind === 'department' ? 'หน่วยงานใหม่ต้องเลือกจาก Department Master ที่ Active' : 'ตำแหน่งใหม่ต้องเลือกจาก Position Master ที่ Active', { code: 'PERSONNEL_MASTER_ACTIVE_VALUE_REQUIRED', kind, value: String(value) });
  return row.name;
}

async function create({ kind, input, actorUserId, prismaClient = prisma, auditService = audit }) {
  const data = cleanInput(input);
  try {
    return await prismaClient.$transaction(async (tx) => {
      const row = await modelFor(tx, kind).create({ data });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: entityFor(kind), entityId: row.id, metadata: { name: row.name, isActive: row.isActive, sortOrder: row.sortOrder } }, tx);
      return row;
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new HttpError(409, 'มี Master ชื่อนี้อยู่แล้ว', { code: 'PERSONNEL_MASTER_DUPLICATE' });
    throw error;
  }
}

async function update({ kind, id, input, actorUserId, prismaClient = prisma, auditService = audit }) {
  return prismaClient.$transaction(async (tx) => {
    const model = modelFor(tx, kind);
    const before = await model.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'ไม่พบ Master ที่ต้องการแก้ไข', { code: 'PERSONNEL_MASTER_NOT_FOUND' });
    const data = cleanInput({ name: input.name ?? before.name, sortOrder: input.sortOrder ?? before.sortOrder, isActive: input.isActive ?? before.isActive });
    let row;
    try { row = await model.update({ where: { id }, data }); }
    catch (error) { if (error?.code === 'P2002') throw new HttpError(409, 'มี Master ชื่อนี้อยู่แล้ว', { code: 'PERSONNEL_MASTER_DUPLICATE' }); throw error; }
    await auditService.log({ actorUserId, action: 'UPDATE', entityType: entityFor(kind), entityId: row.id, metadata: { before: { name: before.name, isActive: before.isActive, sortOrder: before.sortOrder }, after: { name: row.name, isActive: row.isActive, sortOrder: row.sortOrder } } }, tx);
    return row;
  });
}

module.exports = { normalizeName, list, assertActiveValue, create, update };
