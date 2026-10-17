'use strict';

const { performance } = require('node:perf_hooks');
const { PrismaClient } = require('@prisma/client');
const { saveBatchAssignments } = require('../../src/services/schedule.service');

const prisma = new PrismaClient();
const PREFIX = 'T22BENCH-';
const MONTHS = ['2031-01', '2031-02', '2031-03'];
const EMPLOYEE_COUNT = 1000;
const ARTIFACT_PATH = process.env.T22_ARTIFACT_PATH || 't22-schedule-benchmark-result.json';

function dateFor(month, index) {
  const day = String((index % 28) + 1).padStart(2, '0');
  return `${month}-${day}`;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

async function cleanup(actorUserId = null) {
  const result = {};
  const prefixedUsers = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
    select: { id: true }
  });
  const userIds = [...new Set([actorUserId, ...prefixedUsers.map((user) => user.id)].filter(Boolean))];
  result.assignments = (await prisma.shiftAssignment.deleteMany({
    where: { employee: { employeeCode: { startsWith: PREFIX } } }
  })).count;
  result.scheduleApprovals = userIds.length ? (await prisma.scheduleApproval.deleteMany({
    where: { changedByLegacyRef: { in: userIds } }
  })).count : 0;
  result.auditLogs = userIds.length ? (await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } })).count : 0;
  result.employees = (await prisma.employee.deleteMany({
    where: { employeeCode: { startsWith: PREFIX } }
  })).count;
  result.shiftTypes = (await prisma.shiftType.deleteMany({
    where: { code: { startsWith: PREFIX } }
  })).count;
  result.departments = (await prisma.departmentMaster.deleteMany({
    where: { code: { startsWith: PREFIX } }
  })).count;
  result.users = (await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } }
  })).count;
  const remaining = {
    assignments: await prisma.shiftAssignment.count({ where: { employee: { employeeCode: { startsWith: PREFIX } } } }),
    employees: await prisma.employee.count({ where: { employeeCode: { startsWith: PREFIX } } }),
    shiftTypes: await prisma.shiftType.count({ where: { code: { startsWith: PREFIX } } }),
    departments: await prisma.departmentMaster.count({ where: { code: { startsWith: PREFIX } } }),
    users: await prisma.user.count({ where: { email: { startsWith: PREFIX.toLowerCase() } } })
  };
  result.remaining = remaining;
  result.complete = Object.values(remaining).every((count) => count === 0);
  return result;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const startedAt = new Date().toISOString();
  let cleanupResult;
  let actorUserId = null;
  try {
    await cleanup();
    const department = await prisma.departmentMaster.create({
      data: { code: `${PREFIX}DEPT`, name: `${PREFIX} Department`, normalizedName: `${PREFIX.toLowerCase()}dept` }
    });
    const shiftType = await prisma.shiftType.create({
      data: { code: `${PREFIX}OFF`, name: `${PREFIX} Off`, hours: 0, isActive: true }
    });
    const actor = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}actor@example.test`,
        passwordHash: 't22-benchmark-only-not-a-secret',
        displayName: `${PREFIX} Actor`,
        role: 'ADMIN',
        department: department.code
      }
    });
    actorUserId = actor.id;
    const employees = await prisma.employee.createManyAndReturn({
      data: Array.from({ length: EMPLOYEE_COUNT }, (_, index) => ({
        employeeCode: `${PREFIX}${String(index + 1).padStart(4, '0')}`,
        firstName: PREFIX,
        lastName: String(index + 1),
        displayName: `${PREFIX}${index + 1}`,
        department: department.code,
        jobTitle: 'Benchmark Guard',
        isActive: true,
        scheduleOrder: index + 1
      })),
      select: { id: true, displayName: true, department: true }
    });
    const assignments = (month) => employees.map((employee, index) => ({
      employeeId: employee.id,
      shiftTypeId: shiftType.id,
      workDate: dateFor(month, index),
      remark: `${PREFIX}${month}`,
      // Synthetic Admin override keeps the realistic operational path
      // (rules/conflict/audit work) runnable without seeding licence documents.
      licenseOverride: true,
      overrideReason: 'T22 benchmark synthetic admin override'
    }));
    const rounds = [];
    for (const month of MONTHS) {
      const batch = assignments(month);
      const before = await prisma.shiftAssignment.count({ where: { workDate: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(`${month}-28T00:00:00.000Z`) }, employee: { employeeCode: { startsWith: PREFIX } } } });
      if (before !== 0) throw new Error(`Benchmark month ${month} was not empty: ${before}`);
      const start = performance.now();
      const result = await saveBatchAssignments(batch, actor.id, 'ADMIN');
      const elapsedMs = performance.now() - start;
      const nextMonth = month === '2031-03' ? '2031-04' : `2031-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
      const written = await prisma.shiftAssignment.count({ where: { employee: { employeeCode: { startsWith: PREFIX } }, workDate: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(`${nextMonth}-01T00:00:00.000Z`) } } });
      rounds.push({ month, elapsedMs: Number(elapsedMs.toFixed(3)), requested: batch.length, serviceCount: result.count, written });
    }
    const durations = rounds.map((round) => round.elapsedMs);
    const summary = {
      taskId: 'SMSV3-T22-BENCH',
      measuredPath: 'saveBatchAssignments service layer -> Prisma -> PostgreSQL',
      database: 'Postgres container (DATABASE_URL)',
      rounds,
      p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
      maxMs: Number(Math.max(...durations).toFixed(3)),
      thresholdMs: 15000,
      pass: percentile(durations, 0.5) <= 15000,
      startedAt
    };
    cleanupResult = await cleanup(actorUserId);
    summary.cleanup = cleanupResult;
    require('node:fs').writeFileSync(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary));
    if (!summary.pass || !cleanupResult.complete) process.exitCode = 1;
  } finally {
    if (!cleanupResult) {
      try { cleanupResult = await cleanup(actorUserId); } catch (error) { console.error(`T22 cleanup failed: ${error.message}`); process.exitCode = 1; }
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
