#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const { loadLicenseAuthorityByEmployee } = require('../../src/services/license-state.service');
const { buildLicenseScheduleReconciliation } = require('../../src/services/license-schedule-reconciliation.service');

const DOCUMENT_IDS = [
  '7a7ad447-795e-4456-9be1-e995f56b326a',
  '347ba1b3-ae4a-4b2a-a959-6cb10ac0d0ae',
  'b5fd59c8-4c1a-4990-9a76-b49fc7a2b6cc',
  'db10e5bf-73a3-4e0f-8f5a-27143c7be67d',
  '883fa790-23df-4ab0-b890-526b8a3dfa71',
  '3494e78d-bb80-4244-b585-4af89da61710',
  '5c2b4c68-54f0-4493-bc4d-70e7f3ac494f'
];

const prisma = new PrismaClient();
const isoDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;
const iso = (value) => value ? new Date(value).toISOString() : null;
const mins = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const docs = await prisma.employeeLicenseDocument.findMany({
    where: { id: { in: DOCUMENT_IDS } },
    select: {
      id: true, employeeId: true, licenseId: true, status: true, reviewedAt: true,
      proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true,
      employee: { select: { employeeCode: true, firstName: true, lastName: true, displayName: true, department: true } },
      license: { select: { licenseType: true, licenseNumber: true, issueDate: true, expiryDate: true, status: true } }
    },
    orderBy: { reviewedAt: 'asc' }
  });

  const employeeIds = [...new Set(docs.map((d) => d.employeeId).filter(Boolean))];
  const [authority, assignments, shiftTypes] = await Promise.all([
    loadLicenseAuthorityByEmployee(prisma, employeeIds),
    prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds } },
      include: { shiftType: { select: { id: true, code: true, name: true, isActive: true } } },
      orderBy: [{ employeeId: 'asc' }, { workDate: 'asc' }]
    }),
    prisma.shiftType.findMany({ select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, isActive: true } })
  ]);

  const shiftById = new Map(shiftTypes.map((s) => [s.id, s]));
  const docsByEmployee = new Map();
  for (const doc of docs) {
    const rows = docsByEmployee.get(doc.employeeId) || [];
    rows.push(doc);
    docsByEmployee.set(doc.employeeId, rows);
  }

  const results = [];
  let totalRestore = 0;
  let totalBlockedNow = 0;
  let totalExceptions = 0;

  for (const employeeId of employeeIds) {
    const employeeDocs = docsByEmployee.get(employeeId) || [];
    const employeeAssignments = assignments.filter((a) => a.employeeId === employeeId);
    const plan = buildLicenseScheduleReconciliation({
      licenses: authority.get(employeeId) || [],
      assignments: employeeAssignments,
      shiftTypes
    });
    const updateById = new Map(plan.updates.map((u) => [u.id, u]));
    const blocked = employeeAssignments.filter((a) => a.licenseBlockedFromShiftTypeId || /^License Block/i.test(String(a.remark || '')));
    totalBlockedNow += blocked.length;

    const blockedRows = blocked.map((a) => {
      const planned = updateById.get(a.id) || null;
      const original = a.licenseBlockedFromShiftTypeId ? shiftById.get(a.licenseBlockedFromShiftTypeId) : null;
      const nearestDoc = employeeDocs
        .filter((d) => d.reviewedAt && a.licenseBlockedAt)
        .map((d) => ({ id: d.id, reviewedAt: d.reviewedAt, deltaMinutes: mins(d.reviewedAt, a.licenseBlockedAt) }))
        .sort((x, y) => x.deltaMinutes - y.deltaMinutes)[0] || null;
      const likelyIncident = Boolean(nearestDoc && nearestDoc.deltaMinutes <= 3);
      const restore = planned?.kind === 'restored';
      const exception = !restore;
      if (restore) totalRestore += 1;
      if (exception) totalExceptions += 1;
      return {
        assignmentId: a.id,
        workDate: isoDate(a.workDate),
        currentShift: a.shiftType?.code || null,
        currentLicenseStatus: a.licenseStatus || null,
        blockedAt: iso(a.licenseBlockedAt),
        originalShift: original ? { id: original.id, code: original.code, name: original.name, active: original.isActive } : null,
        originalRemark: a.licenseBlockedFromRemark || null,
        plannerAction: planned?.kind || 'NO_CHANGE',
        willRestoreExactly: restore,
        likelyCausedByIncidentApproval: likelyIncident,
        nearestApprovedDocumentId: nearestDoc?.id || null,
        approvalToBlockDeltaMinutes: nearestDoc ? Number(nearestDoc.deltaMinutes.toFixed(2)) : null,
        exceptionReason: restore ? null : (!original ? 'ORIGINAL_SHIFT_METADATA_MISSING_OR_LEGACY_ONLY' : original.isActive === false ? 'ORIGINAL_SHIFT_INACTIVE' : 'LICENSE_STILL_INVALID_OR_NOT_RESTORABLE')
      };
    });

    const first = employeeDocs[0]?.employee;
    results.push({
      employeeId,
      employeeCode: first?.employeeCode || null,
      name: first?.displayName || [first?.firstName, first?.lastName].filter(Boolean).join(' '),
      department: first?.department || null,
      approvedDocuments: employeeDocs.map((d) => ({
        documentId: d.id,
        status: d.status,
        reviewedAt: iso(d.reviewedAt),
        proposedStartDate: isoDate(d.proposedStartDate),
        proposedExpiryDate: isoDate(d.proposedExpiryDate),
        proposedLicenseNumber: d.proposedLicenseNumber,
        licenseType: d.license?.licenseType || null,
        currentMasterStatus: d.license?.status || null,
        currentMasterIssueDate: isoDate(d.license?.issueDate),
        currentMasterExpiryDate: isoDate(d.license?.expiryDate)
      })),
      plannerSummary: plan.summary,
      blockedAssignmentsNow: blockedRows
    });
  }

  const missingDocuments = DOCUMENT_IDS.filter((id) => !docs.some((d) => d.id === id));
  const output = {
    mode: 'READ_ONLY_IMPACT_PREVIEW',
    databaseMutationPerformed: false,
    candidateDocumentCount: DOCUMENT_IDS.length,
    foundDocumentCount: docs.length,
    missingDocuments,
    candidateEmployeeCount: employeeIds.length,
    currentBlockedAssignmentCount: totalBlockedNow,
    exactRestoreCandidateCount: totalRestore,
    exceptionCount: totalExceptions,
    employees: results
  };
  console.log('LIC_HIST_IMPACT_PREVIEW_BEGIN');
  console.log(JSON.stringify(output, null, 2));
  console.log('LIC_HIST_IMPACT_PREVIEW_END');
})()
  .finally(async () => { await prisma.$disconnect(); });