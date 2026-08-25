'use strict';

const { Prisma } = require('@prisma/client');
const prismaDefault = require('../config/prisma');
const { assignmentWindow } = require('./attendance-result.service');

function dateWithin(date, window) {
  return date.getTime() >= window.startAt.getTime() && date.getTime() <= window.endAt.getTime();
}

function actionableShiftType(shift) {
  const code = String(shift?.code || '').trim().toUpperCase();
  return !['OFF', 'AL', 'LEAVE'].includes(code) && Boolean(shift?.startTime && shift?.endTime);
}

function candidateWindow(workDate, shift) {
  try {
    return assignmentWindow({ workDate, startTime: shift.startTime, endTime: shift.endTime, shiftType: shift });
  } catch {
    return null;
  }
}

function detectWrongShiftFromRows({ assignment, eventAt, activeShiftTypes = [] } = {}) {
  const at = new Date(eventAt);
  if (!assignment || Number.isNaN(at.getTime())) return null;
  let expected;
  try { expected = assignmentWindow(assignment); } catch { return null; }
  if (dateWithin(at, expected)) return null;
  const expectedId = String(assignment.shiftTypeId || assignment.shiftType?.id || '');
  const expectedCode = String(assignment.shiftType?.code || '').trim().toUpperCase();
  for (const shift of activeShiftTypes) {
    if (!actionableShiftType(shift)) continue;
    if ((expectedId && String(shift.id) === expectedId) || (expectedCode && String(shift.code || '').trim().toUpperCase() === expectedCode)) continue;
    const window = candidateWindow(assignment.workDate, shift);
    if (window && dateWithin(at, window)) {
      return { flag: 'WRONG_SHIFT', actualShiftTypeId: shift.id, actualShiftCode: shift.code, actualShiftName: shift.name || shift.code };
    }
  }
  return null;
}

async function activeAttendanceShiftTypes(client = prismaDefault) {
  return client.$queryRaw(Prisma.sql`
    SELECT st.id, st.code, st.name,
      st.start_time AS "startTime",
      st.end_time AS "endTime",
      COALESCE(settings.is_active, TRUE) AS "isActive"
    FROM shift_types st
    LEFT JOIN attendance_shift_type_settings settings ON settings.shift_type_id = st.id
    WHERE COALESCE(settings.is_active, TRUE) = TRUE
    ORDER BY st.code ASC
  `);
}

async function detectWrongShiftForAssignment({ assignment, eventAt } = {}, client = prismaDefault) {
  return detectWrongShiftFromRows({ assignment, eventAt, activeShiftTypes: await activeAttendanceShiftTypes(client) });
}

async function setAttendanceShiftActive({ shiftTypeId, isActive }, client = prismaDefault) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO attendance_shift_type_settings (shift_type_id, is_active, updated_at)
    VALUES (${shiftTypeId}::uuid, ${Boolean(isActive)}, CURRENT_TIMESTAMP)
    ON CONFLICT (shift_type_id) DO UPDATE
    SET is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP
  `);
  return Boolean(isActive);
}

async function shiftActivationMap(shiftTypeIds, client = prismaDefault) {
  if (!Array.isArray(shiftTypeIds) || !shiftTypeIds.length) return new Map();
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT st.id, COALESCE(settings.is_active, TRUE) AS "isActive"
    FROM shift_types st
    LEFT JOIN attendance_shift_type_settings settings ON settings.shift_type_id = st.id
    WHERE st.id IN (${Prisma.join(shiftTypeIds.map((id) => Prisma.sql`${id}::uuid`))})
  `);
  return new Map(rows.map((row) => [row.id, row.isActive === true]));
}

module.exports = {
  actionableShiftType,
  detectWrongShiftFromRows,
  activeAttendanceShiftTypes,
  detectWrongShiftForAssignment,
  setAttendanceShiftActive,
  shiftActivationMap
};
