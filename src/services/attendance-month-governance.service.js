'use strict';

const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { classifyAttendanceDay } = require('./attendance-result.service');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');
const { currentCorrectionsForAssignments, applyCurrentCorrections } = require('./attendance-correction.service');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function parseMonth(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) throw http(400, 'ATTENDANCE_MONTH_INVALID', 'Attendance month must use YYYY-MM.');
  const start = new Date(`${text}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== text) throw http(400, 'ATTENDANCE_MONTH_INVALID', 'Attendance month is invalid.');
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { text, start, next };
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]).filter(([, nested]) => nested !== undefined));
  return null;
}

function snapshotDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function eventByType(events, type) {
  return (events || []).find((row) => String(row?.eventType || '').toUpperCase() === type) || null;
}

function actualSiteId(events) {
  for (const event of events || []) {
    const evidence = event?.locationEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const id = evidence.actualSiteId || evidence.siteId || null;
    if (id) return String(id);
  }
  return null;
}

function evidenceFlags(events) {
  const flags = new Set();
  for (const event of events || []) {
    const evidence = event?.locationEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const riskFlags = Array.isArray(evidence.riskFlags) ? evidence.riskFlags : [];
    riskFlags.forEach((flag) => { if (typeof flag === 'string' && flag) flags.add(flag); });
  }
  return [...flags];
}

function certificationBlockers(rows) {
  const blockers = [];
  for (const row of rows || []) {
    const flags = new Set(row.flags || []);
    const nonFinal = ['SCHEDULED', 'AWAITING_CHECK_IN', 'IN_PROGRESS'].includes(row.status);
    const missingCheckInWithoutAbsence = flags.has('MISSING_CHECK_IN') && !flags.has('ABSENT');
    if (nonFinal || missingCheckInWithoutAbsence || flags.has('MISSING_CHECK_OUT') || flags.has('TIME_ABNORMAL') || flags.has('OUTSIDE_ALL_SITES') || flags.has('WRONG_SHIFT')) {
      blockers.push({ assignmentId: row.assignmentId, employeeId: row.employeeId, workDate: row.workDate, status: row.status, flags: row.flags });
    }
  }
  return blockers;
}

function monthSummary(rows) {
  const countFlag = (flag) => rows.reduce((sum, row) => sum + (row.flags.includes(flag) ? 1 : 0), 0);
  const timeAbnormal = rows.reduce((sum, row) => sum + (row.flags.includes('TIME_ABNORMAL') || row.flags.includes('MISSING_CHECK_OUT') || row.flags.includes('MISSING_CHECK_IN') ? 1 : 0), 0);
  return {
    assignments: rows.length,
    complete: rows.filter((row) => row.status === 'COMPLETE').length,
    absent: countFlag('ABSENT'),
    leave: countFlag('LEAVE'),
    late: countFlag('LATE'),
    earlyOut: countFlag('EARLY_OUT'),
    assistOtherSite: countFlag('ASSIST_OTHER_SITE'),
    corrected: countFlag('CORRECTED'),
    timeAbnormal
  };
}

function assertAdmin(actor) {
  if (String(actor?.role || '').toUpperCase() !== 'ADMIN') throw http(403, 'ATTENDANCE_CERTIFICATION_ADMIN_REQUIRED', 'Attendance month certification requires Admin authority.');
}

async function requireApprovedSchedule(client, period) {
  const approval = await client.scheduleApproval.findFirst({ where: { month: period.start }, orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }] });
  if (!approval || approval.status !== 'APPROVED') throw http(409, 'ATTENDANCE_SCHEDULE_NOT_APPROVED', 'Monthly Schedule must be approved before Attendance certification.');
  return approval;
}

function createAttendanceMonthGovernanceService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date(), siteAuthorityService = null } = {}) {
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function certificationHistory(month, client = prisma) {
    const period = parseMonth(month);
    return client.$queryRaw(Prisma.sql`
      SELECT
        id, month, revision, status::text AS status,
        summary_snapshot AS "summarySnapshot",
        summary_digest AS "summaryDigest",
        certified_by_user_id AS "certifiedByUserId",
        certified_at AS "certifiedAt",
        unlocked_by_user_id AS "unlockedByUserId",
        unlocked_at AS "unlockedAt",
        unlock_reason AS "unlockReason",
        created_at AS "createdAt"
      FROM attendance_month_certifications
      WHERE month = ${period.start}::date
      ORDER BY revision DESC
    `);
  }

  async function officialRows(month, client = prisma) {
    const period = parseMonth(month);
    const now = clock();
    const assignments = await client.shiftAssignment.findMany({
      where: { workDate: { gte: period.start, lt: period.next } },
      include: {
        employee: { select: { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true } },
        shiftType: true,
        securitySite: true,
        attendanceSession: { include: { expectedSite: { select: { id: true, code: true, name: true } }, events: { orderBy: { effectiveEventAt: 'asc' } } } }
      },
      orderBy: [{ workDate: 'asc' }, { departmentSnapshot: 'asc' }, { employeeNameSnapshot: 'asc' }]
    });
    const assignmentIds = assignments.map((row) => row.id);
    const employeeIds = [...new Set(assignments.map((row) => row.employeeId))];
    const [corrections, leaves] = await Promise.all([
      currentCorrectionsForAssignments(client, assignmentIds),
      employeeIds.length ? client.leaveRequest.findMany({
        where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lt: period.next }, endDate: { gte: period.start } },
        select: { employeeId: true, startDate: true, endDate: true }
      }) : []
    ]);
    const correctionsByAssignment = new Map();
    for (const correction of corrections) {
      const list = correctionsByAssignment.get(correction.shiftAssignmentId) || [];
      list.push(correction);
      correctionsByAssignment.set(correction.shiftAssignmentId, list);
    }
    const rows = [];
    for (const assignment of assignments) {
      const session = assignment.attendanceSession || null;
      const rawEvents = session?.events || [];
      const assignmentCorrections = correctionsByAssignment.get(assignment.id) || [];
      const events = applyCurrentCorrections(rawEvents, assignmentCorrections);
      const leave = leaves.some((row) => row.employeeId === assignment.employeeId && row.startDate <= assignment.workDate && row.endDate >= assignment.workDate);
      const result = classifyAttendanceDay({ assignment, events, approvedLeave: leave, asOf: now });
      let expectedSite = session?.expectedSite || assignment.securitySite || null;
      if (!expectedSite) {
        try { expectedSite = (await siteAuthority.resolve({ assignment, existingSession: session }, client)).site; }
        catch { expectedSite = null; }
      }
      const rawCheckIn = eventByType(rawEvents, 'CHECK_IN');
      const rawCheckOut = eventByType(rawEvents, 'CHECK_OUT');
      const flags = [...new Set([...result.flags, ...evidenceFlags(rawEvents), ...(assignmentCorrections.length ? ['CORRECTED'] : [])])];
      rows.push({
        assignmentId: assignment.id,
        sessionId: session?.id || null,
        employeeId: assignment.employeeId,
        employeeCode: assignment.employee?.employeeCode || null,
        employeeName: assignment.employeeNameSnapshot || assignment.employee?.displayName || `${assignment.employee?.firstName || ''} ${assignment.employee?.lastName || ''}`.trim(),
        department: assignment.departmentSnapshot || assignment.employee?.department || null,
        workDate: assignment.workDate.toISOString().slice(0, 10),
        shift: { id: assignment.shiftTypeId, code: assignment.shiftType?.code || null, name: assignment.shiftType?.name || null },
        expectedSite: expectedSite ? { id: expectedSite.id, code: expectedSite.code, name: expectedSite.name } : null,
        actualSiteId: actualSiteId(rawEvents),
        expectedStartAt: result.expectedStartAt,
        expectedEndAt: result.expectedEndAt,
        originalCheckInAt: rawCheckIn?.effectiveEventAt || null,
        originalCheckOutAt: rawCheckOut?.effectiveEventAt || null,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        workedMinutes: result.workedMinutes,
        status: result.status,
        flags,
        corrections: assignmentCorrections.map((row) => ({ id: row.id, eventType: row.eventType, reason: row.reason, actorUserId: row.actorUserId, createdAt: row.createdAt }))
      });
    }
    return rows;
  }

  async function preview(month, client = prisma) {
    const period = parseMonth(month);
    const approval = await client.scheduleApproval.findFirst({ where: { month: period.start }, orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }] });
    const rows = await officialRows(period.text, client);
    const blockers = certificationBlockers(rows);
    return { month: period.text, scheduleApproval: approval ? { status: approval.status, revision: approval.revision, approvedAt: approval.approvedAt } : null, summary: monthSummary(rows), blockerCount: blockers.length, blockers, rows };
  }

  async function certify({ actor, month } = {}) {
    assertAdmin(actor);
    const period = parseMonth(month);
    const now = clock();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext(${`attendance-cert:${period.text}`}))`);
      await requireApprovedSchedule(tx, period);
      const current = await tx.$queryRaw(Prisma.sql`
        SELECT id FROM attendance_month_certifications
        WHERE month = ${period.start}::date AND status = 'CERTIFIED' LIMIT 1
      `);
      if (current.length) throw http(409, 'ATTENDANCE_MONTH_ALREADY_CERTIFIED', 'Attendance month is already certified.');
      const rows = await officialRows(period.text, tx);
      const blockers = certificationBlockers(rows);
      if (blockers.length) throw new HttpError(409, 'Attendance month contains unresolved records.', { code: 'ATTENDANCE_MONTH_HAS_BLOCKERS', blockers: blockers.slice(0, 100), blockerCount: blockers.length });
      const summary = monthSummary(rows);
      const snapshot = { version: 'ATTENDANCE_MONTH_OFFICIAL_V1', month: period.text, generatedAt: now.toISOString(), summary, rows };
      const digest = snapshotDigest(snapshot);
      const revisionRows = await tx.$queryRaw(Prisma.sql`SELECT COALESCE(MAX(revision), 0)::integer AS revision FROM attendance_month_certifications WHERE month = ${period.start}::date`);
      const revision = Number(revisionRows[0]?.revision || 0) + 1;
      const inserted = await tx.$queryRaw(Prisma.sql`
        INSERT INTO attendance_month_certifications (month, revision, status, summary_snapshot, summary_digest, certified_by_user_id, certified_at)
        VALUES (${period.start}::date, ${revision}, 'CERTIFIED', ${JSON.stringify(snapshot)}::jsonb, ${digest}, ${actor.sub}::uuid, ${now})
        RETURNING id, month, revision, status::text AS status, summary_digest AS "summaryDigest", certified_at AS "certifiedAt"
      `);
      const certification = inserted[0];
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceMonthCertification', entityId: certification.id, metadata: { month: period.text, revision, summaryDigest: digest, summary } }, tx);
      return { ...certification, summary, blockerCount: 0 };
    });
  }

  async function unlock({ actor, month, reason } = {}) {
    assertAdmin(actor);
    const period = parseMonth(month);
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) throw http(400, 'ATTENDANCE_UNLOCK_REASON_INVALID', 'Unlock reason must contain 5-1000 characters.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext(${`attendance-cert:${period.text}`}))`);
      const current = await tx.$queryRaw(Prisma.sql`
        SELECT id, revision, summary_digest AS "summaryDigest"
        FROM attendance_month_certifications
        WHERE month = ${period.start}::date AND status = 'CERTIFIED'
        LIMIT 1
      `);
      if (!current.length) throw http(409, 'ATTENDANCE_MONTH_NOT_CERTIFIED', 'Attendance month is not currently certified.');
      const row = current[0];
      const updated = await tx.$queryRaw(Prisma.sql`
        UPDATE attendance_month_certifications
        SET status = 'UNLOCKED', unlocked_by_user_id = ${actor.sub}::uuid, unlocked_at = ${now}, unlock_reason = ${normalizedReason}
        WHERE id = ${row.id}::uuid AND status = 'CERTIFIED'
        RETURNING id, month, revision, status::text AS status, summary_digest AS "summaryDigest", unlocked_at AS "unlockedAt", unlock_reason AS "unlockReason"
      `);
      if (!updated.length) throw http(409, 'ATTENDANCE_MONTH_CERTIFICATION_CHANGED', 'Attendance month certification changed.');
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceMonthCertification', entityId: row.id, metadata: { month: period.text, revision: row.revision, summaryDigest: row.summaryDigest, unlockReason: normalizedReason } }, tx);
      return updated[0];
    });
  }

  return { certificationHistory, officialRows, preview, certify, unlock };
}

module.exports = { parseMonth, snapshotDigest, certificationBlockers, monthSummary, assertAdmin, requireApprovedSchedule, createAttendanceMonthGovernanceService };
