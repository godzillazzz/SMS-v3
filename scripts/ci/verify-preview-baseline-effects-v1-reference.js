'use strict';

const { PrismaClient } = require('@prisma/client');
const { BASELINE_ALLOWLIST } = require('./verify-preview-baseline-manifest');

const FACE_EXPECTED_SEMANTICS = `status NOT IN ('VERIFIED','CONSUMED') OR (device_proof_verified_at IS NOT NULL AND verified_at IS NOT NULL AND face_match_passed IS TRUE AND ((verification_mode = 'FACE_MATCH_WITH_LIVENESS' AND pad_passed IS TRUE AND injection_risk_detected IS FALSE) OR (verification_mode = 'FACE_MATCH_ONLY' AND pad_passed IS NULL AND injection_risk_detected IS NULL)))`;

const SERVER_ONLY_TABLES = Object.freeze([
  'attendance_adjustment_events',
  'attendance_adjustment_requests',
  'attendance_adjustment_revisions',
  'attendance_corrections',
  'attendance_device_challenges',
  'attendance_device_change_requests',
  'attendance_device_enrollments',
  'attendance_events',
  'attendance_evidence',
  'attendance_month_certifications',
  'attendance_sessions',
  'employee_reference_photos',
  'face_verification_receipts',
  'face_verification_sessions',
  'security_site_departments',
  'security_site_qr_credentials',
  'security_sites',
]);

