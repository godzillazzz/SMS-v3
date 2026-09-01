'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/202608310002_cfg04_shift_type_active_state/migration.sql');
const service = read('src/services/shift.service.js');
const shiftsRoute = read('src/routes/shifts.routes.js');
const operations = read('src/routes/operations.routes.js');
const scheduleService = read('src/services/schedule.service.js');
const autoSchedule = read('src/services/auto-schedule.service.js');
const licenseReconciliation = read('src/services/license-schedule-reconciliation.service.js');
const legacyLeaveService = read('src/services/leave.service.js');

test('CFG-04 adds only additive Shift Type active state without destructive migration SQL', () => {
  assert.match(schema, /isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
  assert.match(migration, /ALTER TABLE "shift_types"\s+ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
});

test('CFG-04 Shift Type service keeps stable code identity and core invariants', () => {
  assert.match(service, /CORE_SHIFT_CODES = Object\.freeze\(\['D', 'N', 'OFF', 'AL'\]\)/);
  assert.match(service, /Shift code is immutable after creation/);
  assert.match(service, /Core shift .* cannot be deactivated/);
  assert.match(service, /Core shift .* cannot be deleted/);
  assert.match(service, /delete canonical\.code/);
  assert.match(service, /auditFields = \['code', 'name', 'startTime', 'endTime', 'hours', 'color', 'isActive'\]/);
});

test('CFG-04 uses deactivation rather than destructive delete for referenced history', () => {
  assert.match(service, /tx\.shiftAssignment\.count\(\{ where: \{ shiftTypeId: id \} \}\)/);
  assert.match(service, /tx\.attendanceSession\.count\(\{ where: \{ expectedShiftTypeId: id \} \}\)/);
  assert.match(service, /Deactivate it instead/);
  assert.match(service, /throw new HttpError\(409/);
});

test('CFG-04 read API hides inactive by default and only Admin may include inactive master rows', () => {
  assert.match(service, /where: includeInactive \? undefined : \{ isActive: true \}/);
  assert.match(shiftsRoute, /includeInactive.*req\.query\.includeInactive/);
  assert.match(shiftsRoute, /includeInactive && req\.user\.role !== 'ADMIN'/);
  assert.match(shiftsRoute, /shiftService\.list\(\{ includeInactive \}\)/);
  assert.match(operations, /includeInactive && req\.user\.role !== 'ADMIN'/);
});

test('CFG-04 create and partial update schemas do not apply create defaults during unrelated updates', () => {
  assert.match(shiftsRoute, /const shiftCreateSchema = z\.object/);
  assert.match(shiftsRoute, /confirmImpact: z\.boolean\(\)\.optional\(\)/);
  assert.match(shiftsRoute, /reason: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(1000\)\.optional\(\)/);
  assert.match(shiftsRoute, /hours: shiftFields\.hours\.default\(8\.0\)/);
  assert.match(shiftsRoute, /color: shiftFields\.color\.default\('#3B82F6'\)/);
  assert.match(shiftsRoute, /shiftUpdateSchema\.parse\(req\.body\)/);
});

test('CFG-04 blocks inactive Shift Types from new schedule assignment while preserving same historical assignment', () => {
  assert.match(scheduleService, /prisma\.shiftType\.findMany\(\{ where: \{ isActive: true \}/);
  assert.match(scheduleService, /shift\.isActive === false && \(!beforeAss \|\| beforeAss\.shiftTypeId !== ass\.shiftTypeId\)/);
  assert.match(scheduleService, /Shift type is inactive and cannot be assigned to a new schedule/);
  assert.match(operations, /if \(shiftType\.isActive === false\) throw new HttpError\(409/);
  assert.match(operations, /const changingShiftType = Boolean\(input\.shiftTypeId && input\.shiftTypeId !== before\.shiftTypeId\)/);
  assert.match(operations, /if \(changingShiftType && shiftType\.isActive === false\) throw new HttpError\(409/);
});

test('CFG-04 preserves ShiftAssignment time and hours snapshots rather than rewriting history from Shift Type edits', () => {
  const shiftModelStart = schema.indexOf('model ShiftAssignment');
  const nextModel = schema.indexOf('\nmodel ', shiftModelStart + 10);
  const block = schema.slice(shiftModelStart, nextModel > shiftModelStart ? nextModel : schema.length);
  assert.match(block, /startTime\s+String\?/);
  assert.match(block, /endTime\s+String\?/);
  assert.match(block, /hours\s+Decimal/);
  assert.doesNotMatch(service, /shiftAssignment\.(?:updateMany|update)\(/);
});

test('CFG-04 closes indirect operational paths over inactive Shift Types', () => {
  assert.match(autoSchedule, /shiftType\.findMany\(\{ where: \{ isActive: true \}/g);
  assert.match(scheduleService, /prisma\.shiftType\.findMany\(\{ where: \{ isActive: true \} \}\)/);
  assert.match(licenseReconciliation, /Active OFF shift type is required for license reconciliation/);
  assert.match(licenseReconciliation, /restore\.isActive === false/);
  assert.match(licenseReconciliation, /skippedInactiveRestore/);
  assert.match(licenseReconciliation, /isActive: true/);
  assert.match(legacyLeaveService, /leaveShift\?\.isActive === false/);
  assert.match(legacyLeaveService, /Reactivate it before approving leave through this legacy workflow/);
  assert.match(legacyLeaveService, /isActive: true/);
});

test('CFG-UX Shift deactivation is preflighted, reason-governed and audited', () => {
  assert.match(service, /async function impact\(id, client = prisma\)/);
  assert.match(service, /SHIFT_DEACTIVATION_CONFIRM_REQUIRED/);
  assert.match(service, /reason: governance\.reason, impact: impactSnapshot/);
  assert.ok(shiftsRoute.includes("router.get('/:id/impact'"));
});
