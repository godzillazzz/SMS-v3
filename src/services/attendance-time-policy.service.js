'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { assignmentWindow } = require('./attendance-result.service');
const {
  ATTENDANCE_TIME_POLICY_VERSION,
  DEFAULT_ATTENDANCE_TIME_POLICY,
  normalizeAttendanceTimePolicy
} = require('./attendance-time-policy.contract');

const MAX_FUTURE_EFFECTIVE_DAYS = 365;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function scopeParts(assignment) {
  return {
    siteId: assignment?.attendanceSession?.expectedSiteId
      || assignment?.attendanceSession?.expectedSite?.id
      || assignment?.securitySiteId
      || assignment?.securitySite?.id
      || null,
    shiftTypeId: assignment?.shiftTypeId || assignment?.shiftType?.id || null
  };
}

function sourceFor(row) {
  if (!row) return { policyId: null, scopeType: 'COMPANY_DEFAULT', scopeId: null, effectiveFrom: null };
  return {
    policyId: row.id,
    scopeType: row.scopeType,
    scopeId: row.siteId || row.shiftTypeId || null,
    effectiveFrom: row.effectiveFrom
  };
}

function snapshotFor(resolved) {
  return {
    version: ATTENDANCE_TIME_POLICY_VERSION,
    ...resolved.source,
    values: { ...resolved.values }
  };
}

function valuesFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  try { return normalizeAttendanceTimePolicy(snapshot.values); } catch { return null; }
}

function validateAttendanceTime({ assignment, eventIntent, effectiveAt, policy }) {
  const at = effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt);
  if (Number.isNaN(at.getTime())) throw http(400, 'ATTENDANCE_EFFECTIVE_TIME_INVALID', 'Attendance effective time is invalid.');
  const values = normalizeAttendanceTimePolicy(policy || DEFAULT_ATTENDANCE_TIME_POLICY);
  const window = assignmentWindow(assignment);
  const intent = String(eventIntent || '').toUpperCase();

  if (intent === 'CHECK_IN') {
    if (values.earliestCheckInEnabled) {
      const earliest = window.startAt.getTime() - values.earliestCheckInMinutesBeforeStart * 60000;
      if (at.getTime() < earliest) throw http(409, 'ATTENDANCE_CHECK_IN_TOO_EARLY', 'Check-in is earlier than the configured attendance window.');
    }
    if (values.latestCheckInEnabled) {
      const latest = window.startAt.getTime() + values.latestCheckInMinutesAfterStart * 60000;
      if (at.getTime() > latest) throw http(409, 'ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED', 'Check-in is later than the configured attendance window.');
    }
  } else if (intent === 'CHECK_OUT') {
    if (values.earliestCheckOutEnabled) {
      const earliest = window.startAt.getTime() + values.earliestCheckOutMinutesAfterStart * 60000;
      if (at.getTime() < earliest) throw http(409, 'ATTENDANCE_CHECK_OUT_TOO_EARLY', 'Check-out is earlier than the configured attendance window.');
    }
    if (values.latestCheckOutEnabled) {
      const latest = window.endAt.getTime() + values.latestCheckOutMinutesAfterEnd * 60000;
      if (at.getTime() > latest) throw http(409, 'ATTENDANCE_CHECK_OUT_LATEST_WINDOW_EXCEEDED', 'Check-out is later than the configured attendance window.');
    }
  } else {
    throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
  }
  return { accepted: true, window, values };
}

function classifyAttendanceEventTime({ assignment, eventIntent, effectiveAt, policy }) {
  const values = normalizeAttendanceTimePolicy(policy || DEFAULT_ATTENDANCE_TIME_POLICY);
  const window = assignmentWindow(assignment);
  const at = effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt);
  if (Number.isNaN(at.getTime())) throw http(400, 'ATTENDANCE_EFFECTIVE_TIME_INVALID', 'Attendance effective time is invalid.');
  if (String(eventIntent).toUpperCase() === 'CHECK_IN') {
    const late = at.getTime() > window.startAt.getTime() + values.lateGraceMinutes * 60000;
    return { punctuality: late ? 'LATE' : 'ON_TIME', checkoutCondition: null,
      lateMinutes: Math.max(0, Math.ceil((at.getTime() - window.startAt.getTime()) / 60000)) };
  }
  const early = values.earlyLeaveEnabled
    && at.getTime() < window.endAt.getTime() - values.earlyCheckoutToleranceMinutes * 60000;
  return { punctuality: null, checkoutCondition: early ? 'EARLY_LEAVE' : 'NORMAL',
    earlyOutMinutes: Math.max(0, Math.ceil((window.endAt.getTime() - at.getTime()) / 60000)) };
}

