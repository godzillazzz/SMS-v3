'use strict';

const { PrismaClient } = require('@prisma/client');

function assert(condition, message) {
  if (!condition) throw new Error(`attendance void rollback guard: ${message}`);
}

async function readVoidCounts(prisma) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const sessionRows = await tx.$queryRawUnsafe(`
      SELECT count(*)::bigint AS count
      FROM public."attendance_sessions"
      WHERE "state"::text = 'VOIDED'
    `);
    const eventColumns = await tx.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'attendance_events' AND column_name = 'state'
      ) AS present
    `);
    let eventRows = [{ count: 0n }];
    if (eventColumns[0]?.present === true) {
      eventRows = await tx.$queryRawUnsafe(`
        SELECT count(*)::bigint AS count
        FROM public."attendance_events"
        WHERE "state"::text = 'VOIDED'
      `);
    }
    return {
      attendance_sessions_voided: Number(sessionRows[0]?.count),
      attendance_events_voided: Number(eventRows[0]?.count)
    };
  });
}

function decideRollback(counts) {
  const sessions = Number(counts?.attendance_sessions_voided);
  const events = Number(counts?.attendance_events_voided);
  assert(Number.isSafeInteger(sessions) && sessions >= 0, 'session count is invalid');
  assert(Number.isSafeInteger(events) && events >= 0, 'event count is invalid');
  if (sessions !== 0 || events !== 0) return 'FIX_FORWARD_REQUIRED';
  return 'APP_ROLLBACK_ALLOWED_ZERO_VOIDED_ROWS';
}

async function main() {
  assert(process.env.ATTENDANCE_VOID_ROLLBACK_READ_ONLY === 'true', 'read-only rollback guard flag is missing');
  assert(Boolean(process.env.DATABASE_URL) && Boolean(process.env.DIRECT_URL), 'database targets are required');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    const counts = await readVoidCounts(prisma);
    const status = decideRollback(counts);
    console.log(`ATTENDANCE_VOID_SESSIONS=${counts.attendance_sessions_voided}`);
    console.log(`ATTENDANCE_VOID_EVENTS=${counts.attendance_events_voided}`);
    console.log(`ATTENDANCE_VOID_ROLLBACK_GUARD=${status}`);
    if (status !== 'APP_ROLLBACK_ALLOWED_ZERO_VOIDED_ROWS') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ATTENDANCE_VOID_ROLLBACK_GUARD=FAIL ${String(error?.message || error).replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/gi, '[redacted database URL]')}`);
    process.exitCode = 1;
  });
}

module.exports = { decideRollback, readVoidCounts };
