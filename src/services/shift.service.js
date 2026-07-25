const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');

async function list() {
  return prisma.shiftType.findMany({
    orderBy: { code: 'asc' }
  });
}

async function getById(id) {
  const shift = await prisma.shiftType.findUnique({ where: { id } });
  if (!shift) throw new HttpError(404, 'Shift type not found.');
  return shift;
}

async function create(data) {
  const existing = await prisma.shiftType.findUnique({ where: { code: data.code } });
  if (existing) throw new HttpError(400, 'Shift code already exists.');
  return prisma.shiftType.create({ data });
}

async function update(id, data) {
  const existing = await prisma.shiftType.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Shift type not found.');
  return prisma.shiftType.update({ where: { id }, data });
}

async function remove(id) {
  const existing = await prisma.shiftType.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Shift type not found.');
  return prisma.shiftType.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