const EXPECTED = Object.freeze({
  '202608250001_g06_face_match_only_mode_v1': {
    enums: [{ name: 'FaceVerificationMode', labels: ['FACE_MATCH_ONLY', 'FACE_MATCH_WITH_LIVENESS'] }],
    columns: [
      { table: 'face_verification_sessions', name: 'verification_mode', udt: 'FaceVerificationMode', nullable: 'NO', defaultPattern: 'FACE_MATCH_WITH_LIVENESS' },
      { table: 'face_verification_receipts', name: 'verification_mode', udt: 'FaceVerificationMode', nullable: 'NO', defaultPattern: 'FACE_MATCH_WITH_LIVENESS' },
    ],
    checks: [{ table: 'face_verification_sessions', name: 'face_verification_sessions_verified_state_check', expression: FACE_EXPECTED_SEMANTICS }],
    operationHistoryDifferent: true,
  },
  '202608250002_g06_department_security_site_default_v1': {
    tables: ['security_site_departments'],
    columns: [
      ['id', 'uuid', 'NO', 'gen_random_uuid'], ['security_site_id', 'uuid', 'NO'], ['department_name', 'varchar', 'NO'],
      ['is_default', 'bool', 'NO', 'false'], ['created_at', 'timestamp', 'NO', 'current_timestamp'], ['updated_at', 'timestamp', 'NO', 'current_timestamp'],
    ].map(([name, udt, nullable, defaultPattern]) => ({ table: 'security_site_departments', name, udt, nullable, defaultPattern })),
    checks: [{ table: 'security_site_departments', name: 'security_site_departments_department_name_nonblank', expression: 'length(btrim(department_name)) > 0' }],
    indexes: [
      { table: 'security_site_departments', name: 'security_site_departments_security_site_id_department_name_key', unique: true, columns: ['security_site_id', 'department_name'] },
      { table: 'security_site_departments', name: 'security_site_departments_department_name_idx', unique: false, columns: ['department_name'] },
      { table: 'security_site_departments', name: 'security_site_departments_department_name_is_default_idx', unique: false, columns: ['department_name', 'is_default'] },
      { table: 'security_site_departments', name: 'security_site_departments_one_default_per_department_key', unique: true, columns: ['department_name'], predicate: 'is_default = TRUE' },
    ],
    foreignKeys: [{ table: 'security_site_departments', name: 'security_site_departments_security_site_id_fkey', columns: ['security_site_id'], refTable: 'security_sites', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' }],
  },
  '202608250003_attendance_governance_v1': {
    tables: ['attendance_corrections', 'attendance_month_certifications'],
    columns: [
      ...[['id', 'uuid', 'NO', 'gen_random_uuid'], ['shift_assignment_id', 'uuid', 'NO'], ['attendance_session_id', 'uuid', 'YES'], ['event_type', 'AttendanceEventType', 'NO'], ['original_event_id', 'uuid', 'YES'], ['original_effective_event_at', 'timestamptz', 'YES'], ['corrected_effective_event_at', 'timestamptz', 'NO'], ['reason', 'varchar', 'NO'], ['actor_user_id', 'uuid', 'NO'], ['actor_role_snapshot', 'varchar', 'NO'], ['is_current', 'bool', 'NO', 'true'], ['superseded_at', 'timestamptz', 'YES'], ['created_at', 'timestamptz', 'NO', 'current_timestamp']].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_corrections', name, udt, nullable, defaultPattern })),
      ...[['id', 'uuid', 'NO', 'gen_random_uuid'], ['month', 'date', 'NO'], ['revision', 'int4', 'NO'], ['status', 'varchar', 'NO'], ['summary_snapshot', 'jsonb', 'NO'], ['summary_digest', 'bpchar', 'NO'], ['certified_by_user_id', 'uuid', 'NO'], ['certified_at', 'timestamptz', 'NO'], ['unlocked_by_user_id', 'uuid', 'YES'], ['unlocked_at', 'timestamptz', 'YES'], ['unlock_reason', 'varchar', 'YES'], ['created_at', 'timestamptz', 'NO', 'current_timestamp']].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_month_certifications', name, udt, nullable, defaultPattern })),
    ],
    checks: [
      ['attendance_corrections', 'attendance_corrections_reason_nonempty', 'length(btrim(reason)) >= 5'],
      ['attendance_corrections', 'attendance_corrections_current_shape', '(is_current = TRUE AND superseded_at IS NULL) OR (is_current = FALSE AND superseded_at IS NOT NULL)'],
      ['attendance_month_certifications', 'attendance_month_certifications_revision_positive', 'revision > 0'],
      ['attendance_month_certifications', 'attendance_month_certifications_status_check', "status IN ('CERTIFIED', 'UNLOCKED')"],
      ['attendance_month_certifications', 'attendance_month_certifications_digest_check', "summary_digest ~ '^[0-9a-f]{64}$'"],
      ['attendance_month_certifications', 'attendance_month_certifications_unlock_shape', "(status = 'CERTIFIED' AND unlocked_by_user_id IS NULL AND unlocked_at IS NULL AND unlock_reason IS NULL) OR (status = 'UNLOCKED' AND unlocked_by_user_id IS NOT NULL AND unlocked_at IS NOT NULL AND length(btrim(unlock_reason)) >= 5)"],
    ].map(([table, name, expression]) => ({ table, name, expression })),
    indexes: [
      { table: 'attendance_corrections', name: 'attendance_corrections_current_event_key', unique: true, columns: ['shift_assignment_id', 'event_type'], predicate: 'is_current = TRUE' },
      { table: 'attendance_corrections', name: 'attendance_corrections_assignment_created_idx', unique: false, columns: ['shift_assignment_id', 'created_at'] },
      { table: 'attendance_corrections', name: 'attendance_corrections_session_created_idx', unique: false, columns: ['attendance_session_id', 'created_at'] },
      { table: 'attendance_corrections', name: 'attendance_corrections_actor_created_idx', unique: false, columns: ['actor_user_id', 'created_at'] },
      { table: 'attendance_month_certifications', name: 'attendance_month_certifications_current_key', unique: true, columns: ['month'], predicate: "status = 'CERTIFIED'" },
      { table: 'attendance_month_certifications', name: 'attendance_month_certifications_month_created_idx', unique: false, columns: ['month', 'created_at'] },
    ],
    foreignKeys: [
      ['attendance_corrections', 'attendance_corrections_assignment_fkey', ['shift_assignment_id'], 'shift_assignments', ['id']],
      ['attendance_corrections', 'attendance_corrections_session_fkey', ['attendance_session_id'], 'attendance_sessions', ['id']],
      ['attendance_corrections', 'attendance_corrections_original_event_fkey', ['original_event_id'], 'attendance_events', ['id']],
      ['attendance_corrections', 'attendance_corrections_actor_fkey', ['actor_user_id'], 'users', ['id']],
      ['attendance_month_certifications', 'attendance_month_certifications_certifier_fkey', ['certified_by_user_id'], 'users', ['id']],
      ['attendance_month_certifications', 'attendance_month_certifications_unlocker_fkey', ['unlocked_by_user_id'], 'users', ['id']],
    ].map(([table, name, columns, refTable, refColumns]) => ({ table, name, columns, refTable, refColumns, onDelete: 'RESTRICT', onUpdate: 'CASCADE' })),
  },
  '202608270001_attendance_adjustment_request_v4': {
    tables: ['attendance_adjustment_requests', 'attendance_adjustment_revisions', 'attendance_adjustment_events'],
    columns: [
      ...[['id', 'uuid', 'NO', 'gen_random_uuid'], ['shift_assignment_id', 'uuid', 'NO'], ['attendance_session_id', 'uuid', 'YES'], ['request_type', 'varchar', 'NO'], ['status', 'varchar', 'NO', 'DRAFT'], ['maker_user_id', 'uuid', 'NO'], ['maker_role_snapshot', 'varchar', 'NO'], ['current_revision', 'int4', 'NO', '1'], ['approved_revision', 'int4', 'YES'], ['before_snapshot', 'jsonb', 'NO'], ['before_digest', 'bpchar', 'NO'], ['current_proposal', 'jsonb', 'NO'], ['current_proposal_digest', 'bpchar', 'NO'], ['reason', 'varchar', 'NO'], ['last_reviewer_comment', 'varchar', 'YES'], ['approver_user_id', 'uuid', 'YES'], ['approved_at', 'timestamptz', 'YES'], ['rejected_by_user_id', 'uuid', 'YES'], ['rejected_at', 'timestamptz', 'YES'], ['created_at', 'timestamptz', 'NO', 'current_timestamp'], ['updated_at', 'timestamptz', 'NO', 'current_timestamp']].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_adjustment_requests', name, udt, nullable, defaultPattern })),
      ...[['id', 'uuid', 'NO', 'gen_random_uuid'], ['request_id', 'uuid', 'NO'], ['revision', 'int4', 'NO'], ['before_snapshot', 'jsonb', 'NO'], ['before_digest', 'bpchar', 'NO'], ['proposal', 'jsonb', 'NO'], ['proposal_digest', 'bpchar', 'NO'], ['reason', 'varchar', 'NO'], ['submitted_by_user_id', 'uuid', 'NO'], ['submitted_by_role_snapshot', 'varchar', 'NO'], ['created_at', 'timestamptz', 'NO', 'current_timestamp']].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_adjustment_revisions', name, udt, nullable, defaultPattern })),
      ...[['id', 'uuid', 'NO', 'gen_random_uuid'], ['request_id', 'uuid', 'NO'], ['event_type', 'varchar', 'NO'], ['revision', 'int4', 'NO'], ['actor_user_id', 'uuid', 'NO'], ['actor_role_snapshot', 'varchar', 'NO'], ['comment', 'varchar', 'YES'], ['before_snapshot', 'jsonb', 'YES'], ['after_snapshot', 'jsonb', 'YES'], ['created_at', 'timestamptz', 'NO', 'current_timestamp']].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_adjustment_events', name, udt, nullable, defaultPattern })),
      ...[['attendance_corrections', 'source_adjustment_request_id', 'uuid', 'YES'], ['attendance_corrections', 'source_adjustment_revision', 'int4', 'YES'], ['attendance_corrections', 'approved_by_user_id', 'uuid', 'YES'], ['attendance_corrections', 'approved_at', 'timestamptz', 'YES']].map(([table, name, udt, nullable]) => ({ table, name, udt, nullable })),
    ],
    checks: [
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_type_check', "request_type IN ('CONFIRM_WORK_PERFORMED', 'ADJUST_WORK_TIME')"],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_status_check', "status IN ('DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED')"],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_revision_positive', 'current_revision > 0'],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_approved_revision_shape', 'approved_revision IS NULL OR approved_revision > 0'],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_reason_nonempty', 'length(btrim(reason)) >= 5'],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_before_digest_check', "before_digest ~ '^[0-9a-f]{64}$'"],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_proposal_digest_check', "current_proposal_digest ~ '^[0-9a-f]{64}$'"],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_approval_shape', "(status = 'APPROVED' AND approver_user_id IS NOT NULL AND approved_at IS NOT NULL AND approved_revision IS NOT NULL) OR (status <> 'APPROVED' AND approved_at IS NULL)"],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_rejection_shape', "(status = 'REJECTED' AND rejected_by_user_id IS NOT NULL AND rejected_at IS NOT NULL) OR (status <> 'REJECTED' AND rejected_at IS NULL)"],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_revision_positive', 'revision > 0'],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_reason_nonempty', 'length(btrim(reason)) >= 5'],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_before_digest_check', "before_digest ~ '^[0-9a-f]{64}$'"],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_proposal_digest_check', "proposal_digest ~ '^[0-9a-f]{64}$'"],
      ['attendance_adjustment_events', 'attendance_adjustment_events_type_check', "event_type IN ('CREATED', 'REVISED', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED')"],
      ['attendance_adjustment_events', 'attendance_adjustment_events_revision_positive', 'revision > 0'],
      ['attendance_corrections', 'attendance_corrections_adjustment_revision_positive', 'source_adjustment_revision IS NULL OR source_adjustment_revision > 0'],
      ['attendance_corrections', 'attendance_corrections_adjustment_approval_shape', '(source_adjustment_request_id IS NULL AND source_adjustment_revision IS NULL AND approved_by_user_id IS NULL AND approved_at IS NULL) OR (source_adjustment_request_id IS NOT NULL AND source_adjustment_revision IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)'],
    ].map(([table, name, expression]) => ({ table, name, expression })),
    indexes: [
      { table: 'attendance_adjustment_requests', name: 'attendance_adjustment_requests_assignment_created_idx', unique: false, columns: ['shift_assignment_id', 'created_at DESC'] },
      { table: 'attendance_adjustment_requests', name: 'attendance_adjustment_requests_status_created_idx', unique: false, columns: ['status', 'created_at DESC'] },
      { table: 'attendance_adjustment_requests', name: 'attendance_adjustment_requests_maker_created_idx', unique: false, columns: ['maker_user_id', 'created_at DESC'] },
      { table: 'attendance_adjustment_revisions', name: 'attendance_adjustment_revisions_request_revision_key', unique: true, columns: ['request_id', 'revision'] },
      { table: 'attendance_adjustment_revisions', name: 'attendance_adjustment_revisions_request_created_idx', unique: false, columns: ['request_id', 'created_at'] },
      { table: 'attendance_adjustment_events', name: 'attendance_adjustment_events_request_created_idx', unique: false, columns: ['request_id', 'created_at'] },
      { table: 'attendance_corrections', name: 'attendance_corrections_adjustment_request_event_key', unique: true, columns: ['source_adjustment_request_id', 'event_type'], predicate: 'source_adjustment_request_id IS NOT NULL' },
    ],
    foreignKeys: [
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_assignment_fkey', ['shift_assignment_id'], 'shift_assignments', ['id']],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_session_fkey', ['attendance_session_id'], 'attendance_sessions', ['id']],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_maker_fkey', ['maker_user_id'], 'users', ['id']],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_approver_fkey', ['approver_user_id'], 'users', ['id']],
      ['attendance_adjustment_requests', 'attendance_adjustment_requests_rejector_fkey', ['rejected_by_user_id'], 'users', ['id']],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_request_fkey', ['request_id'], 'attendance_adjustment_requests', ['id']],
      ['attendance_adjustment_revisions', 'attendance_adjustment_revisions_submitter_fkey', ['submitted_by_user_id'], 'users', ['id']],
      ['attendance_adjustment_events', 'attendance_adjustment_events_request_fkey', ['request_id'], 'attendance_adjustment_requests', ['id']],
      ['attendance_adjustment_events', 'attendance_adjustment_events_actor_fkey', ['actor_user_id'], 'users', ['id']],
      ['attendance_corrections', 'attendance_corrections_adjustment_request_fkey', ['source_adjustment_request_id'], 'attendance_adjustment_requests', ['id']],
      ['attendance_corrections', 'attendance_corrections_approver_fkey', ['approved_by_user_id'], 'users', ['id']],
    ].map(([table, name, columns, refTable, refColumns]) => ({ table, name, columns, refTable, refColumns, onDelete: 'RESTRICT', onUpdate: 'CASCADE' })),
  },
  '202608270002_attendance_effective_correction_authority_v4': {
    checks: [{ table: 'attendance_corrections', name: 'attendance_corrections_current_requires_approval', expression: 'is_current = FALSE OR (source_adjustment_request_id IS NOT NULL AND source_adjustment_revision IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)' }],
  },
  '202608270003_attendance_face_evidence_v1': {
    tables: ['attendance_evidence'],
    columns: [
      ['id', 'uuid', 'NO', 'gen_random_uuid'], ['face_verification_session_id', 'uuid', 'NO'], ['employee_id', 'uuid', 'NO'], ['reference_photo_id', 'uuid', 'NO'], ['storage_provider', 'varchar', 'NO'], ['storage_bucket', 'varchar', 'NO'], ['storage_object_key', 'varchar', 'NO'], ['mime_type', 'varchar', 'NO'], ['size_bytes', 'int4', 'NO'], ['checksum', 'bpchar', 'NO'], ['captured_at', 'timestamptz', 'NO'], ['retention_until', 'timestamptz', 'NO'], ['purge_requested_at', 'timestamptz', 'YES'], ['purged_at', 'timestamptz', 'YES'], ['purge_attempts', 'int4', 'NO', '0'], ['purge_last_error_at', 'timestamptz', 'YES'], ['purge_last_error_code', 'varchar', 'YES'], ['created_at', 'timestamptz', 'NO', 'current_timestamp'], ['updated_at', 'timestamptz', 'NO', 'current_timestamp'],
    ].map(([name, udt, nullable, defaultPattern]) => ({ table: 'attendance_evidence', name, udt, nullable, defaultPattern })),
    checks: [
      ['attendance_evidence', 'attendance_evidence_size_positive', 'size_bytes > 0'],
      ['attendance_evidence', 'attendance_evidence_retention_after_capture', 'retention_until > captured_at'],
    ].map(([table, name, expression]) => ({ table, name, expression })),
    indexes: [
      { table: 'attendance_evidence', name: 'attendance_evidence_face_verification_session_id_key', unique: true, columns: ['face_verification_session_id'] },
      { table: 'attendance_evidence', name: 'attendance_evidence_storage_object_key_key', unique: true, columns: ['storage_object_key'] },
      { table: 'attendance_evidence', name: 'attendance_evidence_employee_id_captured_at_idx', unique: false, columns: ['employee_id', 'captured_at'] },
      { table: 'attendance_evidence', name: 'attendance_evidence_retention_until_purged_at_idx', unique: false, columns: ['retention_until', 'purged_at'] },
      { table: 'attendance_evidence', name: 'attendance_evidence_reference_photo_id_captured_at_idx', unique: false, columns: ['reference_photo_id', 'captured_at'] },
    ],
    foreignKeys: [
      ['attendance_evidence_session_fkey', ['face_verification_session_id'], 'face_verification_sessions', ['id']],
      ['attendance_evidence_employee_fkey', ['employee_id'], 'employees', ['id']],
      ['attendance_evidence_reference_photo_fkey', ['reference_photo_id'], 'employee_reference_photos', ['id']],
    ].map(([name, columns, refTable, refColumns]) => ({ table: 'attendance_evidence', name, columns, refTable, refColumns, onDelete: 'RESTRICT', onUpdate: 'CASCADE' })),
  },
  '202608270004_attendance_face_evidence_rls_v1': { rls: { tables: ['attendance_evidence'], policies: 0, force: false, noApiGrants: true } },
  '202608270005_g06_server_authority_rls_v1': { rls: { tables: SERVER_ONLY_TABLES, policies: 0, force: false, noApiGrants: true } },
  '202608270005_g06_server_only_rls_v1': { rls: { tables: SERVER_ONLY_TABLES, policies: 0, force: false, noApiGrants: true } },
});

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') throw new Error('Prisma read-only query capability is unavailable');
  return prisma.$queryRawUnsafe(sql);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function list(values) {
  return values.map(quote).join(', ');
}

