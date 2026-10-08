const audit = require('./audit.service');
const { licenseStateForWorkDate, loadLicenseAuthorityByEmployee } = require('./license-state.service');

const dateText = (value) => new Date(value).toISOString().slice(0, 10);
const isWorkingCode = (code) => !['OFF', 'AL'].includes(String(code || '').toUpperCase());
const legacyBlockedCode = (remark) => /^License Block:\s*\[([A-Z0-9_-]+)\]/i.exec(String(remark || ''))?.[1]?.toUpperCase() || null;

// ShiftAssignment.workDate is a date-only UTC value; the cutoff is Bangkok's calendar day.
function bangkokToday(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('Valid reconciliation time is required.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

function buildLicenseScheduleReconciliation({ licenses, assignments, shiftTypes, now = new Date() }) {
  const shiftsByCode = new Map(shiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  const shiftsById = new Map(shiftTypes.map((shift) => [shift.id, shift]));
  const off = shiftsByCode.get('OFF');
  if (!off || off.isActive === false) throw new Error('Active OFF shift type is required for license reconciliation.');

  const updates = [];
  const summary = { blocked: 0, restored: 0, validated: 0, preservedOverrides: 0, skippedLeave: 0, skippedInactiveRestore: 0, skippedPast: 0 };
  const reconciliationTimestamp = new Date(now);
  const cutoff = bangkokToday(reconciliationTimestamp);
  for (const assignment of assignments) {
    if (dateText(assignment.workDate) < dateText(cutoff)) { summary.skippedPast += 1; continue; }
    const code = String(assignment.shiftType?.code || '').toUpperCase();
    if (code === 'AL') { summary.skippedLeave += 1; continue; }
    if (assignment.licenseOverride) { summary.preservedOverrides += 1; continue; }
    const state = licenseStateForWorkDate(licenses, assignment.workDate);

    if (isWorkingCode(code)) {
      if (state.valid) {
        if (assignment.licenseStatus !== 'VALID' || String(assignment.licenseExpiryDate || '') !== String(state.expiryDate || '')) {
          updates.push({ id: assignment.id, workDate: assignment.workDate, kind: 'validated', data: { licenseStatus: 'VALID', licenseExpiryDate: state.expiryDate, licenseBlockedFromShiftTypeId: null, licenseBlockedFromRemark: null, licenseBlockedAt: null } });
          summary.validated += 1;
        }
      } else {
        updates.push({
          id: assignment.id, workDate: assignment.workDate, kind: 'blocked',
          data: { shiftTypeId: off.id, startTime: off.startTime, endTime: off.endTime, hours: off.hours, remark: 'License Block', licenseStatus: state.status, licenseExpiryDate: state.expiryDate, licenseOverride: false, licenseBlockedFromShiftTypeId: assignment.shiftTypeId, licenseBlockedFromRemark: assignment.remark || null, licenseBlockedAt: reconciliationTimestamp, overrideReason: null, overrideAt: null }
        });
        summary.blocked += 1;
      }
      continue;
    }

    const originalId = assignment.licenseBlockedFromShiftTypeId || null;
    const originalShift = originalId ? shiftsById.get(originalId) : null;
    const legacyShift = !originalShift ? shiftsByCode.get(legacyBlockedCode(assignment.remark)) : null;
    const restore = originalShift || legacyShift;
    if (!restore) continue;
    if (restore.isActive === false) { summary.skippedInactiveRestore += 1; continue; }
    if (state.valid) {
      updates.push({
        id: assignment.id, workDate: assignment.workDate, kind: 'restored',
        data: { shiftTypeId: restore.id, startTime: restore.startTime, endTime: restore.endTime, hours: restore.hours, remark: assignment.licenseBlockedFromRemark || null, licenseStatus: 'VALID', licenseExpiryDate: state.expiryDate, licenseOverride: false, licenseBlockedFromShiftTypeId: null, licenseBlockedFromRemark: null, licenseBlockedAt: null, overrideReason: null, overrideAt: null }
      });
      summary.restored += 1;
    } else if (assignment.licenseStatus !== state.status || String(assignment.licenseExpiryDate || '') !== String(state.expiryDate || '')) {
      updates.push({ id: assignment.id, workDate: assignment.workDate, kind: 'blocked-status', data: { licenseStatus: state.status, licenseExpiryDate: state.expiryDate } });
    }
  }
  return { updates, summary };
}

function groupReconciliationUpdates(updates) {
  const groups = new Map();
  for (const update of updates) {
    const key = JSON.stringify(update.data);
    const existing = groups.get(key);
    if (existing) existing.ids.push(update.id);
    else groups.set(key, { ids: [update.id], data: update.data });
  }
  return [...groups.values()];
}

async function applyReconciliationUpdates(tx, updates, cutoff = null) {
  for (const group of groupReconciliationUpdates(updates)) {
    const result = await tx.shiftAssignment.updateMany({ where: { id: { in: group.ids }, ...(cutoff ? { workDate: { gte: cutoff } } : {}) }, data: group.data });
    if (Number(result?.count) !== group.ids.length) throw new Error('License reconciliation update count mismatch.');
  }
}
async function reconcileEmployeeLicenseSchedules(tx, employeeId, actorUserId, { now = new Date() } = {}) {
  const cutoff = bangkokToday(now);
  const [licenseAuthority, assignments, shiftTypes] = await Promise.all([
    loadLicenseAuthorityByEmployee(tx, [employeeId]),
    tx.shiftAssignment.findMany({ where: { employeeId, workDate: { gte: cutoff } }, include: { shiftType: { select: { code: true } } } }),
    tx.shiftType.findMany({ select: { id: true, code: true, startTime: true, endTime: true, hours: true, isActive: true } })
  ]);
  const plan = buildLicenseScheduleReconciliation({ licenses: licenseAuthority.get(employeeId) || [], assignments, shiftTypes, now });
  const result = { ...plan.summary, affectedAssignments: plan.updates.length };
  if (!plan.updates.length) return result;
  await applyReconciliationUpdates(tx, plan.updates, cutoff);
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const fields = ['shiftTypeId', 'startTime', 'endTime', 'hours', 'remark', 'licenseStatus', 'licenseExpiryDate', 'licenseOverride', 'licenseBlockedFromShiftTypeId', 'licenseBlockedFromRemark', 'licenseBlockedAt', 'overrideReason', 'overrideAt'];
  const beforeRecord = (assignment) => Object.fromEntries(fields.map((key) => [key, assignment[key] ?? null]));
  // This is a license safety audit, never a manual schedule approval or revision.
  await audit.log({
    actorUserId, action: 'UPDATE', entityType: 'LicenseScheduleReconciliation', entityId: employeeId,
    metadata: {
      ...result, datesReconciled: [...new Set(plan.updates.map((update) => dateText(update.workDate)))].length,
      cutoffDate: dateText(cutoff), timeZone: 'Asia/Bangkok', scheduleApprovalChanged: false,
      changes: plan.updates.map((update) => ({ assignmentId: update.id, workDate: dateText(update.workDate), kind: update.kind, before: beforeRecord(assignmentsById.get(update.id)), after: { ...beforeRecord(assignmentsById.get(update.id)), ...update.data } }))
    }
  }, tx);
  return result;
}

async function reconcileAllEmployeeLicenseSchedules(prisma, { now = new Date() } = {}) {
  return prisma.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
    const totals = { employees: employees.length, blocked: 0, restored: 0, validated: 0, preservedOverrides: 0, affectedAssignments: 0 };
    for (const employee of employees) {
      const result = await reconcileEmployeeLicenseSchedules(tx, employee.id, null, { now });
      for (const key of ['blocked', 'restored', 'validated', 'preservedOverrides']) totals[key] += Number(result[key] || 0);
      totals.affectedAssignments += Number(result.affectedAssignments || 0);
    }
    return totals;
  }, { timeout: 30000 });
}

module.exports = { buildLicenseScheduleReconciliation, groupReconciliationUpdates, applyReconciliationUpdates, bangkokToday, reconcileEmployeeLicenseSchedules, reconcileAllEmployeeLicenseSchedules };
