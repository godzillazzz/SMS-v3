'use strict';

// Report Center KPI aggregates (OWNER-approved redesign, 30 Oct 2026).
// Every percentage with no base (0/0) is null so the UI renders "—", never 0% or NaN.
// Times are Asia/Bangkok; a patrol day starts 07:00 and has 8 rounds of 3 hours.

const { classifyAttendanceDay, assignmentWindow, DEVICE_TRANSFER_REJECTED } = require('./attendance-result.service');
const { patrolRoundOf, ROUNDS_PER_DAY, ROUND_HOURS, DAY_START_HOUR } = require('./patrol.service');
const { departmentValues, departmentMatches } = require('./report-scope');

const BANGKOK_OFFSET_MS = 7 * 3600000;
const HOUR_MS = 3600000;

function percentageOrNull(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  return Math.round((top / bottom) * 1000) / 10;
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function sessionsOf(assignment) {
  const value = assignment?.attendanceSession;
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function liveSession(session) {
  return session && String(session.state || '').toUpperCase() !== 'VOIDED' && !session.voidedAt;
}

// Events that still count after void/device-transfer rejection rules.
function countedEventsOf(assignment) {
  const events = [];
  for (const session of sessionsOf(assignment)) {
    if (!liveSession(session)) continue;
    for (const event of session.events || []) {
      if (String(event?.state || 'ACTIVE').toUpperCase() !== 'ACTIVE' || event?.voidedAt) continue;
      if (Array.isArray(event?.reviewReasons) && event.reviewReasons.includes(DEVICE_TRANSFER_REJECTED)) continue;
      events.push({ ...event, expectedSiteId: session.expectedSiteId ?? null });
    }
  }
  return events;
}

function isOffShift(assignment) {
  return String(assignment?.shiftType?.code || '').trim().toUpperCase() === 'OFF';
}

function onApprovedLeave(assignment, approvedLeaves) {
  const day = dateText(assignment.workDate);
  return approvedLeaves.some((leave) => leave.employeeId && leave.employeeId === assignment.employeeId
    && dateText(leave.startDate) <= day && dateText(leave.endDate) >= day);
}

// Same derivation as attendance-supervisor/self siteObservations: a recorded context wins; otherwise
// SUPPORT_SITE only when both actual and expected site ids exist and differ (never guessed silently).
function isSupportSiteCheckIn(event) {
  const evidence = event?.locationEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const recorded = String(evidence.workSiteContext || '').toUpperCase();
  if (recorded === 'SUPPORT_SITE') return true;
  if (recorded === 'ASSIGNED_SITE') return false;
  const actual = evidence.actualSiteId || evidence.siteId || null;
  return Boolean(actual && event.expectedSiteId && String(actual) !== String(event.expectedSiteId));
}

function buildAttendanceMetrics({ assignments = [], approvedLeaves = [], from, nextMonthStart, asOf = new Date() }) {
  const start = new Date(from).getTime();
  const end = new Date(nextMonthStart).getTime();
  const now = new Date(asOf);
  const seen = new Set();
  let scheduledAssignments = 0;
  let checkedInAssignments = 0;
  let absentAssignments = 0;
  let assistOtherSiteCheckIns = 0;
  let unclassifiableAssignments = 0;
  for (const assignment of assignments) {
    const key = assignment.id || `${assignment.employeeId}|${dateText(assignment.workDate)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const workDate = new Date(assignment.workDate).getTime();
    if (workDate < start || workDate >= end || isOffShift(assignment)) continue;
    const events = countedEventsOf(assignment);
    const checkIn = events.find((event) => String(event.eventType || '').toUpperCase() === 'CHECK_IN');
    let window = null;
    try { window = assignmentWindow(assignment); } catch { window = null; }
    const ended = window ? now.getTime() >= window.endAt.getTime() : false;
    if (!window && !checkIn) { unclassifiableAssignments += 1; continue; }
    // Base: non-OFF shifts that are already due (ended) or already checked in; future shifts never count.
    if (!ended && !checkIn) continue;
    scheduledAssignments += 1;
    if (checkIn) {
      checkedInAssignments += 1;
      if (isSupportSiteCheckIn(checkIn)) assistOtherSiteCheckIns += 1;
      continue;
    }
    const result = classifyAttendanceDay({ assignment, events, approvedLeave: onApprovedLeave(assignment, approvedLeaves), asOf: now });
    if (result.status === 'ABSENT') absentAssignments += 1;
  }
  return {
    scheduledAssignments,
    checkedInAssignments,
    absentAssignments,
    assistOtherSiteCheckIns,
    unclassifiableAssignments,
    attendanceRate: percentageOrNull(checkedInAssignments, scheduledAssignments)
  };
}

function patrolDayStartMs(day) {
  return Date.parse(`${day}T00:00:00.000Z`) + DAY_START_HOUR * HOUR_MS - BANGKOK_OFFSET_MS;
}

function patrolDates(from, to) {
  const dates = [];
  for (let time = Date.parse(`${from}T00:00:00.000Z`); time <= Date.parse(`${to}T00:00:00.000Z`); time += 86400000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

// Coverage = distinct (checkpoint, patrol day, round) with ≥1 scan ÷ checkpoint × completed rounds.
// Rounds that have not ended by asOf are excluded from numerator and denominator alike.
function buildDepartmentRoundCoverage({ checkpoints = [], scans = [], from, to, asOf = new Date() }) {
  const nowMs = new Date(asOf).getTime();
  const roundMs = ROUND_HOURS * HOUR_MS;
  const dates = patrolDates(from, to);
  const completed = new Map();
  for (const day of dates) {
    const elapsed = Math.floor((nowMs - patrolDayStartMs(day)) / roundMs);
    completed.set(day, Math.max(0, Math.min(ROUNDS_PER_DAY, elapsed)));
  }
  const checkpointById = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const scanned = new Set();
  for (const scan of scans) {
    if (!checkpointById.has(scan.checkpointId)) continue;
    const { day, round } = patrolRoundOf(scan.scannedAt);
    if (!completed.has(day) || round > completed.get(day)) continue;
    scanned.add(`${scan.checkpointId}|${day}|${round}`);
  }
  const roundsPerCheckpoint = [...completed.values()].reduce((sum, value) => sum + value, 0);
  const departments = new Map();
  for (const checkpoint of checkpoints) {
    const name = checkpoint.department || 'ไม่ระบุจุดปฏิบัติงาน';
    const row = departments.get(name) || { department: name, checkpoints: 0, expectedRounds: 0, scannedRounds: 0 };
    row.checkpoints += 1;
    row.expectedRounds += roundsPerCheckpoint;
    departments.set(name, row);
  }
  for (const key of scanned) {
    const checkpoint = checkpointById.get(key.split('|')[0]);
    departments.get(checkpoint.department || 'ไม่ระบุจุดปฏิบัติงาน').scannedRounds += 1;
  }
  const byDepartment = [...departments.values()]
    .sort((a, b) => String(a.department).localeCompare(String(b.department), 'th'))
    .map((row) => ({ ...row, missedRounds: row.expectedRounds - row.scannedRounds, coveragePercent: percentageOrNull(row.scannedRounds, row.expectedRounds) }));
  const expectedRounds = byDepartment.reduce((sum, row) => sum + row.expectedRounds, 0);
  const scannedRounds = byDepartment.reduce((sum, row) => sum + row.scannedRounds, 0);
  return {
    expectedRounds,
    scannedRounds,
    missedRounds: expectedRounds - scannedRounds,
    coveragePercent: percentageOrNull(scannedRounds, expectedRounds),
    byDepartment,
    config: { perDay: ROUNDS_PER_DAY, hours: ROUND_HOURS, startHour: DAY_START_HOUR, timeZone: 'Asia/Bangkok' }
  };
}

module.exports = {
  departmentValues,
  departmentMatches,
  percentageOrNull,
  countedEventsOf,
  isSupportSiteCheckIn,
  buildAttendanceMetrics,
  buildDepartmentRoundCoverage
};