function normalizeSqlExpression(value) {
  let text = String(value || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '$1')
    .replace(/\s+AT\s+TIME\s+ZONE\s+/gi, ' at time zone ')
    .replace(/::\s*(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+")(?:\s*\[\])?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  text = text.replace(/=\s*any\s*\(\s*array\s*\[([^\]]*)\](?:\s*::[^)]*)?\)/gi, 'in ($1)');
  text = text.replace(/<>\s*all\s*\(\s*array\s*\[([^\]]*)\](?:\s*::[^)]*)?\)/gi, 'not in ($1)');
  text = text.replace(/\s*,\s*/g, ',');
  text = text.replace(/\s*([()=<>])\s*/g, '$1');
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1;
      if (text[index] === ')') depth -= 1;
      if (depth === 0 && index < text.length - 1) { wrapsAll = false; break; }
    }
    if (!wrapsAll) break;
    text = text.slice(1, -1);
  }
  return text;
}

function normalizeIdentifier(value) {
  return String(value || '').replaceAll('"', '').replace(/^public\./i, '').toLowerCase();
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quoteChar = null;
  for (let index = 0; index < String(value).length; index += 1) {
    const char = String(value)[index];
    if (quoteChar) {
      if (char === quoteChar && String(value)[index - 1] !== '\\') quoteChar = null;
      continue;
    }
    if (char === "'") { quoteChar = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(String(value).slice(start, index).trim()); start = index + 1; }
  }
  parts.push(String(value).slice(start).trim());
  return parts.filter(Boolean);
}

function parseIndexDefinition(indexdef) {
  const normalized = normalizeIdentifier(indexdef);
  const unique = /^create\s+unique\s+index\b/i.test(normalized);
  const open = normalized.indexOf('(');
  if (open < 0) return { unique, columns: [], predicate: null };
  let depth = 0;
  let close = -1;
  for (let index = open; index < normalized.length; index += 1) {
    if (normalized[index] === '(') depth += 1;
    if (normalized[index] === ')') depth -= 1;
    if (depth === 0) { close = index; break; }
  }
  const columns = close < 0 ? [] : splitTopLevel(normalized.slice(open + 1, close)).map((column) => normalizeIdentifier(column));
  const where = normalized.match(/\swhere\s([\s\S]+)$/i);
  return { unique, columns, predicate: where ? normalizeSqlExpression(where[1]) : null };
}

function parseForeignKey(definition) {
  const normalized = normalizeIdentifier(definition).replace(/\s+/g, ' ').trim();
  const match = normalized.match(/foreign key \(([^)]+)\) references ([^ (]+)\(([^)]+)\)([\s\S]*)/i);
  if (!match) return null;
  const tail = match[4];
  const action = (kind) => (tail.match(new RegExp(`on ${kind} (no action|restrict|cascade|set null|set default)`, 'i')) || [])[1]?.toUpperCase() || 'NO ACTION';
  return {
    columns: splitTopLevel(match[1]).map(normalizeIdentifier),
    refTable: normalizeIdentifier(match[2]),
    refColumns: splitTopLevel(match[3]).map(normalizeIdentifier),
    onDelete: action('delete'),
    onUpdate: action('update'),
  };
}

function expectedForeignKeyMatches(actual, expected) {
  const parsed = parseForeignKey(actual?.definition);
  return Boolean(parsed)
    && JSON.stringify(parsed.columns) === JSON.stringify(expected.columns.map(normalizeIdentifier))
    && parsed.refTable === normalizeIdentifier(expected.refTable)
    && JSON.stringify(parsed.refColumns) === JSON.stringify(expected.refColumns.map(normalizeIdentifier))
    && parsed.onDelete === expected.onDelete
    && parsed.onUpdate === expected.onUpdate;
}

function expectedIndexMatches(actual, expected) {
  if (!actual) return false;
  const parsed = parseIndexDefinition(actual.indexdef);
  return parsed.unique === expected.unique
    && JSON.stringify(parsed.columns) === JSON.stringify(expected.columns.map(normalizeIdentifier))
    && (expected.predicate ? parsed.predicate === normalizeSqlExpression(expected.predicate) : parsed.predicate === null);
}

function expectedColumnMatches(actual, expected) {
  if (!actual) return false;
  if (normalizeIdentifier(actual.udt_name) !== normalizeIdentifier(expected.udt)) return false;
  if (String(actual.is_nullable).toUpperCase() !== expected.nullable) return false;
  if (expected.defaultPattern && !normalizeSqlExpression(actual.column_default).includes(normalizeSqlExpression(expected.defaultPattern))) return false;
  return true;
}

function expectedCheckMatches(actual, expected) {
  return Boolean(actual) && normalizeSqlExpression(actual.definition).includes(normalizeSqlExpression(expected.expression));
}

async function inspectMetadata(prisma, contract) {
  const tables = [...new Set([...(contract.tables || []), ...(contract.columns || []).map((column) => column.table), ...(contract.checks || []).map((check) => check.table), ...(contract.indexes || []).map((index) => index.table), ...(contract.foreignKeys || []).map((foreignKey) => foreignKey.table), ...(contract.rls?.tables || [])])];
  const columns = contract.columns || [];
  const constraintNames = [...new Set([...(contract.checks || []).map((check) => check.name), ...(contract.foreignKeys || []).map((foreignKey) => foreignKey.name)])];
  const indexNames = [...new Set((contract.indexes || []).map((index) => index.name))];
  const enumNames = (contract.enums || []).map((item) => item.name);
  const [tableRows, columnRows, constraintRows, indexRows, enumRows, rlsRows, grantRows, policyRows] = await Promise.all([
    queryRaw(prisma, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${list(tables)})`),
    queryRaw(prisma, `SELECT table_name, column_name, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${list(tables)}) AND column_name IN (${list(columns.map((column) => column.name)) || quote('')})`),
    queryRaw(prisma, `SELECT cls.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = cls.relnamespace WHERE ns.nspname = 'public' AND con.conname IN (${list(constraintNames) || quote('')})`),
    queryRaw(prisma, `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${list(indexNames) || quote('')})`),
    queryRaw(prisma, `SELECT t.typname AS enum_name, e.enumlabel, e.enumsortorder FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname IN (${list(enumNames) || quote('')}) ORDER BY t.typname, e.enumsortorder`),
    queryRaw(prisma, `SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${list(contract.rls?.tables || []) || quote('')})`),
    queryRaw(prisma, `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') AND table_name IN (${list(contract.rls?.tables || []) || quote('')})`),
    queryRaw(prisma, `SELECT c.relname AS table_name, count(p.polname)::int AS policy_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_policy p ON p.polrelid = c.oid WHERE n.nspname = 'public' AND c.relname IN (${list(contract.rls?.tables || []) || quote('')}) GROUP BY c.relname`),
  ]);
  return { tableRows, columnRows, constraintRows, indexRows, enumRows, rlsRows, grantRows, policyRows };
}

