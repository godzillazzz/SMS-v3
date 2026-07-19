const prisma = require('../config/prisma');

// Central extension point: call after mutations without coupling routes to storage details.
const sensitiveKeys = new Set(['password', 'passwordHash', 'token', 'accessToken', 'secret']);
function safeMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKeys.has(key)));
}
async function log({ actorUserId, action, entityType, entityId, metadata }, client = prisma) {
  return client.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata: safeMetadata(metadata) } });
}

module.exports = { log, safeMetadata };
