'use strict';

// Read-only PRE/POST verification for attendance_selfie_policies.
const { PrismaClient } = require('@prisma/client');

const REQUIRED_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'];
const REQUIRED_INDEX = 'attendance_selfie_policies_updated_by_user_id_idx';
const REQUIRED_FK = 'attendance_selfie_policies_updated_by_user_id_fkey';

async function verify(prisma) {
  const result = { table: false, primaryKey: false, roleUnique: false, foreignKey: false, index: false, roles: false, rls: false };
  const table = await prisma.$queryRaw`SELECT to_regclass('public.attendance_selfie_policies') IS NOT NULL AS present`;
  result.table = table[0]?.present === true;
  if (!result.table) return result;
  const constraints = await prisma.$queryRaw`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.attendance_selfie_policies'::regclass`;
  result.primaryKey = constraints.some((row) => row.conname === 'attendance_selfie_policies_pkey' && row.contype === 'p');
  result.roleUnique = constraints.some((row) => row.conname === 'attendance_selfie_policies_role_key' && row.contype === 'u');
  result.foreignKey = constraints.some((row) => row.conname === REQUIRED_FK && row.contype === 'f');
  const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'attendance_selfie_policies'`;
  result.index = indexes.some((row) => row.indexname === REQUIRED_INDEX);
  const roles = await prisma.$queryRaw`SELECT role, clock_in_required, clock_out_required FROM public."attendance_selfie_policies" ORDER BY role`;
  result.roles = roles.length === REQUIRED_ROLES.length && REQUIRED_ROLES.every((role) => {
    const row = roles.find((candidate) => candidate.role === role);
    return row && row.clock_in_required === false && row.clock_out_required === false;
  });
  const rls = await prisma.$queryRaw`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.attendance_selfie_policies'::regclass`;
  result.rls = rls[0]?.enabled === true;
  return result;
}

function passed(result) { return Object.values(result).every(Boolean); }

async function main() {
  const prisma = new PrismaClient();
  try {
    const pre = await verify(prisma);
    console.log(JSON.stringify({ phase: 'PRE', result: pre, pass: passed(pre) }));
    const post = await verify(prisma);
    console.log(JSON.stringify({ phase: 'POST', result: post, pass: passed(post) }));
    if (!passed(post)) throw new Error('attendance_selfie_policies post-verification failed');
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(JSON.stringify({ phase: 'POST', pass: false, error: error.message })); process.exit(1); });
