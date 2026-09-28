'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function approvalActor(user) {
  return user ? { id: user.id, displayName: user.displayName, role: user.role || null } : null;
}

function legacyApprovalFallback(ref) {
  const value = typeof ref === 'string' ? ref.trim() : '';
  if (!value || UUID_RE.test(value)) return null;
  return { id: null, displayName: value, role: null, legacyRef: value };
}

async function resolveApprovalActors(prismaClient, refs) {
  const values = [...new Set((refs || []).filter((value) => typeof value === 'string' && UUID_RE.test(value)))];
  if (!values.length) return new Map();
  const users = await prismaClient.user.findMany({ where: { id: { in: values } }, select: { id: true, displayName: true, role: true } });
  return new Map(users.map((user) => [user.id, approvalActor(user)]));
}

function approvalIdentity(ref, actorMap) {
  if (!ref) return null;
  return actorMap?.get(ref) || legacyApprovalFallback(ref);
}

function withApprovalIdentity(row, refField, actorMap, prefix = 'approvedBy') {
  const identity = approvalIdentity(row?.[refField], actorMap);
  return {
    ...row,
    [`${prefix}DisplayName`]: identity?.displayName || null,
    [`${prefix}Role`]: identity?.role || null
  };
}

module.exports = {
  UUID_RE,
  approvalActor,
  legacyApprovalFallback,
  resolveApprovalActors,
  approvalIdentity,
  withApprovalIdentity
};