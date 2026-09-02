#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const { loadLicenseAuthorityByEmployee } = require('../../src/services/license-state.service');
const { buildLicenseScheduleReconciliation, applyReconciliationUpdates, touchApproval } = require('../../src/services/license-schedule-reconciliation.service');

const INCIDENT = 'LIC-HIST-01';
const EXPECTED_TOTAL = 413;
const EXPECTED_EXCEPTION_TOTAL = 20;
const INCIDENT_WINDOW_MINUTES = 3;
const DOCUMENT_IDS = [
  '7a7ad447-795e-4456-9be1-e995f56b326a',
  '347ba1b3-ae4a-4b2a-a959-6cb10ac0d0ae',
  'b5fd59c8-4c1a-4990-9a76-b49fc7a2b6cc',
  'db10e5bf-73a3-4e0f-8f5a-27143c7be67d',
  '883fa790-23df-4ab0-b890-526b8a3dfa71',
  '3494e78d-bb80-4244-b585-4af89da61710',
  '5c2b4c68-54f0-4493-bc4d-70e7f3ac494f'
];
const EXPECTED_BY_EMPLOYEE_CODE = new Map([
  ['EMP006', 59],
  ['EMP017', 59],
  ['EMP018', 59],
  ['EMP023', 60],
  ['EMP029', 59],
  ['EMP037', 58],
  ['EMP043', 59]
]);