function validateScopeInput(input = {}) {
  const scopeType = String(input.scopeType || '').trim().toUpperCase();
  if (!['COMPANY', 'SITE', 'SHIFT_TYPE'].includes(scopeType)) throw http(400, 'ATTENDANCE_TIME_POLICY_SCOPE_INVALID', 'Choose a company, Site, or Shift Type policy scope.');
  const siteId = input.siteId == null || input.siteId === '' ? null : String(input.siteId);
  const shiftTypeId = input.shiftTypeId == null || input.shiftTypeId === '' ? null : String(input.shiftTypeId);
  if ((scopeType === 'COMPANY' && (siteId || shiftTypeId))
    || (scopeType === 'SITE' && (!siteId || shiftTypeId))
    || (scopeType === 'SHIFT_TYPE' && (!shiftTypeId || siteId))) {
    throw http(400, 'ATTENDANCE_TIME_POLICY_SCOPE_INVALID', 'The selected policy scope does not match its Site or Shift Type.');
  }
  return { scopeType, siteId, shiftTypeId };
}

function scopeWhere(scope) {
  return { scopeType: scope.scopeType, siteId: scope.siteId, shiftTypeId: scope.shiftTypeId };
}

function scopeKey(scope) {
  return scope.scopeType === 'COMPANY' ? 'COMPANY'
    : `${scope.scopeType}:${scope.siteId || scope.shiftTypeId}`;
}

function policyResponse(row) {
  return {
    id: row.id,
    scopeType: row.scopeType,
    siteId: row.siteId || null,
    shiftTypeId: row.shiftTypeId || null,
    policy: normalizeAttendanceTimePolicy(row.policy),
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt
  };
}

