'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { executeSqlStatements } = require('./sql-statement-runner');

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
    // The disposable database may already contain this additive table from
    // Prisma's setup migration. Reset only this test-owned object so the
    // first execution proves the migration's default role seeds, while the
    // second execution still proves exact idempotency.
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS public."attendance_selfie_policies"');
    await executeSqlStatements(prisma, sql);
    await executeSqlStatements(prisma, sql);
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

test('attendance selfie policy migration fails closed on every supported pre-existing schema drift shape', { skip: !enabled }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/202610200001_attendance_selfie_policy/migration.sql'), 'utf8');
  const table = 'public."attendance_selfie_policies"';
  const base = `CREATE TABLE ${table} (id uuid NOT NULL DEFAULT gen_random_uuid(), role text NOT NULL, clock_in_required boolean NOT NULL DEFAULT false, clock_out_required boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by_user_id uuid, CONSTRAINT attendance_selfie_policies_pkey PRIMARY KEY (id), CONSTRAINT attendance_selfie_policies_role_key UNIQUE (role), CONSTRAINT attendance_selfie_policies_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE); CREATE INDEX attendance_selfie_policies_updated_by_user_id_idx ON ${table}(updated_by_user_id);`;
  const cases = [
    ['wrong role type', base],
    ['nullable boolean', base.replace('clock_in_required boolean NOT NULL DEFAULT false', 'clock_in_required boolean')],
    ['missing boolean default', base.replace('clock_out_required boolean NOT NULL DEFAULT false', 'clock_out_required boolean NOT NULL')],
    ['wrong unique columns', base.replace('UNIQUE (role)', 'UNIQUE (clock_in_required, clock_out_required)')],
    ['wrong FK target/action', base.replace('REFERENCES public.users(id) ON DELETE SET NULL', 'REFERENCES public.employees(id) ON DELETE CASCADE')],
    ['missing index', base.replace(' CREATE INDEX attendance_selfie_policies_updated_by_user_id_idx ON public."attendance_selfie_policies"(updated_by_user_id);', '')],
    ['unexpected RLS state', `${base} ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`]
  ];
  try {
    for (const [label, shape] of cases) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
      await executeSqlStatements(prisma, shape);
      await assert.rejects(() => executeSqlStatements(prisma, sql), (error) => /schema drift/i.test(String(error.message)), label);
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table} CASCADE`).catch(() => {});
    await prisma.$disconnect();
  }
});
