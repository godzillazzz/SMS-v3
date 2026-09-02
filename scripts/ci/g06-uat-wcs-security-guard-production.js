#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const audit = require('../../src/services/audit.service');
const lifecycle = require('../../src/services/employee-lifecycle.service');
const { createEmployeeMasterMutationService, MASTER_TRANSACTION_OPTIONS } = require('../../src/services/employee-master-mutation.service');
const { createOnboardingReadinessService } = require('../../src/services/onboarding-readiness.service');

const EMPLOYEE_CODE = 'UAT-ST-20260902';
const ACTOR_DISPLAY_NAME = 'Sermpong Tanos';
const TARGET_DEPARTMENT = 'WCS';
const TARGET_POSITION = 'Security Guard';
const TARGET_SITE_CODE = 'WCS';
const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');
const IDEMPOTENCY_KEY = '60060001-2026-4000-8000-000000000001';
const REASON = 'Owner-approved G06-UAT-01 Temporary UAT setup: Department WCS and Position Security Guard.';
const EXPECTED_WARNING_CODES = new Set(['FUTURE_SHIFT_ASSIGNMENTS']);

const prisma = new PrismaClient();
const fail = (message) => { throw new Error(message); };
const same = (a, b) => String(a || '') === String(b || '');
const iso = (value) => value ? new Date(value).toISOString() : null;

async function latestSeptember(client) {
  return client.scheduleApproval.findFirst({
    where: { month: SEPTEMBER },
    orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, status: true, revision: true, updatedAt: true, approvedAt: true }
  });
}

async function assertTargetMasterAuthority(client) {
  const departments = await client.departmentMaster.findMany({
    where: { name: TARGET_DEPARTMENT, isActive: true },
    select: { id: true, code: true, name: true, isActive: true }
  });
  if (departments.length !== 1) fail(`Expected exactly one active Department Master named ${TARGET_DEPARTMENT}; found ${departments.length}.`);

  const positions = await client.positionMaster.findMany({
    where: { name: TARGET_POSITION, isActive: true },
    select: { id: true, code: true, name: true, isActive: true }
  });
  if (positions.length !== 1) fail(`Expected exactly one active Position Master named ${TARGET_POSITION}; found ${positions.length}.`);

  const defaultSites = await client.$queryRawUnsafe(
    `SELECT s.id, s.code, s.name, s.is_active AS "isActive"
       FROM security_site_departments d
       JOIN security_sites s ON s.id = d.security_site_id
      WHERE d.department_master_id = $1::uuid
        AND d.is_default = TRUE
      ORDER BY d.created_at ASC`,
    departments[0].id
  );
  if (defaultSites.length !== 1) fail(`Expected exactly one WCS Default Security Site; found ${defaultSites.length}.`);
  if (defaultSites[0].isActive !== true || defaultSites[0].code !== TARGET_SITE_CODE) {
    fail(`WCS Default Security Site is not the expected active ${TARGET_SITE_CODE} authority.`);
  }
  return { department: departments[0], position: positions[0], site: defaultSites[0] };
}

