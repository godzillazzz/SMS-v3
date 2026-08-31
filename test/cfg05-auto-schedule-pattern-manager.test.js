'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/202608310003_cfg05_auto_schedule_pattern_master/migration.sql');
const patternService = read('src/services/auto-schedule-pattern.service.js');
const autoSchedule = read('src/services/auto-schedule.service.js');
const routes = read('src/routes/operations.routes.js');

const {
  CORE_AUTO_SCHEDULE_PATTERNS,
  normalizePatternSteps,
  listAutoSchedulePatterns,
  resolveAutoSchedulePattern,
  patternForTargetGroup,
  createAutoSchedulePatternService
} = require('../src/services/auto-schedule-pattern.service');

test('CFG-05 adds governed Auto Schedule Pattern Master with additive seed migration', () => {
  assert.match(schema, /model AutoSchedulePattern \{/);
  assert.match(schema, /steps\s+Json\s+@db\.JsonB/);
  assert.match(schema, /targetGroup\s+String\s+@default\("MANUAL"\)/);
  assert.match(migration, /CREATE TABLE "auto_schedule_patterns"/);
  assert.match(migration, /'SUPERVISOR'/);
  assert.match(migration, /'ROTATE'/);
  assert.match(migration, /'กะหัวหน้างาน'/);
  assert.match(migration, /'กะพนักงานเวียน'/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\b/i);
});

test('CFG-05 core patterns preserve current Supervisor and rotating behavior', () => {
  const supervisor = CORE_AUTO_SCHEDULE_PATTERNS.find((pattern) => pattern.code === 'SUPERVISOR');
  const rotate = CORE_AUTO_SCHEDULE_PATTERNS.find((pattern) => pattern.code === 'ROTATE');
  assert.deepEqual(supervisor.steps.map((step) => step.shiftCode), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']);
  assert.deepEqual(rotate.steps.map((step) => step.shiftCode), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF']);
  assert.equal(patternForTargetGroup(CORE_AUTO_SCHEDULE_PATTERNS, 'SUPERVISOR').code, 'SUPERVISOR');
  assert.equal(patternForTargetGroup(CORE_AUTO_SCHEDULE_PATTERNS, 'GENERAL').code, 'ROTATE');
});

test('CFG-05 pattern validation rejects AL, duplicate phases and invalid weekly length', () => {
  assert.throws(
    () => normalizePatternSteps([{ phaseCode: 'A', shiftCode: 'AL', label: 'leave' }], 'CYCLE'),
    /Invalid shift code/
  );
  assert.throws(
    () => normalizePatternSteps([
      { phaseCode: 'A', shiftCode: 'D', label: '1' },
      { phaseCode: 'A', shiftCode: 'OFF', label: '2' }
    ], 'CYCLE'),
    /Duplicate phase code/
  );
  assert.throws(
    () => normalizePatternSteps([{ phaseCode: 'MON', shiftCode: 'D', label: 'Mon' }], 'WEEKLY'),
    /exactly 7/
  );
});

test('CFG-05 service protects core identity/default routing and has no destructive delete API', () => {
  assert.match(patternService, /Pattern code is immutable after creation/);
  assert.match(patternService, /Core Auto Schedule pattern mode cannot be changed/);
  assert.match(patternService, /Auto Schedule pattern target group is protected/);
  assert.match(patternService, /Core Auto Schedule patterns cannot be deactivated/);
  assert.match(patternService, /Custom patterns are manual-select only/);
  assert.doesNotMatch(patternService, /async function delete|\.delete\(/);
  assert.doesNotMatch(routes, /router\.delete\('\/auto-schedule-patterns/);
});

test('CFG-05 routes are Admin-governed for mutation and master-driven for pattern/phase inputs', () => {
  assert.match(routes, /router\.get\('\/auto-schedule-patterns'/);
  assert.match(routes, /AUTO_SCHEDULE_PATTERN_INCLUDE_INACTIVE_ADMIN_ONLY/);
  assert.match(routes, /router\.post\('\/auto-schedule-patterns', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.put\('\/auto-schedule-patterns\/:id', authorize\('ADMIN'\)/);
  assert.match(routes, /startPhase: autoSchedulePhaseInput\.default\('AUTO'\)/);
  assert.match(routes, /patternType: z\.union\(\[z\.literal\('AUTO'\), autoSchedulePatternCodeInput\]\)/);
  assert.doesNotMatch(routes, /z\.enum\(\['AUTO', 'D1'/);
  assert.doesNotMatch(routes, /z\.enum\(\['AUTO', 'SUPERVISOR', 'ROTATE'/);
});

test('CFG-05 engine loads patterns from master once and preserves preview-before-commit governance', () => {
  assert.match(autoSchedule, /listAutoSchedulePatterns\(client, \{ includeInactive: false \}\)/);
  assert.match(autoSchedule, /patternForTargetGroup\(patterns, 'SUPERVISOR'\)/);
  assert.match(autoSchedule, /patternForTargetGroup\(patterns, 'GENERAL'\)/);
  assert.match(autoSchedule, /patternCode: pattern\.code/);
  assert.match(autoSchedule, /phaseCode: step\.phaseCode/);
  assert.match(autoSchedule, /status: 'PENDING'/);
  assert.match(autoSchedule, /entityType: 'AutoSchedule'/);
  assert.match(autoSchedule, /entityType: 'EmployeeAutoSchedule'/);
});

test('CFG-05 custom create validates active Shift Types and audits without assigning automatic target group', async () => {
  const events = [];
  const created = { id: 'p1', code: 'TEAM_A', name: 'Team A', mode: 'CYCLE', steps: [{ phaseCode: 'A1', shiftCode: 'D', label: 'Day' }], isActive: true, isSystem: false, targetGroup: 'MANUAL', sortOrder: 100 };
  const tx = {
    autoSchedulePattern: {
      findUnique: async () => null,
      create: async ({ data }) => ({ ...created, ...data })
    },
    shiftType: {
      findMany: async () => [{ code: 'D' }]
    }
  };
  const prisma = { $transaction: async (work) => work(tx) };
  const audit = { log: async (event) => { events.push(event); } };
  const service = createAutoSchedulePatternService({ prisma, audit });
  const result = await service.create({
    code: 'team_a',
    name: 'Team A',
    mode: 'CYCLE',
    steps: [{ phaseCode: 'A1', shiftCode: 'D', label: 'Day' }],
    targetGroup: 'MANUAL'
  }, 'admin-1');
  assert.equal(result.code, 'TEAM_A');
  assert.equal(result.targetGroup, 'MANUAL');
  assert.equal(events[0].entityType, 'AutoSchedulePattern');

  await assert.rejects(
    () => service.create({
      code: 'TEAM_B',
      name: 'Team B',
      mode: 'CYCLE',
      steps: [{ phaseCode: 'B1', shiftCode: 'D', label: 'Day' }],
      targetGroup: 'GENERAL'
    }, 'admin-1'),
    /manual-select only/
  );
});


test('CFG-05 Pattern Master fails closed when the Prisma delegate is unavailable', async () => {
  await assert.rejects(
    () => listAutoSchedulePatterns({}, { includeInactive: false }),
    (error) => error?.statusCode === 503 && error?.details?.code === 'AUTO_SCHEDULE_PATTERN_MASTER_UNAVAILABLE'
  );
  await assert.rejects(
    () => resolveAutoSchedulePattern({}, 'ROTATE'),
    (error) => error?.statusCode === 503 && error?.details?.code === 'AUTO_SCHEDULE_PATTERN_MASTER_UNAVAILABLE'
  );
});

test('CFG-05 core pattern identity, mode, target group, and active status are enforced at runtime', async () => {
  const core = {
    id: 'core-rotate-id',
    code: 'ROTATE',
    name: 'กะพนักงานเวียน',
    mode: 'CYCLE',
    steps: CORE_AUTO_SCHEDULE_PATTERNS.find((pattern) => pattern.code === 'ROTATE').steps.map((step) => ({ ...step })),
    isActive: true,
    isSystem: true,
    targetGroup: 'GENERAL',
    sortOrder: 20
  };
  const tx = {
    autoSchedulePattern: {
      findUnique: async () => core,
      update: async () => { throw new Error('update must not execute for protected changes'); }
    },
    shiftType: { findMany: async () => [{ code: 'D' }, { code: 'N' }, { code: 'OFF' }] }
  };
  const prisma = { $transaction: async (work) => work(tx) };
  const service = createAutoSchedulePatternService({ prisma, audit: { log: async () => {} } });

  for (const [input, code] of [
    [{ code: 'ROTATE_X' }, 'AUTO_SCHEDULE_PATTERN_CODE_IMMUTABLE'],
    [{ mode: 'WEEKLY' }, 'CORE_AUTO_SCHEDULE_PATTERN_MODE_IMMUTABLE'],
    [{ targetGroup: 'MANUAL' }, 'AUTO_SCHEDULE_PATTERN_TARGET_PROTECTED'],
    [{ isActive: false }, 'CORE_AUTO_SCHEDULE_PATTERN_ACTIVE_REQUIRED']
  ]) {
    await assert.rejects(
      () => service.update(core.id, input, 'admin-1'),
      (error) => error?.statusCode === 409 && error?.details?.code === code
    );
  }
});

test('CFG-05 custom pattern update records before/after audit evidence', async () => {
  const events = [];
  const before = {
    id: 'custom-1',
    code: 'TEAM_A',
    name: 'Team A',
    mode: 'CYCLE',
    steps: [{ phaseCode: 'A1', shiftCode: 'D', label: 'Day' }],
    isActive: true,
    isSystem: false,
    targetGroup: 'MANUAL',
    sortOrder: 100
  };
  const tx = {
    autoSchedulePattern: {
      findUnique: async () => before,
      update: async ({ data }) => ({ ...before, ...data })
    },
    shiftType: { findMany: async () => [{ code: 'D' }] }
  };
  const prisma = { $transaction: async (work) => work(tx) };
  const audit = { log: async (event) => { events.push(event); } };
  const service = createAutoSchedulePatternService({ prisma, audit });

  const updated = await service.update(before.id, { name: 'Team A Revised', sortOrder: 90 }, 'admin-1');
  assert.equal(updated.name, 'Team A Revised');
  assert.equal(updated.sortOrder, 90);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'UPDATE');
  assert.equal(events[0].entityType, 'AutoSchedulePattern');
  assert.equal(events[0].entityId, before.id);
  assert.equal(events[0].metadata.before.name, 'Team A');
  assert.equal(events[0].metadata.after.name, 'Team A Revised');
});
