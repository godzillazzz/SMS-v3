'use strict';

// Verifies that the multi-level attendance approval CHECK constraints are live on the target database.
// Read-only: it inspects pg_constraint definitions and never mutates data.
const { PrismaClient } = require('@prisma/client');

const REQUIRED_STATUSES = ['PENDING_APPROVAL', 'PENDING_SUPERVISOR', 'PENDING_MANAGER', 'PENDING_ADMIN'];
const REQUIRED_EVENTS = ['CREATED', 'SUBMITTED', 'REVIEWED', 'RETURNED', 'REJECTED', 'APPROVED'];

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT t.relname AS table_name, c.conname AS constraint_name, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c'
        AND n.nspname = 'public'
        AND t.relname IN ('attendance_adjustment_requests', 'attendance_adjustment_events')
    `;
    const requestRow = rows.find((row) => row.table_name === 'attendance_adjustment_requests');
    const eventRow = rows.find((row) => row.table_name === 'attendance_adjustment_events');
    if (!requestRow) throw new Error('attendance_adjustment_requests CHECK constraint not found');
    if (!eventRow) throw new Error('attendance_adjustment_events CHECK constraint not found');
    for (const status of REQUIRED_STATUSES) {
      if (!requestRow.definition.includes(`'${status}'`)) throw new Error(`status constraint missing ${status}`);
    }
    for (const event of REQUIRED_EVENTS) {
      if (!eventRow.definition.includes(`'${event}'`)) throw new Error(`event_type constraint missing ${event}`);
    }
    console.log('PASS status constraint:', requestRow.constraint_name);
    console.log('PASS event_type constraint:', eventRow.constraint_name);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