function createAttendanceTimePolicyService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function latestForScope(scope, at, client = prisma) {
    return client.attendanceTimePolicy.findFirst({
      where: { ...scopeWhere(scope), effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async function resolveForAssignment({ assignment, at = clock() } = {}, client = prisma) {
    if (!assignment) throw http(400, 'ATTENDANCE_TIME_POLICY_ASSIGNMENT_REQUIRED', 'Shift Assignment is required to resolve an Attendance time policy.');
    const effectiveAt = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(effectiveAt.getTime())) throw http(400, 'ATTENDANCE_EFFECTIVE_TIME_INVALID', 'Attendance effective time is invalid.');
    if (!client?.attendanceTimePolicy?.findFirst) {
      return { values: { ...DEFAULT_ATTENDANCE_TIME_POLICY }, source: sourceFor(null), effectiveAt };
    }
    const { siteId, shiftTypeId } = scopeParts(assignment);
    const rows = await Promise.all([
      latestForScope({ scopeType: 'COMPANY', siteId: null, shiftTypeId: null }, effectiveAt, client),
      siteId ? latestForScope({ scopeType: 'SITE', siteId, shiftTypeId: null }, effectiveAt, client) : null,
      shiftTypeId ? latestForScope({ scopeType: 'SHIFT_TYPE', siteId: null, shiftTypeId }, effectiveAt, client) : null
    ]);
    const row = rows[2] || rows[1] || rows[0] || null;
    return {
      values: row ? normalizeAttendanceTimePolicy(row.policy) : { ...DEFAULT_ATTENDANCE_TIME_POLICY },
      source: sourceFor(row),
      effectiveAt
    };
  }

  async function hydrateEvents({ assignment, events = [] } = {}, client = prisma) {
    const result = [];
    for (const event of events) {
      if (event?.timePolicySnapshot) {
        result.push(event);
        continue;
      }
      const at = event?.effectiveEventAt || event?.receivedAt || clock();
      const resolved = await resolveForAssignment({ assignment, at }, client);
      result.push({ ...event, timePolicySnapshot: snapshotFor(resolved) });
    }
    return result;
  }

  async function hydrateAssignmentsEvents(entries = [], client = prisma) {
    const prepared = entries.map(({ assignment, events = [] }) => ({
      assignment,
      events: events.map((event) => {
        if (event?.timePolicySnapshot) return { event, effectiveAt: null };
        if (!assignment) throw http(400, 'ATTENDANCE_TIME_POLICY_ASSIGNMENT_REQUIRED', 'Shift Assignment is required to resolve an Attendance time policy.');
        const value = event?.effectiveEventAt || event?.receivedAt || clock();
        const effectiveAt = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(effectiveAt.getTime())) throw http(400, 'ATTENDANCE_EFFECTIVE_TIME_INVALID', 'Attendance effective time is invalid.');
        return { event, effectiveAt };
      })
    }));
    const pending = prepared.flatMap((entry) => entry.events
      .filter((row) => row.effectiveAt)
      .map((row) => ({ ...row, assignment: entry.assignment })));
    if (!pending.length) return prepared.map((entry) => entry.events.map((row) => row.event));
    if (!client?.attendanceTimePolicy?.findMany) {
      return Promise.all(prepared.map((entry) => hydrateEvents({ assignment: entry.assignment, events: entry.events.map((row) => row.event) }, client)));
    }

    const siteIds = [...new Set(pending.map((row) => scopeParts(row.assignment).siteId).filter(Boolean))];
    const shiftTypeIds = [...new Set(pending.map((row) => scopeParts(row.assignment).shiftTypeId).filter(Boolean))];
    const scopes = [{ scopeType: 'COMPANY', siteId: null, shiftTypeId: null }];
    if (siteIds.length) scopes.push({ scopeType: 'SITE', siteId: { in: siteIds }, shiftTypeId: null });
    if (shiftTypeIds.length) scopes.push({ scopeType: 'SHIFT_TYPE', siteId: null, shiftTypeId: { in: shiftTypeIds } });
    const latestAt = new Date(Math.max(...pending.map((row) => row.effectiveAt.getTime())));
    const policyRows = await client.attendanceTimePolicy.findMany({
      where: { effectiveFrom: { lte: latestAt }, OR: scopes },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }]
    });
    const byScope = new Map();
    for (const row of policyRows || []) {
      const key = row.scopeType === 'COMPANY' ? 'COMPANY' : `${row.scopeType}:${row.siteId || row.shiftTypeId}`;
      const rows = byScope.get(key) || [];
      rows.push(row);
      byScope.set(key, rows);
    }
    for (const rows of byScope.values()) {
      rows.sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime()
        || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }
    const latestAtScope = (scope, effectiveAt) => (byScope.get(scope) || []).find((row) => new Date(row.effectiveFrom).getTime() <= effectiveAt.getTime()) || null;

    return prepared.map((entry) => entry.events.map((item) => {
      if (!item.effectiveAt) return item.event;
      const { siteId, shiftTypeId } = scopeParts(entry.assignment);
      const row = (shiftTypeId && latestAtScope(`SHIFT_TYPE:${shiftTypeId}`, item.effectiveAt))
        || (siteId && latestAtScope(`SITE:${siteId}`, item.effectiveAt))
        || latestAtScope('COMPANY', item.effectiveAt);
      return { ...item.event, timePolicySnapshot: snapshotFor({
        values: row ? normalizeAttendanceTimePolicy(row.policy) : { ...DEFAULT_ATTENDANCE_TIME_POLICY },
        source: sourceFor(row),
        effectiveAt: item.effectiveAt
      }) };
    }));
  }

  async function list() {
    const now = clock();
    const [sites, shiftTypes, rows] = await Promise.all([
      prisma.securitySite.findMany({ where: { isActive: true }, orderBy: [{ code: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } }),
      prisma.shiftType.findMany({ where: { isActive: true }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, name: true, startTime: true, endTime: true } }),
      prisma.attendanceTimePolicy.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 500 })
    ]);
    return { now, defaultPolicy: { ...DEFAULT_ATTENDANCE_TIME_POLICY }, sites, shiftTypes, policies: rows.map(policyResponse) };
  }

  async function save({ actor, input } = {}) {
    if (actor?.role !== 'ADMIN') throw http(403, 'FORBIDDEN', 'Admin role is required to manage Attendance time policies.');
    const scope = validateScopeInput(input);
    let policy;
    try { policy = normalizeAttendanceTimePolicy(input.policy); }
    catch (error) { throw http(400, error?.code || 'ATTENDANCE_TIME_POLICY_INVALID', error?.message || 'Attendance time policy is invalid.'); }
    const now = clock();
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (Number.isNaN(effectiveFrom.getTime())) throw http(400, 'ATTENDANCE_TIME_POLICY_EFFECTIVE_TIME_INVALID', 'Effective time is invalid.');
    if (effectiveFrom.getTime() < now.getTime() - 1000) throw http(400, 'ATTENDANCE_TIME_POLICY_RETROACTIVE_DENIED', 'Attendance time policy cannot be made effective in the past.');
    if (effectiveFrom.getTime() > now.getTime() + MAX_FUTURE_EFFECTIVE_DAYS * 86400000) throw http(400, 'ATTENDANCE_TIME_POLICY_EFFECTIVE_TIME_TOO_FAR', 'Effective time cannot be more than one year in the future.');

    if (scope.scopeType === 'SITE') {
      const site = await prisma.securitySite.findUnique({ where: { id: scope.siteId }, select: { id: true, isActive: true } });
      if (!site?.isActive) throw http(404, 'ATTENDANCE_TIME_POLICY_SITE_NOT_FOUND', 'An active registered Site is required for a Site override.');
    }
    if (scope.scopeType === 'SHIFT_TYPE') {
      const shift = await prisma.shiftType.findUnique({ where: { id: scope.shiftTypeId }, select: { id: true, isActive: true } });
      if (!shift?.isActive) throw http(404, 'ATTENDANCE_TIME_POLICY_SHIFT_TYPE_NOT_FOUND', 'An active Shift Type is required for a Shift Type override.');
    }

    return prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1)) IS NOT NULL AS locked', `attendance-time-policy:${scopeKey(scope)}`);
      }
      const previous = await latestForScope(scope, new Date(effectiveFrom.getTime() - 1), tx);
      const duplicate = await tx.attendanceTimePolicy.findFirst({ where: { ...scopeWhere(scope), effectiveFrom } });
      if (duplicate) throw http(409, 'ATTENDANCE_TIME_POLICY_VERSION_EXISTS', 'A policy version already exists at that effective time.');
      const row = await tx.attendanceTimePolicy.create({
        data: { ...scope, policy, effectiveFrom, createdByUserId: actor.sub }
      });
      await audit.log({
        actorUserId: actor.sub,
        action: previous ? 'UPDATE' : 'CREATE',
        entityType: 'AttendanceTimePolicy',
        entityId: scopeKey(scope),
        metadata: {
          event: 'ATTENDANCE_TIME_POLICY_VERSION_CREATED',
          scopeType: scope.scopeType,
          scopeId: scope.siteId || scope.shiftTypeId || null,
          oldValues: previous ? normalizeAttendanceTimePolicy(previous.policy) : null,
          newValues: policy,
          policyVersionId: row.id,
          effectiveAt: effectiveFrom.toISOString(),
          changedAt: now.toISOString()
        }
      }, tx);
      return policyResponse(row);
    });
  }

  return { list, save, resolveForAssignment, hydrateEvents, hydrateAssignmentsEvents };
}

module.exports = {
  MAX_FUTURE_EFFECTIVE_DAYS,
  snapshotFor,
  valuesFromSnapshot,
  validateAttendanceTime,
  classifyAttendanceEventTime,
  validateScopeInput,
  createAttendanceTimePolicyService
};
