'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
const { PrismaClient } = requireFromApp('@prisma/client');

const TARGET_YEAR = 2026;
const ACTIVATION_KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const AUTHORIZED_MIGRATION = '202608170001_annual_leave_quota_year';
const EPS = 1e-9;
const FIELDS = ['sickLeave', 'personalLeave', 'vacationLeave'];
const prisma = new PrismaClient({ log: [] });

const num = (v) => typeof v === 'bigint' ? Number(v) : Number(v || 0);
const toDate = (v) => v instanceof Date ? v : new Date(v);
const year = (v) => toDate(v).getUTCFullYear();
const hashText = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const hashJson = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const blank = () => ({ sickLeave: 0, personalLeave: 0, vacationLeave: 0 });
const normalizeTotals = (v) => Object.fromEntries(FIELDS.map((f) => [f, Number(Number(v[f] || 0).toFixed(2))]));

function fieldForLeaveType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('ป่วย') || t.includes('sick')) return 'sickLeave';
  if (t.includes('กิจ') || t.includes('personal')) return 'personalLeave';
  if (t.includes('พักร้อน') || t.includes('vacation')) return 'vacationLeave';
  return 'UNSUPPORTED';
}

function inclusiveDays(start, end) {
  const s = toDate(start), e = toDate(end);
  return Math.floor((Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())) / 86400000) + 1;
}

function allocateYear(row, targetYear) {
  const sy = year(row.start_date), ey = year(row.end_date), persisted = Number(row.day_count);
  if (sy === ey) return sy === targetYear ? persisted : 0;
  if (!Number.isInteger(persisted) || Math.abs(inclusiveDays(row.start_date, row.end_date) - persisted) > EPS) return null;
  if (sy > targetYear || ey < targetYear) return 0;
  const start = toDate(row.start_date), end = toDate(row.end_date);
  let count = 0;
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCFullYear() === targetYear) count += 1;
  }
  return count;
}

function settingClass(row) {
  if (!row) return { rowExists: false, valueClass: 'MISSING', effective: 'INACTIVE' };
  if (row.value === 'true') return { rowExists: true, valueClass: 'TRUE', effective: 'ACTIVE' };
  if (row.value === 'false') return { rowExists: true, valueClass: 'FALSE', effective: 'INACTIVE' };
  return { rowExists: true, valueClass: 'MALFORMED', effective: 'INACTIVE' };
}

