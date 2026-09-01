'use strict';

const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('en-US');
const modelFor = (client, kind) => kind === 'department' ? client.departmentMaster : client.positionMaster;
const entityFor = (kind) => kind === 'department' ? 'DepartmentMaster' : 'PositionMaster';
const fieldFor = (kind) => kind === 'department' ? 'department' : 'jobTitle';
const approvalAliasKeys = ['APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_SUPERVISOR_ALIASES', 'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_MANAGER_ALIASES'];

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

async function impact({ kind, id, prismaClient = prisma } = {}) {
  const model = modelFor(prismaClient, kind);
  const row = await model.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'ไม่พบ Master ที่ต้องการตรวจสอบ', { code: 'PERSONNEL_MASTER_NOT_FOUND' });
  const field = fieldFor(kind);
  const employees = await prismaClient.employee.findMany({ where: { deletedAt: null }, select: { id: true, [field]: true } });
  const employeeReferences = employees.filter((employee) => normalizeName(employee[field]) === row.normalizedName).length;
  let approvalAuthorityReferences = 0;
  if (kind === 'position') {
    if (!prismaClient.systemSetting?.findMany) throw new HttpError(503, 'ไม่สามารถตรวจสอบ Approval Authority impact ได้', { code: 'PERSONNEL_MASTER_IMPACT_UNAVAILABLE' });
    const settings = await prismaClient.systemSetting.findMany({ where: { key: { in: approvalAliasKeys } }, select: { key: true, value: true } });
    if (settings.length !== approvalAliasKeys.length) throw new HttpError(503, 'ข้อมูล Approval Authority ไม่ครบ จึงไม่อนุญาตให้ปิด Position Master', { code: 'PERSONNEL_MASTER_IMPACT_UNAVAILABLE' });
    for (const setting of settings) {
      let aliases;
      try { aliases = JSON.parse(String(setting.value || '[]')); } catch { throw new HttpError(503, 'ข้อมูล Approval Authority ไม่ถูกต้อง จึงไม่อนุญาตให้ปิด Position Master', { code: 'PERSONNEL_MASTER_IMPACT_UNAVAILABLE' }); }
      if (!Array.isArray(aliases)) throw new HttpError(503, 'ข้อมูล Approval Authority ไม่ถูกต้อง จึงไม่อนุญาตให้ปิด Position Master', { code: 'PERSONNEL_MASTER_IMPACT_UNAVAILABLE' });
      approvalAuthorityReferences += aliases.filter((alias) => normalizeName(alias) === row.normalizedName).length;
    }
  }
  return {
    id: row.id, kind, name: row.name, isActive: row.isActive,
    employeeReferences, approvalAuthorityReferences,
    totalReferences: employeeReferences + approvalAuthorityReferences,
    groups: { employees: employeeReferences, approvalAuthority: approvalAuthorityReferences }
  };
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
    let impactSnapshot = null;
    const isDeactivation = before.isActive && data.isActive === false;
    if (isDeactivation) {
      impactSnapshot = await impact({ kind, id, prismaClient: tx });
      const reason = String(input.reason || '').trim();
      if (input.confirmImpact !== true || reason.length < 3 || reason.length > 1000) {
        throw new HttpError(409, 'ต้องตรวจสอบ Impact Preview ยืนยันผลกระทบ และระบุเหตุผลก่อนปิดใช้งาน Master', { code: 'PERSONNEL_MASTER_DEACTIVATION_CONFIRM_REQUIRED', impact: impactSnapshot });
      }
    }
    let row;
    try { row = await model.update({ where: { id }, data }); }
    catch (error) { if (error?.code === 'P2002') throw new HttpError(409, 'มี Master ชื่อนี้อยู่แล้ว', { code: 'PERSONNEL_MASTER_DUPLICATE' }); throw error; }
    await auditService.log({ actorUserId, action: 'UPDATE', entityType: entityFor(kind), entityId: row.id, metadata: { before: { name: before.name, isActive: before.isActive, sortOrder: before.sortOrder }, after: { name: row.name, isActive: row.isActive, sortOrder: row.sortOrder }, reason: isDeactivation ? String(input.reason).trim() : undefined, impact: impactSnapshot } }, tx);
    return row;
  });
}

module.exports = { normalizeName, list, assertActiveValue, impact, create, update };
