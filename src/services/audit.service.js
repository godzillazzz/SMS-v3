const prisma = require('../config/prisma');

// Central extension point: call after mutations without coupling routes to storage details.
const sensitiveFragments = ['password', 'token', 'secret', 'cookie', 'authorization', 'databaseurl', 'connectionstring'];
const privateContactKeys = new Set(['address', 'emergencycontact', 'emergencyphone']);
const isSensitiveKey = (key, employeeContacts) => {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return (employeeContacts && privateContactKeys.has(normalized)) || sensitiveFragments.some((fragment) => normalized.includes(fragment));
};
function safeMetadata(value, employeeContacts = false) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal values are class instances whose generated constructor
  // name may vary by runtime. Their JSON representation is the safe scalar
  // form for a JSON column; otherwise Prisma receives internal Decimal
  // fields (including a function) and rejects the mutation.
  if (typeof value.toJSON === 'function') return safeMetadata(value.toJSON(), employeeContacts);
  if (Array.isArray(value)) return value.map((item) => safeMetadata(item, employeeContacts));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isSensitiveKey(key, employeeContacts)).map(([key, nested]) => [key, safeMetadata(nested, employeeContacts)]));
}
async function log({ actorUserId, action, entityType, entityId, metadata }, client = prisma) {
  return client.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata: safeMetadata(metadata, entityType === 'Employee' || entityType === 'EmployeeLifecycleEvent') } });
}

module.exports = { log, safeMetadata };
