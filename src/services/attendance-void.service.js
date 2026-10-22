'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

function http(status, code, message) { return new HttpError(status, message, { code }); }
function reason(value) {
  const text = String(value || '').trim();
  if (text.length < 5 || text.length > 1000) throw http(400, 'ATTENDANCE_VOID_REASON_INVALID', 'A void reason between 5 and 1000 characters is required.');
  return text;
}
function safe(row) {
  return { id: row.id, state: row.state, voidedAt: row.voidedAt, voidedByUserId: row.voidedByUserId, voidReason: row.voidReason };
}
function fixtureIds(environment) {
  return new Set(String(environment.ATTENDANCE_UAT_FIXTURE_SESSION_IDS || '').split(',').map((v) => v.trim()).filter(Boolean));
}

function createAttendanceVoidService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date(), environment = process.env } = {}) {
  function assertAdmin(actor) {
    if (actor?.role !== 'ADMIN') throw http(403, 'ATTENDANCE_VOID_ADMIN_REQUIRED', 'Only an ADMIN may void Attendance.');
    if (!actor?.sub) throw http(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }
  async function voidSession({ actor, sessionId, reason: inputReason }) {
    assertAdmin(actor);
    const voidReason = reason(inputReason);
    return prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findUnique({ where: { id: sessionId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
      if (!session) throw http(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session was not found.');
      if (session.state === 'VOIDED') return { idempotent: true, session: safe(session), events: session.events.map(safe) };
      const now = clock();
      const beforeSession = safe(session);
      const beforeEvents = session.events.map(safe);
      const updatedSession = await tx.attendanceSession.update({ where: { id: session.id }, data: { state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason } });
      if (session.events.length) await tx.attendanceEvent.updateMany({ where: { id: { in: session.events.map((event) => event.id) }, state: 'ACTIVE' }, data: { state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason } });
      const afterEvents = session.events.map((event) => ({ ...safe(event), state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason }));
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceSession', entityId: session.id, metadata: { event: 'ATTENDANCE_SESSION_VOIDED', sessionId: session.id, eventIds: session.events.map((event) => event.id), reason: voidReason, before: { session: beforeSession, events: beforeEvents }, after: { session: safe(updatedSession), events: afterEvents } } }, tx);
      return { idempotent: false, session: safe(updatedSession), events: afterEvents, previouslyLoadedEventCount: session.events.length };
    });
  }
  function assertUatRuntime() {
    const explicitlyUat = environment.ATTENDANCE_RUNTIME_CLASSIFICATION === 'UAT' && environment.ATTENDANCE_UAT_RESET_ENABLED === 'true';
    const production = environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production';
    if (!explicitlyUat || production) throw http(404, 'ATTENDANCE_UAT_RESET_UNAVAILABLE', 'Attendance UAT reset is unavailable outside an explicitly marked safe UAT runtime.');
  }
  async function resetApprovedUatFixture({ actor, sessionId, reason: inputReason }) {
    assertAdmin(actor); assertUatRuntime();
    const voidReason = reason(inputReason || 'Approved UAT fixture reset');
    const ids = fixtureIds(environment);
    if (!sessionId || !ids.has(sessionId)) throw http(403, 'ATTENDANCE_UAT_FIXTURE_REQUIRED', 'Only an approved UAT fixture may be reset.');
    const result = await voidSession({ actor, sessionId, reason: voidReason });
    await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceSession', entityId: sessionId, metadata: { event: 'ATTENDANCE_UAT_FIXTURE_RESET', sessionId, reason: voidReason, hardDelete: false } });
    return { ...result, uatReset: true };
  }
  return { voidSession, resetApprovedUatFixture, assertUatRuntime };
}

module.exports = { createAttendanceVoidService, reason, fixtureIds };
