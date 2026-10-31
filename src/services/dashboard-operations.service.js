'use strict';

// Dashboard "ภาพรวมวันนี้" operations aggregate (Owner batch 12 B mockup dashboard.html).
// Definitions (fixed and tested; differ on purpose from the month report KPI, see feasibility.md):
// - planned: distinct employees with a non-OFF ShiftAssignment today (Asia/Bangkok) minus approved leave.
// - checkedIn: planned employees with at least one counted CHECK_IN (not voided session/event).
// - lateNotCheckedIn: planned employees whose shift start + grace has passed and who have no check-in.
// - assistOtherSite: distinct employees whose counted check-in was recorded as SUPPORT_SITE.
// - patrol: distinct active checkpoints scanned in the CURRENT 3-hour patrol round vs active checkpoints.
// - site status: URGENT when someone is late, WATCH when someone due has not checked in or patrol is
//   incomplete, NORMAL otherwise.
// A failed source is reported in partialErrors and returned as null, never as 0.

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { assignmentWindow } = require('./attendance-result.service');
const { patrolRoundOf, ROUND_HOURS, DAY_START_HOUR } = require('./patrol.service');

const ROLES = new Set(['ADMIN', 'MANAGER', 'SUPERVISOR']);
const BANGKOK_OFFSET_MS = 7 * 3600000;
const HOUR_MS = 3600000;
const DEFAULT_GRACE_MINUTES = 15;
const APPROVED = ['APPROVED'];

const bangkokDay = (date) => new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
const dateText = (value) => (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);

function countedCheckIn(assignment) {
  const sessions = Array.isArray(assignment.attendanceSession) ? assignment.attendanceSession : assignment.attendanceSession ? [assignment.attendanceSession] : [];
  for (const session of sessions) {
    if (!session || String(session.state || '').toUpperCase() === 'VOIDED' || session.voidedAt) continue;
    for (const event of session.events || []) {
      if (String(event.eventType || '').toUpperCase() !== 'CHECK_IN') continue;
      if (String(event.state || 'ACTIVE').toUpperCase() !== 'ACTIVE' || event.voidedAt) continue;
      return { ...event, expectedSiteId: session.expectedSiteId ?? null };
    }
  }
  return null;
}

function isSupport(event) {
  const evidence = event?.locationEvidence;
  if (!evidence || typeof evidence !== 'object') return false;
  const recorded = String(evidence.workSiteContext || '').toUpperCase();
  if (recorded) return recorded === 'SUPPORT_SITE';
  const actual = evidence.actualSiteId || evidence.siteId;
  return Boolean(actual && event.expectedSiteId && String(actual) !== String(event.expectedSiteId));
}

function buildPatrol({ checkpoints, scans, now }) {
  const { day, round } = patrolRoundOf(now);
  const dayStart = Date.parse(`${day}T00:00:00.000Z`) + DAY_START_HOUR * HOUR_MS - BANGKOK_OFFSET_MS;
  const roundStart = new Date(dayStart + (round - 1) * ROUND_HOURS * HOUR_MS);
  const roundEnd = new Date(roundStart.getTime() + ROUND_HOURS * HOUR_MS);
  const active = new Set(checkpoints.map((row) => row.id));
  const scanned = new Set(scans.filter((scan) => {
    const at = new Date(scan.scannedAt).getTime();
    return active.has(scan.checkpointId) && at >= roundStart.getTime() && at < roundEnd.getTime();
  }).map((scan) => scan.checkpointId));
  const missingByDepartment = new Map();
  for (const checkpoint of checkpoints) {
    if (scanned.has(checkpoint.id)) continue;
    missingByDepartment.set(checkpoint.department, (missingByDepartment.get(checkpoint.department) || 0) + 1);
  }
  return {
    scanned: scanned.size,
    total: active.size,
    round,
    roundStart: roundStart.toISOString(),
    roundEnd: roundEnd.toISOString(),
    incompleteDepartments: [...missingByDepartment].map(([department, missing]) => ({ department, missing })).sort((a, b) => a.department.localeCompare(b.department))
  };
}

