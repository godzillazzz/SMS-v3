const audit = require('./audit.service');

const startOfUtcDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const dateText = (value) => new Date(value).toISOString().slice(0, 10);
const isWorkingCode = (code) => !['OFF', 'AL'].includes(String(code || '').toUpperCase());
const blockedRemark = (code) => `License Block: [${String(code || '').toUpperCase()}]`;
const blockedCode = (remark) => /^License Block:\s*\[([A-Z0-9_-]+)\]/i.exec(String(remark || ''))?.[1]?.toUpperCase() || null;

function licenseStateForDate(licenses, workDate) {
  const active = licenses.filter((license) => ['active', 'valid'].includes(String(license.status || '').trim().toLowerCase()));
  const valid = active.find((license) => license.issueDate && license.expiryDate && new Date(license.issueDate) <= workDate && new Date(license.expiryDate) >= workDate);
  if (valid) return { valid: true, status: 'VALID', expiryDate: valid.expiryDate };
  const record = active[0] || licenses[0];
  return { valid: false, status: record ? (active.length ? 'EXPIRED' : 'INVALID') : 'MISSING', expiryDate: record?.expiryDate || null };
}

function buildLicenseScheduleReconciliation({ licenses, assignments, shiftTypes, asOf = new Date() }) {
  const today = startOfUtcDay(asOf);
  const shiftsByCode = new Map(shiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  const off = shiftsByCode.get('OFF');
  if (!off) throw new Error('OFF shift type is required for license reconciliation.');

  const updates = [];
  const summary = { blocked: 0, restored: 0, validated: 0, skippedHistorical: 0, skippedProtected: 0 };

  for (const assignment of assignments) {
    const workDate = new Date(assignment.workDate);
    if (workDate < today) { summary.skippedHistorical += 1; continue; }
    const code = String(assignment.shiftType?.code || '').toUpperCase();
    if (assignment.locked || assignment.licenseOverride || code === 'AL') { summary.skippedProtected += 1; continue; }

    const state = licenseStateForDate(licenses, workDate);
    if (isWorkingCode(code)) {
      if (state.valid) {
        if (assignment.licenseStatus !== 'VALID' || String(assignment.licenseExpiryDate || '') !== String(state.expiryDate || '')) {
          updates.push({ id: assignment.id, workDate, kind: 'validated', data: { licenseStatus: 'VALID', licenseExpiryDate: state.expiryDate, licenseOverride: false } });
          summary.validated += 1;
        }
        continue;
      }
      updates.push({
        id: assignment.id, workDate, kind: 'blocked',
        data: { shiftTypeId: off.id, startTime: off.startTime, endTime: off.endTime, hours: off.hours, remark: blockedRemark(code), licenseStatus: state.status, licenseExpiryDate: state.expiryDate, licenseOverride: false, overrideReason: null, overrideAt: null }
      });
      summary.blocked += 1;
      continue;
    }

    const previousCode = code === 'OFF' ? blockedCode(assignment.remark) : null;
    if (previousCode && state.valid) {
      const restoredShift = shiftsByCode.get(previousCode);
      if (restoredShift) {
        updates.push({
          id: assignment.id, workDate, kind: 'restored',
          data: { shiftTypeId: restoredShift.id, startTime: restoredShift.startTime, endTime: restoredShift.endTime, hours: restoredShift.hours, remark: null, licenseStatus: 'VALID', licenseExpiryDate: state.expiryDate, licenseOverride: false, overrideReason: null, overrideAt: null }
        });
        summary.restored += 1;
      }
    } else if (previousCode && (assignment.licenseStatus !== state.status || String(assignment.licenseExpiryDate || '') !== String(state.expiryDate || ''))) {
      updates.push({ id: assignment.id, workDate, kind: 'blocked-status', data: { licenseStatus: state.status, licenseExpiryDate: state.expiryDate, licenseOverride: false } });
    }
  }
  return { updates, summary };
}

async function touchApproval(tx, month, actorUserId) {
  const latestApproved = await tx.scheduleApproval.findFirst({ where: { month, status: 'APPROVED' }, orderBy: { revision: 'desc' }, select: { revision: true } });
  const pending = await tx.scheduleApproval.findFirst({ where: { month, status: 'PENDING' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (pending) return tx.scheduleApproval.update({ where: { id: pending.id }, data: { changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'LICENSE_RECONCILIATION' } });
  return tx.scheduleApproval.create({ data: { month, status: 'PENDING', revision: latestApproved?.revision || 1, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'LICENSE_RECONCILIATION' } });
}

async function reconcileEmployeeLicenseSchedules(tx, employeeId, actorUserId, asOf = new Date()) {
  const [licenses, assignments, shiftTypes] = await Promise.all([
    tx.employeeLicense.findMany({ where: { employeeId }, select: { status: true, issueDate: true, expiryDate: true } }),
    tx.shiftAssignment.findMany({ where: { employeeId }, include: { shiftType: { select: { code: true } } } }),
    tx.shiftType.findMany({ select: { id: true, code: true, startTime: true, endTime: true, hours: true } })
  ]);
  const plan = buildLicenseScheduleReconciliation({ licenses, assignments, shiftTypes, asOf });
  if (!plan.updates.length) return plan.summary;

  for (const update of plan.updates) await tx.shiftAssignment.update({ where: { id: update.id }, data: update.data });
  const months = [...new Set(plan.updates.map((update) => `${update.workDate.getUTCFullYear()}-${update.workDate.getUTCMonth()}`))];
  for (const key of months) {
    const [year, month] = key.split('-').map(Number);
    await touchApproval(tx, new Date(Date.UTC(year, month, 1)), actorUserId);
  }
  await audit.log({ actorUserId, action: 'UPDATE', entityType: 'LicenseScheduleReconciliation', entityId: employeeId, metadata: { ...plan.summary, affectedAssignments: plan.updates.length, fromDate: dateText(startOfUtcDay(asOf)) } }, tx);
  return plan.summary;
}

module.exports = { buildLicenseScheduleReconciliation, reconcileEmployeeLicenseSchedules, licenseStateForDate };
