'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
const ACTIONS = Object.freeze(['CHECK_IN', 'CHECK_OUT']);
const OFF = Object.freeze({ clockInRequired: false, clockOutRequired: false });

function http(status, code, message) { return new HttpError(status, message, { code }); }
function validateRole(role) {
  const value = String(role || '').trim().toUpperCase();
  if (!ROLES.includes(value)) throw http(400, 'ATTENDANCE_SELFIE_ROLE_INVALID', 'Attendance selfie policy role is invalid.');
  return value;
}
function validateAction(action) {
  const value = String(action || '').trim().toUpperCase();
  if (!ACTIONS.includes(value)) throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
  return value;
}
function values(row) {
  return { role: row.role, clockInRequired: Boolean(row.clockInRequired), clockOutRequired: Boolean(row.clockOutRequired), updatedAt: row.updatedAt || null };
}
function requiredFor(row, action) {
  const normalized = validateAction(action);
  return normalized === 'CHECK_IN' ? Boolean(row?.clockInRequired) : Boolean(row?.clockOutRequired);
}
function createAttendanceSelfiePolicyService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function list(client = prisma) {
    const rows = await client.attendanceSelfiePolicy.findMany({ orderBy: { role: 'asc' } });
    const byRole = new Map(rows.map((row) => [row.role, values(row)]));
    return ROLES.map((role) => byRole.get(role) || { role, ...OFF, updatedAt: null });
  }
  async function resolve({ role, action }, client = prisma) {
    const normalizedRole = validateRole(role);
    const normalizedAction = validateAction(action);
    if (!client?.attendanceSelfiePolicy?.findUnique) return { sourceRole: normalizedRole, action: normalizedAction, required: false, policy: { role: normalizedRole, ...OFF, updatedAt: null } };
    const row = await client.attendanceSelfiePolicy.findUnique({ where: { role: normalizedRole } });
    const policy = row ? values(row) : { role: normalizedRole, ...OFF, updatedAt: null };
    return { sourceRole: normalizedRole, action: normalizedAction, required: requiredFor(policy, normalizedAction), policy };
  }
  async function update({ actor, role, clockInRequired, clockOutRequired }, client = prisma) {
    if (actor?.role !== 'ADMIN') throw http(403, 'FORBIDDEN', 'Admin role is required to manage Attendance selfie policies.');
    const normalizedRole = validateRole(role);
    if (typeof clockInRequired !== 'boolean' || typeof clockOutRequired !== 'boolean') throw http(400, 'ATTENDANCE_SELFIE_POLICY_INVALID', 'Selfie requirements must be boolean values.');
    return client.$transaction(async (tx) => {
      const before = await tx.attendanceSelfiePolicy.findUnique({ where: { role: normalizedRole } });
      const after = await tx.attendanceSelfiePolicy.upsert({
        where: { role: normalizedRole },
        update: { clockInRequired, clockOutRequired, updatedByUserId: actor.sub },
        create: { role: normalizedRole, clockInRequired, clockOutRequired, updatedByUserId: actor.sub }
      });
      await audit.log({ actorUserId: actor.sub, action: before ? 'UPDATE' : 'CREATE', entityType: 'AttendanceSelfiePolicy', entityId: normalizedRole, metadata: {
        event: 'ATTENDANCE_SELFIE_POLICY_UPDATED', role: normalizedRole,
        before: before ? { clockInRequired: before.clockInRequired, clockOutRequired: before.clockOutRequired } : null,
        after: { clockInRequired: after.clockInRequired, clockOutRequired: after.clockOutRequired }, changedAt: clock().toISOString()
      } }, tx);
      return values(after);
    });
  }
  return { list, resolve, update };
}
module.exports = { ROLES, ACTIONS, createAttendanceSelfiePolicyService, validateRole, validateAction, requiredFor };
