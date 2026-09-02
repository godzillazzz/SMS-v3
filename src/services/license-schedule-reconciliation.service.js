const audit = require('./audit.service');
const { licenseStateForWorkDate } = require('./license-state.service');

const dateText = (value) => new Date(value).toISOString().slice(0, 10);
const isWorkingCode = (code) => !['OFF', 'AL'].includes(String(code || '').toUpperCase());
const legacyBlockedCode = (remark) => /^License Block:\s*\[([A-Z0-9_-]+)\]/i.exec(String(remark || ''))?.[1]?.toUpperCase() || null;

function buildLicenseScheduleReconciliation({ licenses, assignments, shiftTypes }) {
  const shiftsByCode = new Map(shiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  const shiftsById = new Map(shiftTypes.map((shift) => [shift.id, shift]));
  const off = shiftsByCode.get('OFF');
  if (!off || off.isActive === false) throw new Error('Active OFF shift type is required for license reconciliation.');

  const updates = [];
  const summary = { blocked: 0, restored: 0, validated: 0, preservedOverrides: 0, skippedLeave: 0, skippedInactiveRestore: 0 };
  const reconciliationTimestamp = new Date();
  for (const assignment of assignments) {
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

async function touchApproval(tx, month, actorUserId) {
  const latestApproved = await tx.scheduleApproval.findFirst({ where: { month, status: 'APPROVED' }, orderBy: { revision: 'desc' }, select: { revision: true } });
  const pending = await tx.scheduleApproval.findFirst({ where: { month, status: 'PENDING' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (pending) return tx.scheduleApproval.update({ where: { id: pending.id }, data: { changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'LICENSE_RECONCILIATION' } });
  return tx.scheduleApproval.create({ data: { month, status: 'PENDING', revision: (latestApproved?.revision || 0) + 1, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'LICENSE_RECONCILIATION' } });
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

async function applyReconciliationUpdates(tx, updates) {
  for (const group of groupReconciliationUpdates(updates)) {
    const result = await tx.shiftAssignment.updateMany({ where: { id: { in: group.ids } }, data: group.data });
    if (Number(result?.count) !== group.ids.length) throw new Error('License reconciliation update count mismatch.');
  }
}
async function reconcileEmployeeLicenseSchedules(tx, employeeId, actorUserId) {
  const [licenses, assignments, shiftTypes] = await Promise.all([
    tx.employeeLicense.findMany({ where: { employeeId }, select: { status: true, issueDate: true, expiryDate: true } }),
    tx.shiftAssignment.findMany({ where: { employeeId }, include: { shiftType: { select: { code: true } } } }),
    tx.shiftType.findMany({ select: { id: true, code: true, startTime: true, endTime: true, hours: true, isActive: true } })
  ]);
  const plan = buildLicenseScheduleReconciliation({ licenses, assignments, shiftTypes });
  if (!plan.updates.length) return plan.summary;
  await applyReconciliationUpdates(tx, plan.updates);
  const months = [...new Set(plan.updates.map((update) => `${new Date(update.workDate).getUTCFullYear()}-${new Date(update.workDate).getUTCMonth()}`))];
  for (const key of months) {
    const [year, month] = key.split('-').map(Number);
    await touchApproval(tx, new Date(Date.UTC(year, month, 1)), actorUserId);
  }
  await audit.log({ actorUserId, action: 'UPDATE', entityType: 'LicenseScheduleReconciliation', entityId: employeeId, metadata: { ...plan.summary, affectedAssignments: plan.updates.length, datesReconciled: [...new Set(plan.updates.map((update) => dateText(update.workDate)))].length } }, tx);
  return plan.summary;
}

async function reconcileAllEmployeeLicenseSchedules(prisma) {
  return prisma.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
    const totals = { employees: employees.length, blocked: 0, restored: 0, validated: 0, preservedOverrides: 0, affectedAssignments: 0 };
    for (const employee of employees) {
      const result = await reconcileEmployeeLicenseSchedules(tx, employee.id, null);
      for (const key of ['blocked', 'restored', 'validated', 'preservedOverrides']) totals[key] += Number(result[key] || 0);
      totals.affectedAssignments += Number(result.affectedAssignments || 0);
    }
    return totals;
  }, { timeout: 30000 });
}

module.exports = { buildLicenseScheduleReconciliation, groupReconciliationUpdates, applyReconciliationUpdates, touchApproval, reconcileEmployeeLicenseSchedules, reconcileAllEmployeeLicenseSchedules };