(async () => {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required.');

  const employee = await prisma.employee.findUnique({
    where: { employeeCode: EMPLOYEE_CODE },
    include: {
      user: { select: { id: true, displayName: true, role: true, isActive: true, accountStatus: true, employeeId: true, department: true } },
      referencePhotos: { where: { status: 'ACTIVE' }, select: { id: true } },
      attendanceDevices: { where: { status: 'ACTIVE' }, select: { id: true, proofVerifiedAt: true } }
    }
  });
  if (!employee || employee.deletedAt) fail(`Target Employee ${EMPLOYEE_CODE} is missing or deleted.`);
  if (!employee.isActive) fail(`Target Employee ${EMPLOYEE_CODE} is not active.`);

  const alreadyTarget = employee.department === TARGET_DEPARTMENT && employee.jobTitle === TARGET_POSITION;
  const untouchedSourceState = employee.department === null && employee.jobTitle === null;
  if (!alreadyTarget && !untouchedSourceState) {
    fail(`Target Employee structure changed unexpectedly: department=${employee.department || 'null'}, position=${employee.jobTitle || 'null'}.`);
  }

  if (!employee.user || employee.user.employeeId !== employee.id || employee.user.isActive !== true || employee.user.accountStatus !== 'ACTIVE') {
    fail('Target Employee linked User authority is not the expected active exact link.');
  }
  if (employee.referencePhotos.length !== 1) fail(`Expected exactly one ACTIVE Reference Photo; found ${employee.referencePhotos.length}.`);
  if (employee.attendanceDevices.length !== 1 || !employee.attendanceDevices[0].proofVerifiedAt) fail('Expected exactly one proof-verified ACTIVE Attendance Device.');

  const actors = await prisma.user.findMany({
    where: { displayName: ACTOR_DISPLAY_NAME, role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE' },
    select: { id: true, displayName: true, role: true },
    take: 2
  });
  if (actors.length !== 1) fail(`Expected exactly one active ADMIN actor named ${ACTOR_DISPLAY_NAME}; found ${actors.length}.`);
  const actor = actors[0];

  const master = await assertTargetMasterAuthority(prisma);
  const septemberBefore = await latestSeptember(prisma);
  if (!septemberBefore || septemberBefore.status !== 'PENDING') fail(`September ScheduleApproval must remain PENDING before UAT Employee setup; got ${septemberBefore?.status || 'MISSING'}.`);

  const assignmentBefore = await prisma.shiftAssignment.findFirst({
    where: { employeeId: employee.id, workDate: { gte: new Date('2026-09-02T00:00:00.000Z') } },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, workDate: true, shiftTypeId: true, updatedAt: true, licenseStatus: true, securitySiteId: true }
  });
  if (!assignmentBefore) fail('Target Employee has no current/future Shift Assignment to preserve.');

  if (alreadyTarget) {
    const readiness = await createOnboardingReadinessService({ prisma }).getEmployeeReadiness({ employeeId: employee.id });
    console.log('G06_UAT_WCS_SECURITY_GUARD_BEGIN');
    console.log(JSON.stringify({
      mode: 'OWNER_APPROVED_PRODUCTION_EMPLOYEE_SETUP',
      databaseMutationPerformed: false,
      result: 'ALREADY_TARGET_NO_MUTATION',
      employeeCode: EMPLOYEE_CODE,
      department: employee.department,
      position: employee.jobTitle,
      siteCode: readiness.checks?.site?.code || null,
      readinessStatus: readiness.status,
      blockerCodes: (readiness.blockers || []).map((x) => x.code),
      septemberApproval: { status: septemberBefore.status, revision: septemberBefore.revision }
    }, null, 2));
    console.log('G06_UAT_WCS_SECURITY_GUARD_END');
    return;
  }

  const mutationService = createEmployeeMasterMutationService({ prismaClient: prisma, auditService: audit });
  const proposal = {
    employeeId: employee.id,
    actorUserId: actor.id,
    actorRole: 'ADMIN',
    fieldScope: 'ADMIN',
    changes: { department: TARGET_DEPARTMENT, jobTitle: TARGET_POSITION },
    effectiveMode: 'IMMEDIATE',
    reason: REASON
  };
  const preflight = await mutationService.preflight(proposal);
  const warningCodes = (preflight.warnings || []).map((item) => item.code);
  const unexpectedWarnings = warningCodes.filter((code) => !EXPECTED_WARNING_CODES.has(code));
  if (unexpectedWarnings.length) fail(`Unexpected Employee Master preflight warnings: ${unexpectedWarnings.join(', ')}`);
  if (preflight.blockingIssues?.length) fail(`Employee Master preflight blocked: ${preflight.blockingIssues.map((x) => x.code).join(', ')}`);
  if (preflight.changes?.department !== TARGET_DEPARTMENT || preflight.changes?.jobTitle !== TARGET_POSITION) fail('Preflight normalized changes do not match approved WCS + Security Guard target.');

  const result = await prisma.$transaction(async (tx) => {
    if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lifecycle.LIFECYCLE_LOCK})`;
    if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employee.id}::uuid FOR UPDATE`;

    const current = await tx.employee.findUnique({ where: { id: employee.id }, select: { department: true, jobTitle: true, updatedAt: true } });
    if (!current || current.department !== null || current.jobTitle !== null) fail('Target Employee source structure changed before atomic apply; rollback required.');

    const septemberLocked = await latestSeptember(tx);
    if (!septemberLocked || septemberLocked.id !== septemberBefore.id || septemberLocked.status !== 'PENDING' || septemberLocked.revision !== septemberBefore.revision) {
      fail('September ScheduleApproval changed before atomic apply; rollback required.');
    }

    await assertTargetMasterAuthority(tx);

    const txMutationService = createEmployeeMasterMutationService({ prismaClient: tx, auditService: audit });
    const applied = await txMutationService.applyInTransaction(tx, {
      ...proposal,
      changes: preflight.changes,
      effectiveDate: preflight.effectiveDate,
      expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt,
      expectedLifecycleSequence: preflight.latestLifecycleSequence,
      idempotencyKey: IDEMPOTENCY_KEY
    });

    if (!applied.applied || applied.lifecycleEvent?.status !== 'APPLIED') fail('Governed Employee Master mutation did not apply immediately.');

    const after = await tx.employee.findUnique({
      where: { id: employee.id },
      include: { user: { select: { id: true, employeeId: true, department: true, isActive: true, accountStatus: true } } }
    });
    if (!after || after.department !== TARGET_DEPARTMENT || after.jobTitle !== TARGET_POSITION) fail('Employee post-state does not match approved target.');
    if (!after.user || after.user.employeeId !== after.id || after.user.department !== TARGET_DEPARTMENT || !after.user.isActive || after.user.accountStatus !== 'ACTIVE') {
      fail('Linked User was not synchronized to WCS while preserving active authority.');
    }

    const assignmentAfter = await tx.shiftAssignment.findUnique({ where: { id: assignmentBefore.id }, select: { id: true, updatedAt: true, licenseStatus: true, securitySiteId: true } });
    if (!assignmentAfter || iso(assignmentAfter.updatedAt) !== iso(assignmentBefore.updatedAt) || assignmentAfter.licenseStatus !== assignmentBefore.licenseStatus || assignmentAfter.securitySiteId !== assignmentBefore.securitySiteId) {
      fail('UAT Employee setup unexpectedly changed the current Shift Assignment; rollback required.');
    }

    const septemberAfter = await latestSeptember(tx);
    if (!septemberAfter || septemberAfter.id !== septemberBefore.id || septemberAfter.status !== 'PENDING' || septemberAfter.revision !== septemberBefore.revision || iso(septemberAfter.updatedAt) !== iso(septemberBefore.updatedAt)) {
      fail('UAT Employee setup unexpectedly changed September ScheduleApproval; rollback required.');
    }

    const readiness = await createOnboardingReadinessService({ prisma: tx }).getEmployeeReadiness({ employeeId: employee.id });
    const blockerCodes = (readiness.blockers || []).map((item) => item.code).sort();
    if (!readiness.checks?.structure?.ready || readiness.checks.structure.department !== TARGET_DEPARTMENT || readiness.checks.structure.position !== TARGET_POSITION) {
      fail('Post-change readiness structure check failed; rollback required.');
    }
    if (!readiness.checks?.site?.ready || readiness.checks.site.code !== TARGET_SITE_CODE || readiness.checks.site.source !== 'DEPARTMENT_DEFAULT') {
      fail('Post-change WCS Default Site authority did not resolve; rollback required.');
    }
    if (!readiness.checks?.account?.ready || !readiness.checks?.referencePhoto?.ready || !readiness.checks?.device?.ready) {
      fail('Existing UAT account/photo/device readiness regressed; rollback required.');
    }
    if (readiness.status !== 'NOT_READY' || blockerCodes.length !== 1 || blockerCodes[0] !== 'SCHEDULE_NOT_APPROVED') {
      fail(`Unexpected post-change readiness blockers: ${blockerCodes.join(', ') || 'none'}; rollback required.`);
    }

    return {
      lifecycleEventId: applied.lifecycleEvent.id,
      lifecycleSequence: applied.lifecycleEvent.sequence,
      employeeUpdatedAt: iso(after.updatedAt),
      linkedUserDepartment: after.user.department,
      readiness,
      septemberAfter,
      assignmentAfter
    };
  }, MASTER_TRANSACTION_OPTIONS);

  console.log('G06_UAT_WCS_SECURITY_GUARD_BEGIN');
  console.log(JSON.stringify({
    mode: 'OWNER_APPROVED_PRODUCTION_EMPLOYEE_SETUP',
    databaseMutationPerformed: true,
    result: 'SUCCESS',
    actor: { id: actor.id, displayName: actor.displayName, role: actor.role },
    employee: { id: employee.id, employeeCode: EMPLOYEE_CODE, before: { department: null, position: null }, after: { department: TARGET_DEPARTMENT, position: TARGET_POSITION } },
    masterAuthority: { departmentCode: master.department.code, positionCode: master.position.code, defaultSiteCode: master.site.code, defaultSiteName: master.site.name },
    preflightWarnings: warningCodes,
    lifecycleEventId: result.lifecycleEventId,
    lifecycleSequence: result.lifecycleSequence,
    linkedUserDepartment: result.linkedUserDepartment,
    shiftAssignmentPreserved: { id: assignmentBefore.id, workDate: iso(assignmentBefore.workDate), licenseStatus: assignmentBefore.licenseStatus, securitySiteId: assignmentBefore.securitySiteId },
    readinessStatus: result.readiness.status,
    readinessChecks: result.readiness.checks,
    blockerCodes: result.readiness.blockers.map((x) => x.code),
    septemberApprovalUntouched: { id: result.septemberAfter.id, status: result.septemberAfter.status, revision: result.septemberAfter.revision, updatedAt: iso(result.septemberAfter.updatedAt) }
  }, null, 2));
  console.log('G06_UAT_WCS_SECURITY_GUARD_END');
})()
  .catch((error) => {
    console.error(`G06_UAT_WCS_SECURITY_GUARD_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });