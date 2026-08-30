"use strict";

const { PrismaClient } = require("@prisma/client");

const expectedIndexes = [
  "users_account_status_requested_at_created_at_idx",
  "attendance_device_change_requests_status_created_at_idx",
  "employee_reference_photos_status_uploaded_at_idx",
  "employee_license_documents_status_uploaded_at_idx",
  "leave_requests_status_requested_at_idx",
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'users_account_status_requested_at_created_at_idx',
          'attendance_device_change_requests_status_created_at_idx',
          'employee_reference_photos_status_uploaded_at_idx',
          'employee_license_documents_status_uploaded_at_idx',
          'leave_requests_status_requested_at_idx'
        )
    `;
    const actual = new Set(rows.map((row) => row.indexname));
    const missing = expectedIndexes.filter((name) => !actual.has(name));
    if (missing.length) {
      throw new Error(`PERF-05 indexes missing: ${missing.join(", ")}`);
    }
    console.log(`PERF05_INDEX_VERIFY=PASS count=${expectedIndexes.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
