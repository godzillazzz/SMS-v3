'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

function monthStart(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

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
  async function voidInTransaction(tx, { actor, sessionId, voidReason }) {
    // Serialize Void with certification using the same month-scoped advisory lock.
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM attendance_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    }
    const session = await tx.attendanceSession.findUnique({ where: { id: sessionId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!session) throw http(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session was not found.');
    if (typeof tx.$queryRaw === 'function') {
      const certificationMonth = monthStart(session.workDate);
      await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtext(${`attendance-cert:${certificationMonth.toISOString().slice(0, 7)}`}))`;
      const certified = await tx.$queryRaw`SELECT id FROM attendance_month_certifications WHERE month = ${certificationMonth}::date AND status = 'CERTIFIED' LIMIT 1`;
      if (certified.length) throw http(409, 'ATTENDANCE_MONTH_CERTIFIED', 'Attendance month is certified and cannot be voided.');
    }
    if (session.state === 'VOIDED') return { idempotent: true, session: safe(session), events: session.events.map(safe) };
    const now = clock();
    const beforeSession = safe(session);
    const beforeEvents = session.events.map(safe);
    const updatedSession = await tx.attendanceSession.update({ where: { id: session.id }, data: { state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason } });
    await tx.attendanceEvent.updateMany({ where: { sessionId: session.id, state: 'ACTIVE' }, data: { state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason } });
    const afterEvents = session.events.map((event) => ({ ...safe(event), state: 'VOIDED', voidedAt: now, voidedByUserId: actor.sub, voidReason }));
    await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceSession', entityId: session.id, metadata: { event: 'ATTENDANCE_SESSION_VOIDED', sessionId: session.id, eventIds: session.events.map((event) => event.id), reason: voidReason, before: { session: beforeSession, events: beforeEvents }, after: { session: safe(updatedSession), events: afterEvents } } }, tx);
    return { idempotent: false, session: safe(updatedSession), events: afterEvents, previouslyLoadedEventCount: session.events.length };
  }
  async function voidSession({ actor, sessionId, reason: inputReason }) {
    assertAdmin(actor);
    const voidReason = reason(inputReason);
    return prisma.$transaction((tx) => voidInTransaction(tx, { actor, sessionId, voidReason }));
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
    const result = await prisma.$transaction(async (tx) => {
      const voided = await voidInTransaction(tx, { actor, sessionId, voidReason });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceSession', entityId: sessionId, metadata: { event: 'ATTENDANCE_UAT_FIXTURE_RESET', sessionId, reason: voidReason, hardDelete: false } }, tx);
      return voided;
    });
    return { ...result, uatReset: true };
  }
  return { voidSession, resetApprovedUatFixture, assertUatRuntime };
}

module.exports = { createAttendanceVoidService, reason, fixtureIds };
