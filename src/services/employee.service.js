const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');

function publicEmployee(employee) {
  const { email, phone, hiredAt, ...basic } = employee;
  return basic;
}
// MANAGER global scope: safe projection — operational fields only, no PII beyond what is required
function managerSafeEmployee(employee) {
  const { id, employeeCode, firstName, lastName, displayName, department, jobTitle, isActive } = employee;
  return { id, employeeCode, firstName, lastName, displayName, department, jobTitle, isActive };
}
const requiresBasicView = (role) => role === 'VIEWER';
const requiresManagerView = (role) => role === 'MANAGER';
function auditSnapshot(employee) {
  const { id, employeeCode, firstName, lastName, department, jobTitle, isActive, deletedAt, deletedByUserId } = employee;
  return { id, employeeCode, firstName, lastName, department, jobTitle, isActive, deletedAt, deletedByUserId };
}
async function list(query, role) {
  const { page, pageSize, search, isActive, department } = query;
  const where = { deletedAt: null, ...(typeof isActive === 'boolean' && { isActive }), ...(department && { department }), ...(search && { OR: [{ employeeCode: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] }) };
  const [total, employees] = await prisma.$transaction([prisma.employee.count({ where }), prisma.employee.findMany({ where, orderBy: [{ employeeCode: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })]);
  return { data: requiresBasicView(role) ? employees.map(publicEmployee) : requiresManagerView(role) ? employees.map(managerSafeEmployee) : employees, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}
async function getById(id, role) { const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } }); if (!employee) throw new HttpError(404, 'Employee not found.'); return requiresBasicView(role) ? publicEmployee(employee) : requiresManagerView(role) ? managerSafeEmployee(employee) : employee; }
async function create(data, actorUserId) {
  return prisma.$transaction(async (tx) => { const employee = await tx.employee.create({ data }); await audit.log({ actorUserId, action: 'CREATE', entityType: 'Employee', entityId: employee.id, metadata: { after: auditSnapshot(employee) } }, tx); return employee; });
}
async function update(id, data, actorUserId) {
  const existing = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Employee not found.');
  return prisma.$transaction(async (tx) => { const employee = await tx.employee.update({ where: { id }, data }); await audit.log({ actorUserId, action: 'UPDATE', entityType: 'Employee', entityId: id, metadata: { before: auditSnapshot(existing), after: auditSnapshot(employee) } }, tx); return employee; });
}
async function remove(id, actorUserId) {
  const existing = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Employee not found.');
  await prisma.$transaction(async (tx) => { const deletedAt = new Date(); await tx.employee.update({ where: { id }, data: { deletedAt, deletedByUserId: actorUserId, isActive: false } }); await audit.log({ actorUserId, action: 'DELETE', entityType: 'Employee', entityId: id, metadata: { before: auditSnapshot(existing), after: { deletedAt, deletedByUserId: actorUserId, isActive: false } } }, tx); });
}
module.exports = { list, getById, create, update, remove };
