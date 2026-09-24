const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const personnelMaster = require('./personnel-master.service');
const lifecycleControlledFields = ['firstName', 'lastName', 'department', 'jobTitle', 'isActive'];

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
const requiresManagerView = (role) => ['MANAGER', 'SUPERVISOR'].includes(role);
function auditSnapshot(employee) {
  const { id, employeeCode, firstName, lastName, department, jobTitle, isActive, deletedAt, deletedByUserId } = employee;
  return { id, employeeCode, firstName, lastName, department, jobTitle, isActive, deletedAt, deletedByUserId };
}
async function list(query, role) {
  const { page, pageSize, search, isActive, department, directoryMeta = false } = query;
  const baseWhere = { deletedAt: null };
  const where = { ...baseWhere, ...(typeof isActive === 'boolean' && { isActive }), ...(department && { department }), ...(search && { OR: [{ employeeCode: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { displayName: { contains: search, mode: 'insensitive' } }, { department: { contains: search, mode: 'insensitive' } }, { jobTitle: { contains: search, mode: 'insensitive' } }] }) };
  const baseQueries = [
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, orderBy: [{ employeeCode: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })
  ];
  const directoryQueries = directoryMeta ? [
    prisma.employee.count({ where: baseWhere }),
    prisma.employee.count({ where: { ...baseWhere, isActive: true } }),
    prisma.employee.count({ where: { ...baseWhere, OR: [{ department: null }, { department: '' }, { jobTitle: null }, { jobTitle: '' }] } }),
    prisma.employee.findMany({ where: { ...baseWhere, department: { not: null } }, select: { department: true }, distinct: ['department'], orderBy: [{ department: 'asc' }] })
  ] : [];
  const [total, employees, overallTotal, activeTotal, incompleteTotal, departmentRows] = await prisma.$transaction([...baseQueries, ...directoryQueries]);
  const meta = { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  if (directoryMeta) {
    meta.summary = { total: overallTotal, active: activeTotal, incomplete: incompleteTotal };
    meta.departments = (departmentRows || []).map((row) => row.department).filter(Boolean);
  }
  return { data: requiresBasicView(role) ? employees.map(publicEmployee) : requiresManagerView(role) ? employees.map(managerSafeEmployee) : employees, meta };
}
async function getById(id, role) { const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } }); if (!employee) throw new HttpError(404, 'Employee not found.'); return requiresBasicView(role) ? publicEmployee(employee) : requiresManagerView(role) ? managerSafeEmployee(employee) : employee; }
async function create(data, actorUserId) {
  const displayName = `${data.firstName} ${data.lastName}`.trim();
  return prisma.$transaction(async (tx) => {
    const department = Object.prototype.hasOwnProperty.call(data, 'department') ? await personnelMaster.assertActiveValue(tx, 'department', data.department) : undefined;
    const jobTitle = Object.prototype.hasOwnProperty.call(data, 'jobTitle') ? await personnelMaster.assertActiveValue(tx, 'position', data.jobTitle) : undefined;
    const employee = await tx.employee.create({ data: { ...data, ...(department !== undefined ? { department } : {}), ...(jobTitle !== undefined ? { jobTitle } : {}), displayName } });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'Employee', entityId: employee.id, metadata: { after: auditSnapshot(employee) } }, tx);
    return employee;
  });
}
async function update(id, data, actorUserId) {
  const controlled = lifecycleControlledFields.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  if (controlled.length) throw new HttpError(409, 'Lifecycle action required.', { code: 'LIFECYCLE_ACTION_REQUIRED', fields: controlled });
  const existing = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new HttpError(404, 'Employee not found.');
  return prisma.$transaction(async (tx) => { const employee = await tx.employee.update({ where: { id }, data }); await audit.log({ actorUserId, action: 'UPDATE', entityType: 'Employee', entityId: id, metadata: { before: auditSnapshot(existing), after: auditSnapshot(employee) } }, tx); return employee; });
}
async function remove(id, actorUserId) {
  void id;
  void actorUserId;
  throw new HttpError(409, 'Lifecycle termination required.', { code: 'LIFECYCLE_TERMINATION_REQUIRED' });
}
module.exports = { list, getById, create, update, remove };
