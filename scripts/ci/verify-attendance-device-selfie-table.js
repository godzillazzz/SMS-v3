'use strict';

// Read-only verification that the attendance device selfie table exists with its indexes and FKs.
const { PrismaClient } = require('@prisma/client');

const REQUIRED_INDEXES = [
  'attendance_device_selfies_pkey',
  'attendance_device_selfies_capture_id_key',
  'attendance_device_selfies_storage_object_key_key',
  'attendance_device_selfies_employee_id_captured_at_idx',
  'attendance_device_selfies_purged_at_idx'
];
const REQUIRED_FKS = ['attendance_device_selfies_employee_id_fkey', 'attendance_device_selfies_enrollment_id_fkey'];
const FORBIDDEN_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

async function main() {
  const prisma = new PrismaClient();
  try {
    const table = await prisma.$queryRaw`
      SELECT to_regclass('public.attendance_device_selfies') IS NOT NULL AS present
    `;
    if (!table[0]?.present) throw new Error('attendance_device_selfies table missing');

    const rls = await prisma.$queryRaw`
      SELECT relrowsecurity AS enabled
      FROM pg_class
      WHERE oid = 'public.attendance_device_selfies'::regclass
    `;
    if (rls[0]?.enabled !== true) throw new Error('attendance_device_selfies RLS is not enabled');

    const roles = await prisma.$queryRaw`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    `;
    for (const role of roles.map((row) => row.rolname)) {
      for (const priv of FORBIDDEN_PRIVILEGES) {
        const privileges = await prisma.$queryRawUnsafe(
          `SELECT has_table_privilege($1, 'public.attendance_device_selfies', $2) AS allowed`,
          role,
          priv
        );
        if (privileges[0]?.allowed === true) throw new Error(`${role} has ${priv} privilege on attendance_device_selfies`);
      }
    }

    const indexes = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'attendance_device_selfies'
    `;
    const names = indexes.map((row) => row.indexname);
    for (const required of REQUIRED_INDEXES) {
      if (!names.includes(required)) throw new Error(`missing index ${required}`);
    }

    const fks = await prisma.$queryRaw`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'public.attendance_device_selfies'::regclass
    `;
    const fkNames = fks.map((row) => row.conname);
    for (const required of REQUIRED_FKS) {
      if (!fkNames.includes(required)) throw new Error(`missing foreign key ${required}`);
    }

    console.log(`PASS table attendance_device_selfies · indexes=${names.length} · fks=${fkNames.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