const prisma = new PrismaClient();
const isoDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;
const iso = (value) => value ? new Date(value).toISOString() : null;
const deltaMinutes = (left, right) => Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 60000;
const stableIds = (rows) => rows.map((row) => String(row.id)).sort();
const sameIds = (left, right) => JSON.stringify(stableIds(left)) === JSON.stringify(stableIds(right));

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL_CLOSED: ${message}`);
}

async function loadScope(client) {
  const docs = await client.employeeLicenseDocument.findMany({
    where: { id: { in: DOCUMENT_IDS } },
    select: {
      id: true, employeeId: true, licenseId: true, status: true, reviewedAt: true,
      proposedStartDate: true, proposedExpiryDate: true,
      employee: { select: { employeeCode: true, firstName: true, lastName: true, displayName: true, department: true } }
    },
    orderBy: { reviewedAt: 'asc' }
  });
  assert(docs.length === DOCUMENT_IDS.length, `expected ${DOCUMENT_IDS.length} incident documents, found ${docs.length}`);
  assert(DOCUMENT_IDS.every((id) => docs.some((doc) => doc.id === id)), 'incident document identity mismatch');
  assert(docs.every((doc) => ['APPROVED', 'SUPERSEDED', 'EXPIRED'].includes(String(doc.status))), 'incident document status is no longer historical authority');
  assert(docs.every((doc) => doc.reviewedAt), 'incident document missing reviewedAt');

  const employeeIds = [...new Set(docs.map((doc) => doc.employeeId))];
  assert(employeeIds.length === 7, `expected 7 incident employees, found ${employeeIds.length}`);

  const [authority, assignments, shiftTypes] = await Promise.all([
    loadLicenseAuthorityByEmployee(client, employeeIds),
    client.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds } },
      include: { shiftType: { select: { id: true, code: true, name: true, isActive: true } } },
      orderBy: [{ employeeId: 'asc' }, { workDate: 'asc' }]
    }),
    client.shiftType.findMany({ select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, isActive: true } })
  ]);

  const docsByEmployee = new Map();
  for (const doc of docs) {
    const list = docsByEmployee.get(doc.employeeId) || [];
    list.push(doc);
    docsByEmployee.set(doc.employeeId, list);
  }

  const candidates = [];
  const exceptions = [];
  const summary = [];
  for (const employeeId of employeeIds) {
    const employeeDocs = docsByEmployee.get(employeeId) || [];
    const employeeAssignments = assignments.filter((row) => row.employeeId === employeeId);
    const plan = buildLicenseScheduleReconciliation({ licenses: authority.get(employeeId) || [], assignments: employeeAssignments, shiftTypes });
    const updateById = new Map(plan.updates.map((update) => [update.id, update]));
    const blockedRows = employeeAssignments.filter((row) => row.licenseBlockedFromShiftTypeId || /^License Block/i.test(String(row.remark || '')));
    const employee = employeeDocs[0].employee;
    const employeeCode = employee.employeeCode;

    let employeeCandidateCount = 0;
    for (const row of blockedRows) {
      const update = updateById.get(row.id) || null;
      const nearest = employeeDocs
        .filter((doc) => row.licenseBlockedAt && doc.reviewedAt)
        .map((doc) => ({ doc, delta: deltaMinutes(doc.reviewedAt, row.licenseBlockedAt) }))
        .sort((a, b) => a.delta - b.delta)[0] || null;
      const incidentMatched = Boolean(nearest && nearest.delta <= INCIDENT_WINDOW_MINUTES);
      const exactRestore = Boolean(
        incidentMatched &&
        update?.kind === 'restored' &&
        String(row.shiftType?.code || '').toUpperCase() === 'OFF' &&
        row.licenseBlockedFromShiftTypeId &&
        row.licenseBlockedAt &&
        update.data?.shiftTypeId &&
        update.data?.licenseStatus === 'VALID'
      );

      if (exactRestore) {
        candidates.push({
          id: row.id,
          employeeId,
          employeeCode,
          employeeName: employee.displayName || `${employee.firstName} ${employee.lastName}`,
          department: employee.department,
          workDate: row.workDate,
          documentId: nearest.doc.id,
          approvalToBlockDeltaMinutes: nearest.delta,
          before: {
            shiftTypeId: row.shiftTypeId,
            shiftCode: row.shiftType?.code || null,
            startTime: row.startTime,
            endTime: row.endTime,
            hours: row.hours,
            remark: row.remark,
            licenseStatus: row.licenseStatus,
            licenseExpiryDate: row.licenseExpiryDate,
            licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId,
            licenseBlockedFromRemark: row.licenseBlockedFromRemark,
            licenseBlockedAt: row.licenseBlockedAt
          },
          update
        });
        employeeCandidateCount += 1;
      } else {
        exceptions.push({
          id: row.id,
          employeeId,
          employeeCode,
          workDate: row.workDate,
          shiftTypeId: row.shiftTypeId,
          shiftCode: row.shiftType?.code || null,
          licenseStatus: row.licenseStatus,
          remark: row.remark,
          licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId,
          licenseBlockedAt: row.licenseBlockedAt,
          incidentMatched,
          plannerKind: update?.kind || null
        });
      }
    }

    summary.push({ employeeCode, employeeId, name: employee.displayName || `${employee.firstName} ${employee.lastName}`, count: employeeCandidateCount });
  }

  return { docs, employeeIds, shiftTypes, candidates, exceptions, summary };
}

function assertExpectedScope(scope) {
  assert(scope.candidates.length === EXPECTED_TOTAL, `expected ${EXPECTED_TOTAL} exact restore candidates, found ${scope.candidates.length}`);
  assert(scope.exceptions.length === EXPECTED_EXCEPTION_TOTAL, `expected ${EXPECTED_EXCEPTION_TOTAL} non-incident exceptions, found ${scope.exceptions.length}`);
  assert(scope.exceptions.every((row) => row.employeeCode === 'EMP029' && !row.incidentMatched), 'exception set changed or overlaps incident');
  assert(scope.summary.length === EXPECTED_BY_EMPLOYEE_CODE.size, 'employee summary size mismatch');
  for (const row of scope.summary) {
    assert(EXPECTED_BY_EMPLOYEE_CODE.has(row.employeeCode), `unexpected employee ${row.employeeCode}`);
    assert(row.count === EXPECTED_BY_EMPLOYEE_CODE.get(row.employeeCode), `employee ${row.employeeCode} expected ${EXPECTED_BY_EMPLOYEE_CODE.get(row.employeeCode)}, found ${row.count}`);
  }
  assert([...EXPECTED_BY_EMPLOYEE_CODE.keys()].every((code) => scope.summary.some((row) => row.employeeCode === code)), 'expected employee set mismatch');
}

function monthKeys(rows) {
  return [...new Set(rows.map((row) => isoDate(row.workDate).slice(0, 7)))].sort();
}

(async () => {
  assert(process.env.LIC_HIST_REPAIR_CONFIRM === 'REPAIR_413_EXACT', 'explicit repair confirmation missing');
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');

  const preflight = await loadScope(prisma);
  assertExpectedScope(preflight);
  const preflightIds = preflight.candidates.map((row) => ({ id: row.id }));
  const preflightExceptionIds = preflight.exceptions.map((row) => ({ id: row.id }));
  console.log(`PREFLIGHT_OK incident=${INCIDENT} candidates=${preflight.candidates.length} exceptions=${preflight.exceptions.length} employees=${preflight.summary.length}`);
  for (const row of preflight.summary) console.log(`PREFLIGHT_EMPLOYEE ${row.employeeCode} count=${row.count} name=${row.name}`);

  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await loadScope(tx);
    assertExpectedScope(fresh);
    assert(sameIds(preflightIds, fresh.candidates), 'candidate assignment IDs changed between preflight and transaction');
    assert(sameIds(preflightExceptionIds, fresh.exceptions), 'exception assignment IDs changed between preflight and transaction');

    const updates = fresh.candidates.map((row) => row.update);
    await applyReconciliationUpdates(tx, updates);

    const auditRows = fresh.candidates.map((row) => ({
      actorUserId: null,
      action: 'UPDATE',
      entityType: 'ShiftAssignment',
      entityId: row.id,
      metadata: {
        incident: INCIDENT,
        repairMode: 'OWNER_APPROVED_TARGETED_EXACT_RESTORE',
        ownerAuthorization: '2026-09-02 Targeted Repair 413 Production',
        githubRunId: process.env.GITHUB_RUN_ID || null,
        githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        department: row.department,
        workDate: isoDate(row.workDate),
        incidentDocumentId: row.documentId,
        approvalToBlockDeltaMinutes: Number(row.approvalToBlockDeltaMinutes.toFixed(3)),
        before: {
          shiftTypeId: row.before.shiftTypeId,
          shiftCode: row.before.shiftCode,
          startTime: row.before.startTime,
          endTime: row.before.endTime,
          hours: String(row.before.hours),
          remark: row.before.remark,
          licenseStatus: row.before.licenseStatus,
          licenseExpiryDate: isoDate(row.before.licenseExpiryDate),
          licenseBlockedFromShiftTypeId: row.before.licenseBlockedFromShiftTypeId,
          licenseBlockedFromRemark: row.before.licenseBlockedFromRemark,
          licenseBlockedAt: iso(row.before.licenseBlockedAt)
        },
        after: {
          shiftTypeId: row.update.data.shiftTypeId,
          startTime: row.update.data.startTime,
          endTime: row.update.data.endTime,
          hours: String(row.update.data.hours),
          remark: row.update.data.remark,
          licenseStatus: row.update.data.licenseStatus,
          licenseExpiryDate: isoDate(row.update.data.licenseExpiryDate),
          licenseBlockedFromShiftTypeId: null,
          licenseBlockedFromRemark: null,
          licenseBlockedAt: null
        }
      }
    }));
    const auditInsert = await tx.auditLog.createMany({ data: auditRows });
    assert(Number(auditInsert.count) === EXPECTED_TOTAL, `expected ${EXPECTED_TOTAL} assignment audit rows, wrote ${auditInsert.count}`);

    const months = monthKeys(fresh.candidates);
    assert(JSON.stringify(months) === JSON.stringify(['2026-07', '2026-08', '2026-09']), `unexpected affected months ${months.join(',')}`);
    for (const monthKey of months) {
      const [year, month] = monthKey.split('-').map(Number);
      await touchApproval(tx, new Date(Date.UTC(year, month - 1, 1)), null);
    }

    await tx.auditLog.create({
      data: {
        actorUserId: null,
        action: 'UPDATE',
        entityType: 'LicenseScheduleTargetedRepair',
        entityId: `${INCIDENT}-413`,
        metadata: {
          incident: INCIDENT,
          repairMode: 'OWNER_APPROVED_TARGETED_EXACT_RESTORE',
          ownerAuthorization: '2026-09-02 Targeted Repair 413 Production',
          githubRunId: process.env.GITHUB_RUN_ID || null,
          exactRestoreCount: EXPECTED_TOTAL,
          excludedExceptionCount: EXPECTED_EXCEPTION_TOTAL,
          affectedMonths: months,
          employees: fresh.summary.map((row) => ({ employeeCode: row.employeeCode, count: row.count }))
        }
      }
    });

    const verified = await tx.shiftAssignment.findMany({
      where: { id: { in: fresh.candidates.map((row) => row.id) } },
      select: { id: true, shiftTypeId: true, licenseStatus: true, licenseBlockedFromShiftTypeId: true, licenseBlockedFromRemark: true, licenseBlockedAt: true, remark: true }
    });
    assert(verified.length === EXPECTED_TOTAL, `post-update verification row count ${verified.length}`);
    const targetById = new Map(fresh.candidates.map((row) => [row.id, row.update.data]));
    for (const row of verified) {
      const target = targetById.get(row.id);
      assert(row.shiftTypeId === target.shiftTypeId, `restored shift mismatch ${row.id}`);
      assert(row.licenseStatus === 'VALID', `license status mismatch ${row.id}`);
      assert(row.licenseBlockedFromShiftTypeId === null && row.licenseBlockedFromRemark === null && row.licenseBlockedAt === null, `license block metadata not cleared ${row.id}`);
      assert(String(row.remark || '') === String(target.remark || ''), `remark restore mismatch ${row.id}`);
    }

    const untouchedExceptions = await tx.shiftAssignment.findMany({
      where: { id: { in: fresh.exceptions.map((row) => row.id) } },
      select: { id: true, shiftTypeId: true, licenseStatus: true, remark: true, licenseBlockedFromShiftTypeId: true, licenseBlockedAt: true }
    });
    assert(untouchedExceptions.length === EXPECTED_EXCEPTION_TOTAL, 'exception verification row count mismatch');
    const exceptionBefore = new Map(fresh.exceptions.map((row) => [row.id, row]));
    for (const row of untouchedExceptions) {
      const before = exceptionBefore.get(row.id);
      assert(row.shiftTypeId === before.shiftTypeId, `exception shift changed ${row.id}`);
      assert(String(row.licenseStatus || '') === String(before.licenseStatus || ''), `exception license status changed ${row.id}`);
      assert(String(row.remark || '') === String(before.remark || ''), `exception remark changed ${row.id}`);
      assert(String(row.licenseBlockedFromShiftTypeId || '') === String(before.licenseBlockedFromShiftTypeId || ''), `exception block metadata changed ${row.id}`);
      assert(String(iso(row.licenseBlockedAt) || '') === String(iso(before.licenseBlockedAt) || ''), `exception blockedAt changed ${row.id}`);
    }

    return { repaired: verified.length, excluded: untouchedExceptions.length, months, summary: fresh.summary };
  }, { maxWait: 10000, timeout: 120000 });

  const post = await loadScope(prisma);
  const remainingExactRestores = post.candidates.length;
  assert(remainingExactRestores === 0, `post-commit exact restore candidates remain: ${remainingExactRestores}`);
  assert(post.exceptions.length === EXPECTED_EXCEPTION_TOTAL, `post-commit exceptions changed: ${post.exceptions.length}`);
  assert(post.exceptions.every((row) => row.employeeCode === 'EMP029' && !row.incidentMatched), 'post-commit exception identity changed');

  console.log('LIC_HIST_TARGETED_REPAIR_BEGIN');
  console.log(JSON.stringify({
    incident: INCIDENT,
    productionDataMutationPerformed: true,
    exactAssignmentsRestored: txResult.repaired,
    excludedNonIncidentRowsUntouched: txResult.excluded,
    affectedMonthsSetPending: txResult.months,
    employeeSummary: txResult.summary,
    remainingExactRestoreCandidates: remainingExactRestores,
    result: 'SUCCESS'
  }, null, 2));
  console.log('LIC_HIST_TARGETED_REPAIR_END');
})()
  .catch((error) => {
    console.error(`LIC_HIST_TARGETED_REPAIR_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });