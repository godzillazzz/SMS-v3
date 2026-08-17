'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const EXPECTED_MIGRATION = '202608170001_annual_leave_quota_year';
const TARGET_YEAR = 2026;
const ACTIVATION_KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const EXPECTED_UNIQUE_INDEX = 'leave_quotas_employee_id_quota_year_key';
const EXPECTED_YEAR_INDEX = 'leave_quotas_quota_year_idx';
const STATE_FILE = process.env.CUTOVER_STATE_FILE || path.join(process.cwd(), '.g031-cutover-state.json');
const EPS = 1e-9;
const FIELDS = ['sickLeave', 'personalLeave', 'vacationLeave'];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_UNAVAILABLE');

const prisma = new PrismaClient({ log: [] });
const num = (v) => typeof v === 'bigint' ? Number(v) : Number(v || 0);
const toDate = (v) => v instanceof Date ? v : new Date(v);
const year = (v) => toDate(v).getUTCFullYear();
const hashText = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const hashJson = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const blank = () => ({ sickLeave: 0, personalLeave: 0, vacationLeave: 0 });
const add = (target, field, amount) => { if (field !== 'UNSUPPORTED') target[field] += Number(amount); };
const normalizeTotals = (v) => Object.fromEntries(FIELDS.map((f) => [f, Number(Number(v[f] || 0).toFixed(2))]));

function assert(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function localMigrationNames() {
  return fs.readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function inclusiveDays(start, end) {
  const s = toDate(start), e = toDate(end);
  return Math.floor((Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())) / 86400000) + 1;
}

function fieldForLeaveType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('ป่วย') || t.includes('sick')) return 'sickLeave';
  if (t.includes('กิจ') || t.includes('personal')) return 'personalLeave';
  if (t.includes('พักร้อน') || t.includes('vacation')) return 'vacationLeave';
  return 'UNSUPPORTED';
}

function settingClass(row) {
  if (!row) return { rowExists: false, valueClass: 'MISSING', effective: 'INACTIVE' };
  if (row.value === 'true') return { rowExists: true, valueClass: 'TRUE', effective: 'ACTIVE' };
  if (row.value === 'false') return { rowExists: true, valueClass: 'FALSE', effective: 'INACTIVE' };
  return { rowExists: true, valueClass: 'MALFORMED', effective: 'INACTIVE' };
}

function allocate2026(row) {
  const sy = year(row.start_date), ey = year(row.end_date), persisted = Number(row.day_count);
  if (sy === ey) return sy === TARGET_YEAR ? persisted : 0;
  if (!Number.isInteger(persisted) || Math.abs(inclusiveDays(row.start_date, row.end_date) - persisted) > EPS) return null;
  if (sy > TARGET_YEAR || ey < TARGET_YEAR) return 0;
  const start = toDate(row.start_date), end = toDate(row.end_date);
  let count = 0;
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCFullYear() === TARGET_YEAR) count += 1;
  }
  return count;
}

async function countSnapshot(tx) {
  const row = (await tx.$queryRawUnsafe(`SELECT
    (SELECT COUNT(*) FROM leave_quotas)::bigint AS quota_count,
    (SELECT COUNT(*) FROM leave_requests)::bigint AS leave_count,
    (SELECT COUNT(*) FROM employees)::bigint AS employee_count,
    (SELECT COUNT(*) FROM users)::bigint AS user_count,
    (SELECT COUNT(*) FROM system_settings)::bigint AS setting_count,
    (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migration_count`))[0];
  return {
    leaveQuotaRows: num(row.quota_count),
    leaveRequestRows: num(row.leave_count),
    employeeRows: num(row.employee_count),
    userRows: num(row.user_count),
    systemSettingRows: num(row.setting_count),
    migrationRows: num(row.migration_count)
  };
}

async function activationState(tx) {
  const rows = await tx.$queryRawUnsafe('SELECT value FROM system_settings WHERE key = $1', ACTIVATION_KEY);
  assert(rows.length <= 1, 'ACTIVATION_KEY_NOT_UNIQUE');
  return settingClass(rows[0]);
}

async function schemaState(tx) {
  const col = await tx.$queryRawUnsafe("SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='leave_quotas' AND column_name='quota_year'");
  const indexes = await tx.$queryRawUnsafe("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='leave_quotas' AND indexname IN ($1,$2) ORDER BY indexname", EXPECTED_UNIQUE_INDEX, EXPECTED_YEAR_INDEX);
  return {
    quotaYearExists: col.length === 1,
    quotaYearNullable: col.length === 1 ? String(col[0].is_nullable).toUpperCase() === 'YES' : null,
    quotaYearDataType: col.length === 1 ? String(col[0].data_type) : null,
    uniqueIndexPresent: indexes.some((i) => String(i.indexname) === EXPECTED_UNIQUE_INDEX && /UNIQUE/i.test(String(i.indexdef))),
    yearIndexPresent: indexes.some((i) => String(i.indexname) === EXPECTED_YEAR_INDEX),
    indexesFound: indexes.map((i) => String(i.indexname))
  };
}

async function migrationState(tx) {
  const rows = await tx.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, migration_name');
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => String(r.migration_name));
  const failedOrRolled = rows.filter((r) => !r.finished_at || r.rolled_back_at).map((r) => String(r.migration_name));
  const local = localMigrationNames();
  const appliedSet = new Set(applied);
  const localSet = new Set(local);
  return {
    rows: rows.length,
    applied,
    appliedCount: applied.length,
    failedOrRolled,
    local,
    pending: local.filter((m) => !appliedSet.has(m)),
    unexpectedApplied: applied.filter((m) => !localSet.has(m)),
    expectedRecords: rows.filter((r) => String(r.migration_name) === EXPECTED_MIGRATION).length,
    expectedAppliedRecords: rows.filter((r) => String(r.migration_name) === EXPECTED_MIGRATION && r.finished_at && !r.rolled_back_at).length
  };
}

async function businessSnapshot(tx, { hasQuotaYear }) {
  const quotaAgg = (await tx.$queryRawUnsafe(`SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE employee_id IS NOT NULL)::bigint AS linked,
    COUNT(*) FILTER (WHERE employee_id IS NULL)::bigint AS unlinked,
    COUNT(*) FILTER (WHERE match_status IN ('UNMATCHED','DUPLICATE_UNMATCHED'))::bigint AS unmatched,
    COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND match_status = 'MATCHED')::bigint AS linked_authoritative,
    COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND match_status <> 'MATCHED')::bigint AS linked_non_authoritative
    ${hasQuotaYear ? ", COUNT(*) FILTER (WHERE quota_year IS NULL)::bigint AS null_year, COUNT(*) FILTER (WHERE quota_year = 2026)::bigint AS year_2026, COUNT(*) FILTER (WHERE quota_year IS NOT NULL AND quota_year <> 2026)::bigint AS other_year" : ''}
    FROM leave_quotas`))[0];
  const statusRows = await tx.$queryRawUnsafe('SELECT match_status, COUNT(*)::bigint AS count FROM leave_quotas GROUP BY match_status ORDER BY match_status');
  const linkedGroups = await tx.$queryRawUnsafe('SELECT employee_id, COUNT(*)::bigint AS count FROM leave_quotas WHERE employee_id IS NOT NULL GROUP BY employee_id');
  const linkedAuthoritative = await tx.$queryRawUnsafe(`SELECT employee_id, source_fingerprint,
    sick_leave::text AS sick_leave, personal_leave::text AS personal_leave, vacation_leave::text AS vacation_leave,
    match_status, created_at, updated_at ${hasQuotaYear ? ', quota_year' : ''}
    FROM leave_quotas WHERE employee_id IS NOT NULL AND match_status = 'MATCHED'`);
  const approved = await tx.$queryRawUnsafe("SELECT employee_id, leave_type, start_date, end_date, day_count::text AS day_count FROM leave_requests WHERE status='APPROVED'");

  let sameYear = 0, crossYear = 0, fractional = 0, mismatch = 0, fractionalCross = 0, ambiguous = 0;
  let touch2026 = 0, touch2027Plus = 0, before2026 = 0;
  const byPair = {};
  const ambiguousEmployees2026 = new Set();
  for (const row of approved) {
    const sy = year(row.start_date), ey = year(row.end_date), persisted = Number(row.day_count);
    const isFractional = !Number.isInteger(persisted);
    if (isFractional) fractional += 1;
    if (sy === ey) { sameYear += 1; continue; }
    crossYear += 1;
    if (isFractional) fractionalCross += 1;
    const pair = `${sy}->${ey}`;
    if (!byPair[pair]) byPair[pair] = { approved: 0, ambiguous: 0 };
    byPair[pair].approved += 1;
    const dayMismatch = Math.abs(inclusiveDays(row.start_date, row.end_date) - persisted) > EPS;
    const bad = isFractional || dayMismatch;
    if (bad) {
      if (dayMismatch) mismatch += 1;
      ambiguous += 1;
      byPair[pair].ambiguous += 1;
      if (sy <= TARGET_YEAR && ey >= TARGET_YEAR) { touch2026 += 1; ambiguousEmployees2026.add(String(row.employee_id)); }
      if (ey >= 2027) touch2027Plus += 1;
      if (ey < TARGET_YEAR) before2026 += 1;
    }
  }

  const quotasByEmployee = new Map();
  for (const q of linkedAuthoritative) quotasByEmployee.set(String(q.employee_id), q);
  const leavesByEmployee = new Map();
  for (const l of approved) {
    const key = String(l.employee_id);
    if (!leavesByEmployee.has(key)) leavesByEmployee.set(key, []);
    leavesByEmployee.get(key).push(l);
  }

  const diffByType = Object.fromEntries(FIELDS.map((f) => [f, { entitlement: 0, used: 0, remaining: 0 }]));
  let employeesCompared = 0, notComputable = 0, entitlementDiff = 0, usedDiff = 0, remainingDiff = 0;
  const entitlementOldTotals = blank(), usedOldTotals = blank(), remainingOldTotals = blank();
  const entitlement2026Totals = blank(), used2026Totals = blank(), remaining2026Totals = blank();

  for (const [employeeKey, q] of quotasByEmployee) {
    if (ambiguousEmployees2026.has(employeeKey)) { notComputable += 1; continue; }
    const entOld = { sickLeave: Number(q.sick_leave), personalLeave: Number(q.personal_leave), vacationLeave: Number(q.vacation_leave) };
    const ent2026 = { ...entOld };
    const usedOld = blank(), used2026 = blank();
    let employeeComputable = true;
    for (const l of leavesByEmployee.get(employeeKey) || []) {
      const field = fieldForLeaveType(l.leave_type);
      add(usedOld, field, Number(l.day_count));
      const allocation = allocate2026(l);
      if (allocation === null) { employeeComputable = false; continue; }
      add(used2026, field, allocation);
    }
    if (!employeeComputable) { notComputable += 1; continue; }
    employeesCompared += 1;
    let eDiff = false, uDiff = false, rDiff = false;
    for (const field of FIELDS) {
      entitlementOldTotals[field] += entOld[field];
      entitlement2026Totals[field] += ent2026[field];
      usedOldTotals[field] += usedOld[field];
      used2026Totals[field] += used2026[field];
      const rOld = Math.max(0, entOld[field] - usedOld[field]);
      const r2026 = Math.max(0, ent2026[field] - used2026[field]);
      remainingOldTotals[field] += rOld;
      remaining2026Totals[field] += r2026;
      if (Math.abs(entOld[field] - ent2026[field]) > EPS) { eDiff = true; diffByType[field].entitlement += 1; }
      if (Math.abs(usedOld[field] - used2026[field]) > EPS) { uDiff = true; diffByType[field].used += 1; }
      if (Math.abs(rOld - r2026) > EPS) { rDiff = true; diffByType[field].remaining += 1; }
    }
    if (eDiff) entitlementDiff += 1;
    if (uDiff) usedDiff += 1;
    if (rDiff) remainingDiff += 1;
  }

  const fingerprintRows = linkedAuthoritative.map((q) => ({
    employeeAssociation: hashText(`employee:${String(q.employee_id)}`),
    sickLeave: String(q.sick_leave),
    personalLeave: String(q.personal_leave),
    vacationLeave: String(q.vacation_leave),
    sourceFingerprint: String(q.source_fingerprint),
    matchStatus: String(q.match_status)
  })).sort((a, b) => a.employeeAssociation.localeCompare(b.employeeAssociation));

  const immutableRows = linkedAuthoritative.map((q) => ({
    employeeAssociation: hashText(`employee:${String(q.employee_id)}`),
    sourceFingerprint: String(q.source_fingerprint),
    matchStatus: String(q.match_status),
    createdAt: new Date(q.created_at).toISOString(),
    updatedAt: new Date(q.updated_at).toISOString()
  })).sort((a, b) => a.employeeAssociation.localeCompare(b.employeeAssociation));

  return {
    quota: {
      totalQuotaRows: num(quotaAgg.total),
      linkedRows: num(quotaAgg.linked),
      unlinkedRows: num(quotaAgg.unlinked),
      unmatchedRows: num(quotaAgg.unmatched),
      linkedAuthoritativeRows: num(quotaAgg.linked_authoritative),
      linkedNonAuthoritativeRows: num(quotaAgg.linked_non_authoritative),
      rowsByMatchStatus: Object.fromEntries(statusRows.map((r) => [String(r.match_status), num(r.count)])),
      employeesWithMultipleLinkedRows: linkedGroups.filter((r) => num(r.count) > 1).length,
      maximumLinkedRowsPerEmployee: linkedGroups.length ? Math.max(...linkedGroups.map((r) => num(r.count))) : 0,
      nullYearRows: hasQuotaYear ? num(quotaAgg.null_year) : null,
      year2026Rows: hasQuotaYear ? num(quotaAgg.year_2026) : null,
      otherYearRows: hasQuotaYear ? num(quotaAgg.other_year) : null,
      businessFingerprint: hashJson(fingerprintRows),
      immutableFingerprint: hashJson(immutableRows)
    },
    leaveHistory: {
      approvedLeaveRequests: approved.length,
      approvedSameYearRequests: sameYear,
      approvedCrossYearRequests: crossYear,
      fractionalApprovedRequests: fractional,
      crossYearPersistedDayCountMismatch: mismatch,
      fractionalCrossYearRequests: fractionalCross,
      ambiguousLegacyCrossYearRequests: ambiguous,
      crossYearByYearPair: byPair,
      ambiguousCrossYearTouching2026: touch2026,
      ambiguousCrossYearTouching2027OrLater: touch2027Plus,
      ambiguousCrossYearEntirelyBefore2026: before2026
    },
    parity2026: {
      employeesCompared,
      parityNotComputableEmployees: notComputable,
      employeesWithEntitlementDifference: entitlementDiff,
      employeesWithUsedDifference: usedDiff,
      employeesWithRemainingDifference: remainingDiff,
      differenceByLeaveType: diffByType,
      oldG03Totals: {
        entitlement: normalizeTotals(entitlementOldTotals),
        used: normalizeTotals(usedOldTotals),
        remaining: normalizeTotals(remainingOldTotals)
      },
      annualAware2026Totals: {
        entitlement: normalizeTotals(entitlement2026Totals),
        used: normalizeTotals(used2026Totals),
        remaining: normalizeTotals(remaining2026Totals)
      }
    }
  };
}

function assertCoreInvariants(snapshot) {
  assert(snapshot.quota.employeesWithMultipleLinkedRows === 0, 'MULTIPLE_LINKED_QUOTA_AUTHORITY');
  assert(snapshot.quota.maximumLinkedRowsPerEmployee <= 1, 'MAX_LINKED_ROWS_EXCEEDED');
  assert(snapshot.quota.linkedNonAuthoritativeRows === 0, 'LINKED_NON_AUTHORITATIVE_ROW');
  assert(snapshot.leaveHistory.ambiguousCrossYearTouching2026 === 0, 'AMBIGUOUS_CROSS_YEAR_TOUCHING_2026');
  assert(snapshot.parity2026.parityNotComputableEmployees === 0, 'PARITY_NOT_COMPUTABLE');
  assert(snapshot.parity2026.employeesWithEntitlementDifference === 0, 'ENTITLEMENT_PARITY_FAILED');
  assert(snapshot.parity2026.employeesWithUsedDifference === 0, 'USED_PARITY_FAILED');
  assert(snapshot.parity2026.employeesWithRemainingDifference === 0, 'REMAINING_PARITY_FAILED');
}

function assertTotalsEqual(a, b, code) {
  assert(JSON.stringify(a) === JSON.stringify(b), code);
}

async function readOnly(fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    assert(String(ro?.[0]?.transaction_read_only || '').toLowerCase() === 'on', 'READ_ONLY_ENFORCEMENT_FAILED');
    return fn(tx);
  }, { maxWait: 10000, timeout: 60000 });
}

async function precheck() {
  const result = await readOnly(async (tx) => {
    const counts = await countSnapshot(tx);
    const activation = await activationState(tx);
    const schema = await schemaState(tx);
    const migrations = await migrationState(tx);
    const business = await businessSnapshot(tx, { hasQuotaYear: false });

    assert(activation.effective === 'INACTIVE', 'G03_1_CUTOVER_ACTIVATION_UNSAFE');
    assert(schema.quotaYearExists === false, 'G03_1_CUTOVER_SCHEMA_NOT_PRE_G03_1');
    assert(migrations.failedOrRolled.length === 0, 'G03_1_CUTOVER_MIGRATION_HISTORY_UNSAFE');
    assert(migrations.unexpectedApplied.length === 0, 'G03_1_CUTOVER_UNEXPECTED_APPLIED_MIGRATION');
    assert(migrations.pending.length === 1 && migrations.pending[0] === EXPECTED_MIGRATION, 'G03_1_CUTOVER_UNEXPECTED_MIGRATION');
    assert(migrations.expectedRecords === 0, 'G03_1_CUTOVER_EXPECTED_MIGRATION_RECORD_ALREADY_EXISTS');
    assertCoreInvariants(business);

    return { counts, activation, schema, migrations: { appliedCount: migrations.appliedCount, pending: migrations.pending, localCount: migrations.local.length }, business };
  });

  const state = { pre: result, migrationApplied: false, classificationCommitted: false };
  writeState(state);
  console.log('CUTOVER_PRECHECK=' + JSON.stringify(result));
}

async function postMigration() {
  const state = readState();
  assert(state.pre, 'CUTOVER_STATE_PRECHECK_MISSING');
  const result = await readOnly(async (tx) => {
    const counts = await countSnapshot(tx);
    const activation = await activationState(tx);
    const schema = await schemaState(tx);
    const migrations = await migrationState(tx);
    const business = await businessSnapshot(tx, { hasQuotaYear: true });

    assert(activation.effective === 'INACTIVE', 'G03_1_POST_MIGRATION_ACTIVATION_UNSAFE');
    assert(schema.quotaYearExists && schema.quotaYearNullable, 'G03_1_SCHEMA_VERIFY_FAILED');
    assert(schema.uniqueIndexPresent && schema.yearIndexPresent, 'G03_1_SCHEMA_INDEX_VERIFY_FAILED');
    assert(migrations.failedOrRolled.length === 0, 'G03_1_POST_MIGRATION_HISTORY_UNSAFE');
    assert(migrations.pending.length === 0, 'G03_1_POST_MIGRATION_PENDING_REMAINS');
    assert(migrations.unexpectedApplied.length === 0, 'G03_1_POST_MIGRATION_UNEXPECTED_APPLIED');
    assert(migrations.expectedRecords === 1 && migrations.expectedAppliedRecords === 1, 'G03_1_MIGRATION_NOT_APPLIED_EXACTLY_ONCE');
    assert(migrations.appliedCount === state.pre.migrations.appliedCount + 1, 'G03_1_UNEXPECTED_MIGRATION_COUNT');
    assert(counts.leaveQuotaRows === state.pre.counts.leaveQuotaRows, 'LEAVE_QUOTA_ROWCOUNT_CHANGED_BY_MIGRATION');
    assert(business.quota.nullYearRows === business.quota.totalQuotaRows, 'PREEXISTING_QUOTA_YEAR_NOT_NULL_AFTER_MIGRATION');
    assert(business.quota.year2026Rows === 0 && business.quota.otherYearRows === 0, 'UNEXPECTED_YEAR_ROW_AFTER_MIGRATION');
    assert(business.quota.businessFingerprint === state.pre.business.quota.businessFingerprint, 'QUOTA_FINGERPRINT_CHANGED_BY_MIGRATION');
    assert(business.quota.immutableFingerprint === state.pre.business.quota.immutableFingerprint, 'QUOTA_IMMUTABLE_FIELDS_CHANGED_BY_MIGRATION');
    assertTotalsEqual(business.parity2026.oldG03Totals, state.pre.business.parity2026.oldG03Totals, '2026_TOTALS_CHANGED_BY_MIGRATION');
    assertCoreInvariants(business);

    return { counts, activation, schema, migrations: { appliedCount: migrations.appliedCount }, business, rowsReadyForClassification: business.quota.linkedAuthoritativeRows };
  });

  state.migrationApplied = true;
  state.postMigration = result;
  writeState(state);
  console.log('CUTOVER_POST_MIGRATION=' + JSON.stringify(result));
}