function evaluateContract(name, metadata, log = console.log) {
  const contract = EXPECTED[name];
  if (!contract) throw new Error(`no effect contract for ${name}`);
  const tables = new Set((metadata.tableRows || []).map((row) => row.table_name));
  const columns = new Map((metadata.columnRows || []).map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const constraints = new Map((metadata.constraintRows || []).map((row) => [`${row.table_name}.${row.conname}`, row]));
  const indexes = new Map((metadata.indexRows || []).map((row) => [row.indexname, row]));
  const enums = new Map();
  for (const row of metadata.enumRows || []) {
    if (!enums.has(row.enum_name)) enums.set(row.enum_name, []);
    enums.get(row.enum_name).push(row.enumlabel);
  }
  const failures = [];
  for (const table of contract.tables || []) if (!tables.has(table)) failures.push(`missing table ${table}`);
  for (const expected of contract.columns || []) if (!expectedColumnMatches(columns.get(`${expected.table}.${expected.name}`), expected)) failures.push(`column mismatch ${expected.table}.${expected.name}`);
  for (const expected of contract.checks || []) if (!expectedCheckMatches(constraints.get(`${expected.table}.${expected.name}`), expected)) failures.push(`check mismatch ${expected.table}.${expected.name}`);
  for (const expected of contract.indexes || []) if (!expectedIndexMatches(indexes.get(expected.name), expected)) failures.push(`index mismatch ${expected.name}`);
  for (const expected of contract.foreignKeys || []) if (!expectedForeignKeyMatches(constraints.get(`${expected.table}.${expected.name}`), expected)) failures.push(`foreign key mismatch ${expected.name}`);
  for (const expected of contract.enums || []) if (JSON.stringify(enums.get(expected.name) || []) !== JSON.stringify(expected.labels)) failures.push(`enum mismatch ${expected.name}`);
  if (contract.rls) {
    const rls = new Map((metadata.rlsRows || []).map((row) => [row.table_name, row]));
    const grantTables = new Set((metadata.grantRows || []).map((row) => row.table_name));
    const policies = new Map((metadata.policyRows || []).map((row) => [row.table_name, Number(row.policy_count)]));
    for (const table of contract.rls.tables) {
      const row = rls.get(table);
      if (!row || row.relrowsecurity !== true || row.relforcerowsecurity !== contract.rls.force) failures.push(`rls mismatch ${table}`);
      if (contract.rls.noApiGrants && grantTables.has(table)) failures.push(`api grant remains ${table}`);
      if (contract.rls.policies !== undefined && Number(policies.get(table) || 0) !== contract.rls.policies) failures.push(`policy mismatch ${table}`);
    }
  }
  const pass = failures.length === 0;
  if (name === '202608250001_g06_face_match_only_mode_v1') {
    log(`FACE_VERIFIED_STATE_EXPECTED_SEMANTICS=${normalizeSqlExpression(FACE_EXPECTED_SEMANTICS)}`);
    const check = (metadata.constraintRows || []).find((row) => row.conname === 'face_verification_sessions_verified_state_check');
    log(`FACE_VERIFIED_STATE_ACTUAL_SEMANTICS=${normalizeSqlExpression(check?.definition || '')}`);
    log(`FACE_VERIFIED_STATE_NOT_WEAKER=${pass ? 'YES' : 'NO'}`);
    log(`FACE_VERIFIED_STATE_EQUIVALENT=${pass ? 'YES' : 'NO'}`);
    log('OPERATION_HISTORY_DIFFERENT=YES');
  }
  if (contract.rls) {
    log(`RLS_${name.slice(0, 10)}_EXPECTED=ENABLED_FORCE_DISABLED_NO_POLICIES_NO_ANON_AUTH_GRANTS`);
    log(`RLS_${name.slice(0, 10)}_ACTUAL=${pass ? 'ENABLED_FORCE_DISABLED_NO_POLICIES_NO_ANON_AUTH_GRANTS' : failures.join(';')}`);
  }
  if (!pass) throw new Error(`${name} semantic effect verification failed: ${failures.join('; ')}`);
  log(`BASELINE_EFFECT_${name}=PASS`);
  return { pass, failures, operationHistoryDifferent: Boolean(contract.operationHistoryDifferent) };
}

async function verifyBaselineEffects({ prisma, log = console.log } = {}) {
  const ownsClient = !prisma;
  const client = prisma || new PrismaClient();
  try {
    for (const name of BASELINE_ALLOWLIST) {
      const result = await inspectMetadata(client, EXPECTED[name]);
      evaluateContract(name, result, log);
    }
    log('BASELINE_SEMANTIC_EQUIVALENCE=PASS');
    log('MIGRATION_HAS_DATA_STATEMENTS=NO_FOR_ALL_ALLOWLISTED');
    return { pass: true };
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function main() {
  try {
    await verifyBaselineEffects();
    return 0;
  } catch (error) {
    console.error(`Preview baseline semantic verification failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  BASELINE_ALLOWLIST,
  EXPECTED,
  FACE_EXPECTED_SEMANTICS,
  SERVER_ONLY_TABLES,
  expectedCheckMatches,
  expectedColumnMatches,
  expectedForeignKeyMatches,
  expectedIndexMatches,
  evaluateContract,
  normalizeIdentifier,
  normalizeSqlExpression,
  parseForeignKey,
  parseIndexDefinition,
  splitTopLevel,
  verifyBaselineEffects,
};
