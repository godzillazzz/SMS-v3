'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const enabled = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-attendance-event-disposable-local'
  && target.hostname === '127.0.0.1' && target.port === '55438'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

test('attendance selfie policy migration succeeds on an exact direct second execution', { skip: !enabled }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/202610200001_attendance_selfie_policy/migration.sql'), 'utf8');
  try {
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    const [columns, constraints, indexes, defaults, policies, privileges, rls] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance_selfie_policies' ORDER BY ordinal_position`),
      prisma.$queryRawUnsafe(`SELECT conname, contype FROM pg_constraint WHERE conrelid='public.attendance_selfie_policies'::regclass ORDER BY conname`),
      prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_selfie_policies' ORDER BY indexname`),
      prisma.$queryRawUnsafe(`SELECT role::text, clock_in_required, clock_out_required FROM public.attendance_selfie_policies ORDER BY role::text`),
      prisma.$queryRawUnsafe(`SELECT role::text, clock_in_required, clock_out_required FROM public.attendance_selfie_policies ORDER BY role::text`),
      prisma.$queryRawUnsafe(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='attendance_selfie_policies' AND grantee IN ('anon','authenticated')`),
      prisma.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE oid='public.attendance_selfie_policies'::regclass`)
    ]);
    assert.deepEqual(columns.map((row) => row.column_name), ['id', 'role', 'clock_in_required', 'clock_out_required', 'created_at', 'updated_at', 'updated_by_user_id']);
    assert.deepEqual(constraints.map((row) => [row.conname, row.contype]), [
      ['attendance_selfie_policies_pkey', 'p'], ['attendance_selfie_policies_role_key', 'u'], ['attendance_selfie_policies_updated_by_user_id_fkey', 'f']
    ]);
    assert.deepEqual(indexes.map((row) => row.indexname), ['attendance_selfie_policies_pkey', 'attendance_selfie_policies_role_key', 'attendance_selfie_policies_updated_by_user_id_idx']);
    assert.deepEqual(defaults, [
      { role: 'ADMIN', clock_in_required: false, clock_out_required: false }, { role: 'MANAGER', clock_in_required: false, clock_out_required: false },
      { role: 'SUPERVISOR', clock_in_required: false, clock_out_required: false }, { role: 'VIEWER', clock_in_required: false, clock_out_required: false }
    ]);
    assert.deepEqual(policies, defaults);
    assert.deepEqual(privileges, []);
    assert.equal(rls[0].relrowsecurity, true);
  } finally { await prisma.$disconnect(); }
});