function localMigrationNames() {
  return fs.readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function snapshot() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    const iso = await tx.$queryRawUnsafe('SHOW transaction_isolation');
    const transactionReadOnly = String(ro?.[0]?.transaction_read_only || '').toLowerCase();
    if (transactionReadOnly !== 'on') throw new Error('READ_ONLY_ENFORCEMENT_FAILED');

    const cols = await tx.$queryRawUnsafe("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='leave_quotas' AND column_name='quota_year'");
    const indexes = await tx.$queryRawUnsafe("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='leave_quotas' AND indexname IN ('leave_quotas_employee_id_quota_year_key','leave_quotas_quota_year_idx') ORDER BY indexname");
    const migrationRows = await tx.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    const applied = migrationRows.map((r) => String(r.migration_name));
    const local = localMigrationNames();
    const pending = local.filter((name) => !applied.includes(name));

    const activationRows = await tx.$queryRawUnsafe('SELECT value FROM system_settings WHERE key = $1', ACTIVATION_KEY);
    if (activationRows.length > 1) throw new Error('ACTIVATION_KEY_NOT_UNIQUE');
    const activation = settingClass(activationRows[0]);

    const countsRow = (await tx.$queryRawUnsafe(`SELECT
      (SELECT COUNT(*) FROM leave_quotas)::bigint AS quota_count,
      (SELECT COUNT(*) FROM leave_quotas WHERE quota_year = 2026)::bigint AS quota_2026,
      (SELECT COUNT(*) FROM leave_quotas WHERE quota_year IS NULL)::bigint AS quota_null,
      (SELECT COUNT(*) FROM leave_quotas WHERE quota_year IS NOT NULL AND quota_year <> 2026)::bigint AS quota_other,
      (SELECT COUNT(*) FROM leave_requests)::bigint AS leave_count,
      (SELECT COUNT(*) FROM employees)::bigint AS employee_count,
      (SELECT COUNT(*) FROM system_settings)::bigint AS setting_count,
      (SELECT COUNT(*) FROM shift_assignments)::bigint AS shift_count,
      (SELECT COUNT(*) FROM employee_licenses)::bigint AS license_count,
      (SELECT COUNT(*) FROM employee_license_documents)::bigint AS license_document_count,
      (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migration_count
    `))[0];

    const linkedGroups = await tx.$queryRawUnsafe('SELECT employee_id, COUNT(*)::bigint AS count FROM leave_quotas WHERE employee_id IS NOT NULL GROUP BY employee_id');
    const authorityRows = await tx.$queryRawUnsafe(`SELECT employee_id, source_fingerprint,
      sick_leave::text AS sick_leave, personal_leave::text AS personal_leave, vacation_leave::text AS vacation_leave,
      match_status, quota_year
      FROM leave_quotas WHERE employee_id IS NOT NULL AND match_status='MATCHED' ORDER BY employee_id`);
    const approved = await tx.$queryRawUnsafe("SELECT employee_id, leave_type, start_date, end_date, day_count::text AS day_count FROM leave_requests WHERE status='APPROVED'");

    const usedByEmployee = new Map();
    let ambiguousCrossYearTouching2026 = 0;
    for (const row of approved) {
      const allocation = allocateYear(row, TARGET_YEAR);
      if (allocation === null) {
        const sy = year(row.start_date), ey = year(row.end_date);
        if (sy <= TARGET_YEAR && ey >= TARGET_YEAR) ambiguousCrossYearTouching2026 += 1;
        continue;
      }
      if (allocation === 0) continue;
      const field = fieldForLeaveType(row.leave_type);
      if (field === 'UNSUPPORTED') continue;
      const key = String(row.employee_id);
      if (!usedByEmployee.has(key)) usedByEmployee.set(key, blank());
      usedByEmployee.get(key)[field] += Number(allocation);
    }

    const entitlement = blank(), used = blank(), remaining = blank();
    const fingerprintRows = [];
    let classifiedAuthorities = 0;
    let unclassifiedAuthorities = 0;
    for (const q of authorityRows) {
      if (Number(q.quota_year) === TARGET_YEAR) classifiedAuthorities += 1;
      else if (q.quota_year == null) unclassifiedAuthorities += 1;
      const employeeKey = String(q.employee_id);
      const ent = { sickLeave: Number(q.sick_leave), personalLeave: Number(q.personal_leave), vacationLeave: Number(q.vacation_leave) };
      const empUsed = usedByEmployee.get(employeeKey) || blank();
      for (const field of FIELDS) {
        entitlement[field] += ent[field];
        used[field] += empUsed[field];
        remaining[field] += Math.max(0, ent[field] - empUsed[field]);
      }
      fingerprintRows.push({
        employeeAssociation: hashText(`employee:${employeeKey}`),
        sickLeave: String(q.sick_leave),
        personalLeave: String(q.personal_leave),
        vacationLeave: String(q.vacation_leave),
        sourceFingerprint: String(q.source_fingerprint),
        matchStatus: String(q.match_status)
      });
    }
    fingerprintRows.sort((a, b) => a.employeeAssociation.localeCompare(b.employeeAssociation));

    const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');
    return {
      readOnly: {
        transactionReadOnly,
        isolation: String(iso?.[0]?.transaction_isolation || ''),
        transactionIdAssigned: txid?.[0]?.txid || null
      },
      schema: {
        quotaYearExists: cols.length === 1,
        quotaYearNullable: cols.length === 1 ? cols[0].is_nullable === 'YES' : false,
        quotaYearDataType: cols.length === 1 ? String(cols[0].data_type) : null,
        uniqueInvariantPresent: indexes.some((r) => String(r.indexname) === 'leave_quotas_employee_id_quota_year_key' && /UNIQUE INDEX/i.test(String(r.indexdef))),
        quotaYearIndexPresent: indexes.some((r) => String(r.indexname) === 'leave_quotas_quota_year_idx'),
        migrationCount: applied.length,
        authorizedMigrationApplied: applied.includes(AUTHORIZED_MIGRATION),
        localMigrationCount: local.length,
        pendingMigrations: pending
      },
      activation,
      counts: {
        leaveQuotaRows: num(countsRow.quota_count),
        quotaYear2026Rows: num(countsRow.quota_2026),
        quotaYearNullRows: num(countsRow.quota_null),
        quotaYearOtherRows: num(countsRow.quota_other),
        leaveRequestRows: num(countsRow.leave_count),
        employeeRows: num(countsRow.employee_count),
        systemSettingRows: num(countsRow.setting_count),
        shiftAssignmentRows: num(countsRow.shift_count),
        employeeLicenseRows: num(countsRow.license_count),
        employeeLicenseDocumentRows: num(countsRow.license_document_count),
        migrationRows: num(countsRow.migration_count)
      },
      authority: {
        linkedAuthoritativeRows: authorityRows.length,
        classified2026Authorities: classifiedAuthorities,
        unclassifiedAuthorities,
        employeesWithMultipleLinkedRows: linkedGroups.filter((r) => num(r.count) > 1).length,
        maximumLinkedRowsPerEmployee: linkedGroups.length ? Math.max(...linkedGroups.map((r) => num(r.count))) : 0,
        ambiguousCrossYearTouching2026
      },
      totals2026: {
        entitlement: normalizeTotals(entitlement),
        used: normalizeTotals(used),
        remaining: normalizeTotals(remaining)
      },
      businessFingerprint: hashJson(fingerprintRows)
    };
  }, { maxWait: 10000, timeout: 60000 });
}

(async () => {
  try {
    const result = await snapshot();
    console.log('STAGED_TECH_SNAPSHOT=' + JSON.stringify(result));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
})().catch((error) => {
  console.error('STAGED_TECH_SNAPSHOT_FAILED=' + (error?.code || error?.name || 'ERROR'));
  process.exitCode = 1;
});