async function classify() {
  const state = readState();
  assert(state.pre && state.postMigration && state.migrationApplied, 'CUTOVER_MIGRATION_STATE_MISSING');

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const activation = await activationState(tx);
    assert(activation.effective === 'INACTIVE', 'G03_1_CLASSIFICATION_ACTIVATION_UNSAFE');

    const beforeCounts = await countSnapshot(tx);
    const beforeBusiness = await businessSnapshot(tx, { hasQuotaYear: true });
    assertCoreInvariants(beforeBusiness);
    assert(beforeBusiness.quota.businessFingerprint === state.pre.business.quota.businessFingerprint, 'G03_1_2026_VALUE_PRESERVATION_FAILED');
    assert(beforeBusiness.quota.immutableFingerprint === state.pre.business.quota.immutableFingerprint, 'G03_1_2026_IMMUTABLE_PRESERVATION_FAILED');
    assertTotalsEqual(beforeBusiness.parity2026.oldG03Totals, state.pre.business.parity2026.oldG03Totals, 'G03_1_2026_TOTAL_DRIFT_BEFORE_CLASSIFICATION');
    assert(beforeBusiness.quota.otherYearRows === 0 && beforeBusiness.quota.year2026Rows === 0, 'G03_1_CLASSIFICATION_UNEXPECTED_EXISTING_YEAR');

    const lockedRows = await tx.$queryRawUnsafe(`SELECT id, employee_id FROM leave_quotas
      WHERE employee_id IS NOT NULL AND match_status = 'MATCHED' AND quota_year IS NULL
      ORDER BY employee_id FOR UPDATE`);
    const employeeKeys = lockedRows.map((r) => String(r.employee_id));
    assert(new Set(employeeKeys).size === employeeKeys.length, 'G03_1_CLASSIFICATION_INVARIANT_CHANGED');
    const rowsReady = lockedRows.length;
    assert(rowsReady === beforeBusiness.quota.linkedAuthoritativeRows, 'G03_1_CLASSIFICATION_ROWSET_NOT_ALL_AUTHORITATIVE');

    const updated = await tx.$executeRawUnsafe(`UPDATE leave_quotas
      SET quota_year = 2026
      WHERE employee_id IS NOT NULL AND match_status = 'MATCHED' AND quota_year IS NULL`);
    assert(num(updated) === rowsReady, 'G03_1_CLASSIFICATION_ROWCOUNT_MISMATCH');

    const afterBusiness = await businessSnapshot(tx, { hasQuotaYear: true });
    const afterCounts = await countSnapshot(tx);
    const invalidNonAuthority = await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM leave_quotas
      WHERE (employee_id IS NULL OR match_status <> 'MATCHED') AND quota_year IS NOT NULL`);
    const duplicateAuthorities = await tx.$queryRawUnsafe(`SELECT employee_id, quota_year, COUNT(*)::bigint AS count FROM leave_quotas
      WHERE employee_id IS NOT NULL AND quota_year IS NOT NULL GROUP BY employee_id, quota_year HAVING COUNT(*) > 1`);

    assert(num(invalidNonAuthority[0]?.count) === 0, 'UNMATCHED_OR_UNLINKED_YEAR_MUTATED');
    assert(duplicateAuthorities.length === 0, 'DUPLICATE_EMPLOYEE_YEAR_AUTHORITY');
    assert(afterBusiness.quota.year2026Rows === rowsReady, 'CLASSIFIED_2026_COUNT_INVALID');
    assert(afterBusiness.quota.otherYearRows === 0, 'SECOND_YEAR_ROW_CREATED');
    assert(afterBusiness.quota.businessFingerprint === beforeBusiness.quota.businessFingerprint, 'G03_1_2026_VALUE_PRESERVATION_FAILED');
    assert(afterBusiness.quota.immutableFingerprint === beforeBusiness.quota.immutableFingerprint, 'G03_1_2026_IMMUTABLE_PRESERVATION_FAILED');
    assert(JSON.stringify(afterCounts) === JSON.stringify(beforeCounts), 'NON_METADATA_ROWCOUNT_CHANGED_IN_CLASSIFICATION');
    assertTotalsEqual(afterBusiness.parity2026.oldG03Totals, beforeBusiness.parity2026.oldG03Totals, 'G03_1_2026_POST_PARITY_FAILED');
    assertCoreInvariants(afterBusiness);

    return {
      activation,
      rowsReadyFor2026Classification: rowsReady,
      rowsUpdated: num(updated),
      predicate: "employee_id IS NOT NULL AND match_status='MATCHED' AND quota_year IS NULL",
      beforeCounts,
      afterCounts,
      beforeFingerprint: beforeBusiness.quota.businessFingerprint,
      afterFingerprint: afterBusiness.quota.businessFingerprint,
      immutableFingerprintPreserved: afterBusiness.quota.immutableFingerprint === beforeBusiness.quota.immutableFingerprint,
      unmatchedUnlinkedYearNonNullRows: num(invalidNonAuthority[0]?.count),
      duplicateEmployeeYearAuthorities: duplicateAuthorities.length,
      beforeBusiness,
      afterBusiness
    };
  }, { maxWait: 10000, timeout: 60000 });

  state.classificationCommitted = true;
  state.classification = result;
  writeState(state);
  console.log('CUTOVER_CLASSIFICATION=' + JSON.stringify(result));
}

async function postcheck() {
  const state = readState();
  assert(state.classificationCommitted && state.classification, 'CLASSIFICATION_NOT_COMMITTED');
  const result = await readOnly(async (tx) => {
    const counts = await countSnapshot(tx);
    const activation = await activationState(tx);
    const schema = await schemaState(tx);
    const migrations = await migrationState(tx);
    const business = await businessSnapshot(tx, { hasQuotaYear: true });
    const invalidNonAuthority = await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM leave_quotas
      WHERE (employee_id IS NULL OR match_status <> 'MATCHED') AND quota_year IS NOT NULL`);

    assert(activation.effective === 'INACTIVE', 'G03_1_POST_CUTOVER_ACTIVATION_UNSAFE');
    assert(schema.quotaYearExists && schema.quotaYearNullable && schema.uniqueIndexPresent && schema.yearIndexPresent, 'G03_1_SCHEMA_VERIFY_FAILED');
    assert(migrations.pending.length === 0 && migrations.unexpectedApplied.length === 0, 'G03_1_POST_CUTOVER_MIGRATION_STATE_INVALID');
    assert(migrations.expectedAppliedRecords === 1, 'G03_1_POST_CUTOVER_MIGRATION_RECORD_INVALID');
    assert(counts.leaveQuotaRows === state.pre.counts.leaveQuotaRows, 'LEAVE_QUOTA_ROWCOUNT_CHANGED');
    assert(counts.employeeRows === state.pre.counts.employeeRows, 'EMPLOYEE_ROWCOUNT_CHANGED_DURING_CUTOVER');
    assert(counts.userRows === state.pre.counts.userRows, 'USER_ROWCOUNT_CHANGED_DURING_CUTOVER');
    assert(counts.systemSettingRows === state.pre.counts.systemSettingRows, 'SYSTEM_SETTING_ROWCOUNT_CHANGED_DURING_CUTOVER');
    assert(business.quota.businessFingerprint === state.pre.business.quota.businessFingerprint, 'G03_1_2026_VALUE_PRESERVATION_FAILED');
    assert(business.quota.immutableFingerprint === state.pre.business.quota.immutableFingerprint, 'G03_1_2026_IMMUTABLE_PRESERVATION_FAILED');
    assert(business.quota.year2026Rows === state.classification.rowsUpdated, 'POST_CUTOVER_2026_ROWCOUNT_INVALID');
    assert(business.quota.otherYearRows === 0, 'POST_CUTOVER_SECOND_YEAR_FOUND');
    assert(num(invalidNonAuthority[0]?.count) === 0, 'POST_CUTOVER_UNMATCHED_YEAR_NOT_NULL');
    assertCoreInvariants(business);
    assertTotalsEqual(business.parity2026.oldG03Totals, state.pre.business.parity2026.oldG03Totals, 'G03_1_2026_POST_PARITY_FAILED');
    assertTotalsEqual(business.parity2026.annualAware2026Totals, state.pre.business.parity2026.annualAware2026Totals, 'G03_1_2026_ANNUAL_TOTALS_CHANGED');

    return {
      counts,
      activation,
      schema,
      migrationCount: migrations.appliedCount,
      business,
      unmatchedUnlinkedYearNonNullRows: num(invalidNonAuthority[0]?.count),
      leaveRequestCountDelta: counts.leaveRequestRows - state.pre.counts.leaveRequestRows
    };
  });

  state.post = result;
  writeState(state);
  console.log('CUTOVER_POSTCHECK=' + JSON.stringify(result));
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'precheck') return precheck();
  if (mode === 'post-migration') return postMigration();
  if (mode === 'classify') return classify();
  if (mode === 'postcheck') return postcheck();
  throw new Error('UNKNOWN_CUTOVER_MODE');
}

main()
  .catch((error) => {
    console.error('G03_1_CUTOVER_FAILED=' + String(error?.code || error?.message || 'ERROR'));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
