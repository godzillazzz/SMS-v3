const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');

const safeDuty = (duty) => ({ code: duty.code, name: duty.name, isActive: duty.isActive });

function createDutyService({ prismaClient = prisma, auditService = audit } = {}) {
  async function list({ includeInactive = false } = {}) {
    return prismaClient.duty.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { code: 'asc' } });
  }

  async function create(data, actorUserId) {
    return prismaClient.$transaction(async (tx) => {
      const existing = await tx.duty.findUnique({ where: { code: data.code } });
      if (existing) throw new HttpError(409, 'Duty code already exists.', { code: 'DUTY_CODE_CONFLICT' });
      const duty = await tx.duty.create({ data });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'Duty', entityId: duty.id, metadata: { after: safeDuty(duty) } }, tx);
      return duty;
    });
  }

  async function update(id, data, actorUserId) {
    return prismaClient.$transaction(async (tx) => {
      const before = await tx.duty.findUnique({ where: { id } });
      if (!before) throw new HttpError(404, 'Duty not found.');
      const duty = await tx.duty.update({ where: { id }, data });
      await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'Duty', entityId: id, metadata: { before: safeDuty(before), after: safeDuty(duty) } }, tx);
      return duty;
    });
  }

  return { create, list, update };
}

module.exports = { createDutyService };
