const prisma = require('../config/prisma');

// Central extension point: call after mutations without coupling routes to storage details.
const sensitiveFragments = ['password', 'token', 'secret', 'cookie', 'authorization', 'databaseurl', 'connectionstring'];
const isSensitiveKey = (key) => sensitiveFragments.some((fragment) => key.toLowerCase().replace(/[_-]/g, '').includes(fragment));
function safeMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal values are class instances whose generated constructor
  // name may vary by runtime. Their JSON representation is the safe scalar
  // form for a JSON column; otherwise Prisma receives internal Decimal
  // fields (including a function) and rejects the mutation.
  if (typeof value.toJSON === 'function') return safeMetadata(value.toJSON());
  if (Array.isArray(value)) return value.map(safeMetadata);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isSensitiveKey(key)).map(([key, nested]) => [key, safeMetadata(nested)]));
}
async function log({ actorUserId, action, entityType, entityId, metadata }, client = prisma) {
  return client.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata: safeMetadata(metadata) } });
}

module.exports = { log, safeMetadata };
