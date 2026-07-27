const prisma = require('../config/prisma');

// Central extension point: call after mutations without coupling routes to storage details.
const sensitiveFragments = ['password', 'token', 'secret', 'cookie', 'authorization', 'databaseurl', 'connectionstring'];
const isSensitiveKey = (key) => sensitiveFragments.some((fragment) => key.toLowerCase().replace(/[_-]/g, '').includes(fragment));
function safeMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal values are class instances. Convert them before placing
  // metadata into a JSON column; serializing their internal fields produces
  // a Prisma validation error at mutation time.
  if (value.constructor?.name === 'Decimal' && typeof value.toString === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(safeMetadata);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isSensitiveKey(key)).map(([key, nested]) => [key, safeMetadata(nested)]));
}
async function log({ actorUserId, action, entityType, entityId, metadata }, client = prisma) {
  return client.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata: safeMetadata(metadata) } });
}

module.exports = { log, safeMetadata };