function buildOperationsToday({ now, assignments = [], approvedLeaves = [], checkpoints = [], scans = [], pendingLeaveCount = 0, graceMinutes = DEFAULT_GRACE_MINUTES, failed = new Set() }) {
  const today = bangkokDay(now);
  const onLeave = new Set(approvedLeaves.filter((leave) => dateText(leave.startDate) <= today && dateText(leave.endDate) >= today).map((leave) => leave.employeeId));
  const people = new Map();
  for (const assignment of assignments) {
    if (String(assignment.shiftType?.code || '').trim().toUpperCase() === 'OFF') continue;
    if (onLeave.has(assignment.employeeId)) continue;
    const current = people.get(assignment.employeeId) || { employeeId: assignment.employeeId, site: assignment.securitySite || null, checkIn: null, startAt: null };
    const event = countedCheckIn(assignment);
    if (event && !current.checkIn) current.checkIn = event;
    let window = null;
    try { window = assignmentWindow(assignment); } catch { window = null; }
    if (window && (!current.startAt || window.startAt < current.startAt)) current.startAt = window.startAt;
    if (!current.site && assignment.securitySite) current.site = assignment.securitySite;
    people.set(assignment.employeeId, current);
  }
  const graceMs = graceMinutes * 60000;
  const sites = new Map();
  let checkedIn = 0; let late = 0; let assist = 0;
  for (const person of people.values()) {
    const isLate = !person.checkIn && person.startAt && now.getTime() >= person.startAt.getTime() + graceMs;
    if (person.checkIn) { checkedIn += 1; if (isSupport(person.checkIn)) assist += 1; }
    if (isLate) late += 1;
    const key = person.site?.id || 'UNASSIGNED';
    const site = sites.get(key) || { id: person.site?.id || null, name: person.site?.name || 'ไม่ระบุจุดปฏิบัติงาน', planned: 0, checkedIn: 0, late: 0, due: 0 };
    site.planned += 1;
    if (person.checkIn) site.checkedIn += 1;
    if (isLate) site.late += 1;
    if (person.startAt && now.getTime() >= person.startAt.getTime()) site.due += 1;
    sites.set(key, site);
  }
  const patrol = failed.has('patrol') ? null : buildPatrol({ checkpoints, scans, now });
  const siteRows = [...sites.values()].map((site) => {
    const dueMissing = Math.max(0, site.due - site.checkedIn);
    const status = site.late > 0 ? 'URGENT' : (dueMissing > 0 || site.checkedIn < site.planned) ? 'WATCH' : 'NORMAL';
    const { due, ...rest } = site;
    return { ...rest, status };
  }).sort((a, b) => ({ URGENT: 0, WATCH: 1, NORMAL: 2 }[a.status] - { URGENT: 0, WATCH: 1, NORMAL: 2 }[b.status]) || a.name.localeCompare(b.name, 'th'));

  const actions = [];
  if (!failed.has('attendance') && late > 0) {
    const where = siteRows.filter((site) => site.late > 0).map((site) => site.name).join(', ');
    actions.push({ type: 'LATE_NOT_CHECKED_IN', severity: 'URGENT', title: 'ยังไม่เช็กอินเลยเวลา', detail: `${where} · เกินเวลาเริ่มกะ`, count: late, unit: 'คน', target: 'attendanceSupervisor' });
  }
  if (patrol && patrol.total > patrol.scanned) {
    actions.push({ type: 'PATROL_INCOMPLETE', severity: 'WATCH', title: 'จุดตรวจยังไม่ครบในรอบนี้', detail: `${patrol.incompleteDepartments.map((row) => row.department).join(', ')} · เหลือ ${patrol.total - patrol.scanned} จุด`, count: patrol.total - patrol.scanned, unit: 'จุด', target: 'patrolCenter' });
  }
  if (!failed.has('leave') && pendingLeaveCount > 0) {
    actions.push({ type: 'LEAVE_PENDING', severity: 'INFO', title: 'คำขอลารออนุมัติ', detail: 'ตรวจสอบก่อนจัดกำลัง', count: pendingLeaveCount, unit: 'รายการ', target: 'leavePending' });
  }
  const attendanceFailed = failed.has('attendance');
  return {
    date: today,
    planned: attendanceFailed ? null : people.size,
    checkedIn: attendanceFailed ? null : checkedIn,
    lateNotCheckedIn: attendanceFailed ? null : late,
    assistOtherSite: attendanceFailed ? null : assist,
    onLeave: failed.has('leave') ? null : onLeave.size,
    graceMinutes,
    patrol,
    pendingLeave: failed.has('leave') ? null : pendingLeaveCount,
    sites: attendanceFailed ? [] : siteRows,
    actions,
    partialErrors: [...failed]
  };
}

function createDashboardOperationsService({ prisma = prismaDefault, clock = () => new Date() } = {}) {
  async function today({ actor, siteId } = {}) {
    if (!ROLES.has(String(actor?.role || '').toUpperCase())) throw new HttpError(403, 'Dashboard operations require ADMIN, MANAGER or SUPERVISOR.', { code: 'DASHBOARD_OPERATIONS_FORBIDDEN' });
    const now = clock();
    const day = bangkokDay(now);
    const workDate = new Date(`${day}T00:00:00.000Z`);
    const previous = new Date(workDate.getTime() - 86400000);
    const where = { workDate, ...(siteId ? { securitySiteId: siteId } : {}) };
    const failed = new Set();
    const safe = async (label, task, fallback) => { try { return await task(); } catch { failed.add(label); return fallback; } };
    const [assignments, approvedLeaves, pendingLeaveCount, checkpoints, scans, siteOptions] = await Promise.all([
      safe('attendance', () => prisma.shiftAssignment.findMany({
        where,
        select: {
          id: true, employeeId: true, workDate: true, startTime: true, endTime: true, securitySiteId: true,
          securitySite: { select: { id: true, name: true } },
          shiftType: { select: { code: true, startTime: true, endTime: true } },
          attendanceSession: { select: { state: true, voidedAt: true, expectedSiteId: true, events: { select: { eventType: true, state: true, voidedAt: true, effectiveEventAt: true, locationEvidence: true } } } }
        }
      }), []),
      safe('leave', () => prisma.leaveRequest.findMany({ where: { status: { in: APPROVED }, startDate: { lte: workDate }, endDate: { gte: workDate } }, select: { employeeId: true, startDate: true, endDate: true } }), []),
      safe('leave', () => prisma.leaveRequest.count({ where: { status: 'PENDING' } }), 0),
      safe('patrol', () => prisma.patrolCheckpoint.findMany({ where: { isActive: true }, select: { id: true, department: true } }), []),
      safe('patrol', () => prisma.patrolScan.findMany({ where: { workDate: { gte: previous, lte: workDate } }, select: { checkpointId: true, scannedAt: true } }), []),
      safe('sites', () => prisma.securitySite.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { code: 'asc' } }), [])
    ]);
    return { ...buildOperationsToday({ now, assignments, approvedLeaves, checkpoints, scans, pendingLeaveCount, failed }), siteId: siteId || null, siteOptions, generatedAt: now.toISOString() };
  }
  return { today };
}

module.exports = { buildOperationsToday, createDashboardOperationsService };
