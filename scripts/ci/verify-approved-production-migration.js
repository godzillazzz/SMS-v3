'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED = Object.freeze({
  schemaVersion: 1,
  manifestState: 'APPROVED_FOR_OWNER_PRODUCTION_MIGRATION_DECISION',
  targetEnvironment: 'production',
  targetProjectName: 'sms-v3-staging',
  targetProjectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  targetOrgId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  canonicalUrl: 'https://sms-v3-staging-ten.vercel.app',
  ownerAction: 'APPROVE_PRODUCTION_MIGRATION_ONLY'
});

const MIGRATIONS = Object.freeze({
  'CFG-03': Object.freeze({
    migrationName: '202608310001_cfg03_leave_type_master',
    migrationPolicy: 'ADDITIVE_SCHEMA_WITH_CONTROLLED_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg03-production-migration.js',
    dataBackfill: true,
    schemaChanged: true
  }),
  'CFG-04': Object.freeze({
    migrationName: '202608310002_cfg04_shift_type_active_state',
    migrationPolicy: 'ADDITIVE_SCHEMA_ONLY_NO_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg04-production-migration.js',
    dataBackfill: false,
    schemaChanged: true
  }),
  'CFG-05': Object.freeze({
    migrationName: '202608310003_cfg05_auto_schedule_pattern_master',
    migrationPolicy: 'ADDITIVE_SCHEMA_WITH_GOVERNED_SEED_NO_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg05-production-migration.js',
    dataBackfill: false,
    schemaChanged: true
  }),
  'CFG-06': Object.freeze({
    migrationName: '202608310004_cfg06_approval_authority_policy',
    migrationPolicy: 'GOVERNED_SYSTEM_SETTING_SEED_ONLY_NO_SCHEMA_CHANGE',
    postVerifyScript: 'scripts/ci/verify-cfg06-production-migration.js',
    dataBackfill: false,
    schemaChanged: false
  }),
  'CFG-07': Object.freeze({
    migrationName: '202608310005_cfg07_data_retention_center',
    migrationPolicy: 'ADDITIVE_RETENTION_GOVERNANCE_SCHEMA_WITH_GOVERNED_SEEDS_NO_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg07-production-migration.js',
    dataBackfill: false,
    schemaChanged: true
  }),
  'MDG-01B': Object.freeze({
    migrationName: '202609010002_mdg_master_codes_department_site_authority',
    migrationPolicy: 'ADDITIVE_MASTER_CODES_AND_DEPARTMENT_SITE_AUTHORITY_WITH_FAIL_CLOSED_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-mdg-01b-production-migration.js',
    dataBackfill: true,
    schemaChanged: true
  }),
  'EMP-UX-01': Object.freeze({
    migrationName: '202609010001_emp_ux_department_position_master',
    migrationPolicy: 'ADDITIVE_MASTER_SCHEMA_WITH_CONTROLLED_BOOTSTRAP_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-emp-ux-production-migration.js',
    dataBackfill: true,
    schemaChanged: true
  })
});

const SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const MIGRATION_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_SCRIPT = /^scripts\/ci\/verify-[a-z0-9-]+-production-migration\.js$/;

function assert(condition, message) {
  if (!condition) throw new Error(`production migration guard: ${message}`);
}

function splitStatements(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function rejectDestructiveSql(sql) {
  assert(!/\bDROP\b/i.test(sql), 'DROP is forbidden');
  assert(!/\bDELETE\s+FROM\b/i.test(sql), 'DELETE is forbidden');
  assert(!/\bTRUNCATE\b/i.test(sql), 'TRUNCATE is forbidden');
}

function validateCfg03Sql(sql) {
  rejectDestructiveSql(sql);
  const statements = splitStatements(sql);
  assert(statements.length >= 8, 'unexpectedly small migration');
  let updateCount = 0;

  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE "leave_type_master"/i.test(normalized)) continue;
    if (/^CREATE (?:UNIQUE )?INDEX /i.test(normalized)) {
      assert(/ ON "(?:leave_type_master|leave_requests)"/i.test(normalized), 'index targets unexpected table');
      continue;
    }
    if (/^ALTER TABLE "leave_requests"/i.test(normalized)) {
      assert(!/\bDROP\b/i.test(normalized), 'ALTER DROP is forbidden');
      assert(/\bADD (?:COLUMN|CONSTRAINT)\b/i.test(normalized), 'only ADD COLUMN/CONSTRAINT is allowed');
      continue;
    }
    if (/^INSERT INTO "leave_type_master"/i.test(normalized)) continue;
    if (/^UPDATE "leave_requests"(?: AS [A-Za-z_][A-Za-z0-9_]*)?/i.test(normalized)) {
      updateCount += 1;
      assert(/\bWHERE\b/i.test(normalized), 'controlled backfill UPDATE requires WHERE');
      continue;
    }
    throw new Error(`production migration guard: unsupported SQL statement: ${normalized.slice(0, 80)}`);
  }

  assert(updateCount === 2, 'CFG-03 requires exactly two controlled leave_requests backfill UPDATE statements');
  assert(/\('SICK',\s*'ลาป่วย',\s*'SICK'/i.test(sql), 'SICK Thai core seed missing');
  assert(/\('PERSONAL',\s*'ลากิจ',\s*'PERSONAL'/i.test(sql), 'PERSONAL Thai core seed missing');
  assert(/\('VACATION',\s*'ลาพักร้อน',\s*'VACATION'/i.test(sql), 'VACATION Thai core seed missing');
  for (const column of ['leave_type_id', 'leave_type_name_snapshot', 'leave_quota_bucket_snapshot']) {
    assert(new RegExp(`"${column}"`, 'i').test(sql), `missing ${column}`);
  }
  assert(/leave_requests_leave_type_id_fkey/i.test(sql), 'leave type FK missing');
  assert(/leave_requests_leave_type_id_idx/i.test(sql), 'leave type index missing');
  return { statementCount: statements.length, controlledUpdateCount: updateCount };
}

function validateCfg04Sql(sql) {
  rejectDestructiveSql(sql);
  assert(!/\bUPDATE\b/i.test(sql), 'CFG-04 UPDATE is forbidden');
  assert(!/\bINSERT\b/i.test(sql), 'CFG-04 INSERT is forbidden');
  const statements = splitStatements(sql);
  assert(statements.length === 1, 'CFG-04 requires exactly one schema statement');
  const normalized = statements[0].replace(/\s+/g, ' ').trim();
  assert(
    /^ALTER TABLE "shift_types" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true$/i.test(normalized),
    'CFG-04 migration must only add shift_types.is_active BOOLEAN NOT NULL DEFAULT true'
  );
  return { statementCount: 1, controlledUpdateCount: 0 };
}

function validateCfg05Sql(sql) {
  rejectDestructiveSql(sql);
  assert(!/\bUPDATE\b/i.test(sql), 'CFG-05 UPDATE is forbidden');
  assert(!/\bALTER\s+TABLE\b/i.test(sql), 'CFG-05 ALTER TABLE is forbidden');
  const statements = splitStatements(sql);
  assert(statements.length === 5, 'CFG-05 requires exactly five create/index/seed statements');

  let tableCount = 0;
  let indexCount = 0;
  let insertCount = 0;
  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE "auto_schedule_patterns"/i.test(normalized)) {
      tableCount += 1;
      for (const column of ['id', 'code', 'name', 'mode', 'steps', 'is_active', 'is_system', 'target_group', 'sort_order', 'created_at', 'updated_at']) {
        assert(new RegExp(`"${column}"`, 'i').test(normalized), `CFG-05 missing ${column}`);
      }
      assert(/"steps" JSONB NOT NULL/i.test(normalized), 'CFG-05 steps must be JSONB NOT NULL');
      assert(/"is_active" BOOLEAN NOT NULL DEFAULT true/i.test(normalized), 'CFG-05 is_active invariant mismatch');
      assert(/"is_system" BOOLEAN NOT NULL DEFAULT false/i.test(normalized), 'CFG-05 is_system invariant mismatch');
      continue;
    }
    if (/^CREATE (?:UNIQUE )?INDEX /i.test(normalized)) {
      indexCount += 1;
      assert(/ ON "auto_schedule_patterns"/i.test(normalized), 'CFG-05 index targets unexpected table');
      continue;
    }
    if (/^INSERT INTO "auto_schedule_patterns"/i.test(normalized)) {
      insertCount += 1;
      assert(/'SUPERVISOR'/i.test(normalized), 'CFG-05 SUPERVISOR seed missing');
      assert(/'ROTATE'/i.test(normalized), 'CFG-05 ROTATE seed missing');
      assert(/'WEEKLY'/i.test(normalized), 'CFG-05 WEEKLY mode missing');
      assert(/'CYCLE'/i.test(normalized), 'CFG-05 CYCLE mode missing');
      assert(/'GENERAL'/i.test(normalized), 'CFG-05 GENERAL target missing');
      assert(/::jsonb/i.test(normalized), 'CFG-05 steps must seed JSONB');
      assert(!/"shiftCode":"AL"/i.test(normalized), 'CFG-05 core seed must not embed AL');
      continue;
    }
    throw new Error(`production migration guard: unsupported CFG-05 SQL statement: ${normalized.slice(0, 80)}`);
  }

  assert(tableCount === 1, 'CFG-05 requires one table create');
  assert(indexCount === 3, 'CFG-05 requires exactly three explicit indexes');
  assert(insertCount === 1, 'CFG-05 requires one governed core seed insert');
  return { statementCount: statements.length, controlledUpdateCount: 0 };
}

function validateCfg06Sql(sql) {
  rejectDestructiveSql(sql);
  assert(!/\bUPDATE\b/i.test(sql), 'CFG-06 UPDATE is forbidden');
  assert(!/\bALTER\s+TABLE\b/i.test(sql), 'CFG-06 ALTER TABLE is forbidden');
  const statements = splitStatements(sql);
  assert(statements.length === 1, 'CFG-06 requires exactly one governed seed statement');
  const normalized = statements[0].replace(/\s+/g, ' ').trim();
  assert(/^INSERT INTO "system_settings"/i.test(normalized), 'CFG-06 must seed system_settings only');
  assert(/ON CONFLICT \("key"\) DO NOTHING$/i.test(normalized), 'CFG-06 requires ON CONFLICT ("key") DO NOTHING');

  const requestTypes = [
    'EMPLOYEE_MASTER_CHANGE',
    'EMPLOYEE_REFERENCE_PHOTO',
    'LICENSE_DOCUMENT',
    'ATTENDANCE_DEVICE_REQUEST',
    'ATTENDANCE_ADJUSTMENT_REQUEST',
    'REGISTRATION_REQUEST',
    'USER_ACCESS',
    'LEAVE_REQUEST'
  ];
  const adminOnly = new Set([
    'EMPLOYEE_MASTER_CHANGE',
    'EMPLOYEE_REFERENCE_PHOTO',
    'LICENSE_DOCUMENT',
    'ATTENDANCE_DEVICE_REQUEST',
    'ATTENDANCE_ADJUSTMENT_REQUEST'
  ]);
  for (const type of requestTypes) {
    for (const suffix of ['REVIEWER_ROLES', 'DUE_SOON_HOURS', 'OVERDUE_HOURS']) {
      assert(new RegExp(`APPROVAL_POLICY\\.${type}\\.${suffix}`, 'i').test(sql), `CFG-06 missing ${type} ${suffix}`);
    }
    const expectedRoles = adminOnly.has(type) ? '\\["ADMIN"\\]' : '\\["ADMIN","MANAGER"\\]';
    assert(new RegExp(`APPROVAL_POLICY\\.${type}\\.REVIEWER_ROLES'\\s*,\\s*'${expectedRoles}`, 'i').test(sql), `CFG-06 reviewer roles mismatch for ${type}`);
    assert(new RegExp(`APPROVAL_POLICY\\.${type}\\.DUE_SOON_HOURS'\\s*,\\s*'24'`, 'i').test(sql), `CFG-06 due-soon default mismatch for ${type}`);
    assert(new RegExp(`APPROVAL_POLICY\\.${type}\\.OVERDUE_HOURS'\\s*,\\s*'48'`, 'i').test(sql), `CFG-06 overdue default mismatch for ${type}`);
  }
  for (const suffix of ['ADDITIONAL_SUPERVISOR_ALIASES', 'ADDITIONAL_MANAGER_ALIASES']) {
    assert(new RegExp(`APPROVAL_POLICY\\.LEAVE_REQUEST\\.${suffix}'\\s*,\\s*'\\[\\]'`, 'i').test(sql), `CFG-06 ${suffix} default mismatch`);
  }
  const keyMatches = sql.match(/APPROVAL_POLICY\.[A-Z_]+\.(?:REVIEWER_ROLES|DUE_SOON_HOURS|OVERDUE_HOURS|ADDITIONAL_SUPERVISOR_ALIASES|ADDITIONAL_MANAGER_ALIASES)/g) || [];
  assert(keyMatches.length === 26, 'CFG-06 requires exactly 26 governed policy keys');
  assert(new Set(keyMatches).size === 26, 'CFG-06 policy keys must be unique');
  return { statementCount: 1, controlledUpdateCount: 0 };
}


function validateCfg07Sql(sql) {
  const source = String(sql || '');
  rejectDestructiveSql(source);
  assert(!/^\s*UPDATE\b/im.test(source) && !/;\s*UPDATE\b/i.test(source), 'CFG-07 UPDATE/backfill is forbidden');
  assert(!/^\s*ALTER\s+TABLE\b/im.test(source), 'CFG-07 top-level ALTER TABLE is forbidden');

  const createTables = [...source.matchAll(/CREATE TABLE "([^"]+)"/gi)].map((match) => match[1]);
  assert(createTables.length === 2, 'CFG-07 requires exactly two governance tables');
  assert(createTables[0] === 'retention_policy_changes' && createTables[1] === 'retention_cleanup_runs', 'CFG-07 governance table targets mismatch');

  const expectedIndexes = [
    'retention_policy_changes_one_scheduled_key',
    'retention_policy_changes_status_effective_idx',
    'retention_policy_changes_requester_requested_idx',
    'retention_cleanup_runs_started_status_idx',
    'retention_cleanup_runs_actor_started_idx'
  ];
  const indexMatches = [...source.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/gi)].map((match) => match[1]);
  assert(indexMatches.length === expectedIndexes.length, 'CFG-07 requires exactly five explicit governance indexes');
  assert(expectedIndexes.every((name) => indexMatches.includes(name)), 'CFG-07 governance index set mismatch');
  assert(/CREATE UNIQUE INDEX "retention_policy_changes_one_scheduled_key"[\s\S]*WHERE "status" = 'SCHEDULED'/i.test(source), 'CFG-07 scheduled-change uniqueness guard missing');

  for (const [table, columns] of [
    ['retention_policy_changes', ['id', 'status', 'before_policy', 'proposed_policy', 'preview_snapshot', 'preview_digest', 'reason', 'requested_by_user_id', 'requested_at', 'effective_at', 'applied_at', 'cancelled_at', 'cancel_reason', 'updated_at']],
    ['retention_cleanup_runs', ['id', 'trigger', 'status', 'policy_snapshot', 'result_snapshot', 'actor_user_id', 'started_at', 'completed_at', 'error_code']]
  ]) {
    const start = source.indexOf(`CREATE TABLE "${table}"`);
    const end = source.indexOf(');', start);
    assert(start >= 0 && end > start, `CFG-07 table definition missing: ${table}`);
    const definition = source.slice(start, end + 2);
    for (const column of columns) assert(definition.includes(`"${column}"`), `CFG-07 missing ${table}.${column}`);
  }
  assert(/retention_policy_changes_requester_fkey[\s\S]*REFERENCES "users"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/i.test(source), 'CFG-07 requester FK invariant mismatch');
  assert(/retention_cleanup_runs_actor_fkey[\s\S]*REFERENCES "users"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/i.test(source), 'CFG-07 cleanup actor FK invariant mismatch');
  assert(/CHECK \("status" IN \('SCHEDULED', 'APPLIED', 'CANCELLED'\)\)/i.test(source), 'CFG-07 policy-change status check missing');
  assert(/CHECK \("trigger" IN \('CRON', 'ADMIN'\)\)/i.test(source), 'CFG-07 cleanup trigger check missing');
  assert(/CHECK \("status" IN \('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'\)\)/i.test(source), 'CFG-07 cleanup status check missing');

  const inserts = source.match(/INSERT INTO\s+"[^"]+"/gi) || [];
  assert(inserts.length === 1 && /^INSERT INTO\s+"system_settings"$/i.test(inserts[0]), 'CFG-07 must seed system_settings exactly once');
  const expectedSeeds = [
    ["RETENTION.OPERATIONAL_USAGE.MONTHS", "6"],
    ["RETENTION.ATTENDANCE_RAW.MONTHS", "12"],
    ["RETENTION.PATROL_RAW.MONTHS", "3"],
    ["RETENTION.TIMEZONE", "Asia/Bangkok"]
  ];
  for (const [key, value] of expectedSeeds) {
    assert(source.includes(`('${key}', '${value}',`), `CFG-07 governed seed mismatch: ${key}`);
  }
  const retentionKeys = source.match(/RETENTION\.(?:OPERATIONAL_USAGE\.MONTHS|ATTENDANCE_RAW\.MONTHS|PATROL_RAW\.MONTHS|TIMEZONE)/g) || [];
  assert(retentionKeys.length === 4 && new Set(retentionKeys).size === 4, 'CFG-07 requires exactly four unique retention keys');
  assert(/ON CONFLICT \("key"\) DO NOTHING/i.test(source), 'CFG-07 seed requires ON CONFLICT DO NOTHING');

  assert(/target_tables text\[\] := ARRAY\['retention_policy_changes', 'retention_cleanup_runs'\]/i.test(source), 'CFG-07 RLS target table list mismatch');
  assert(/EXECUTE format\('ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY', table_name\)/i.test(source), 'CFG-07 RLS enable block missing');
  assert(/REVOKE ALL ON TABLE public\.%I FROM anon/i.test(source), 'CFG-07 anon revoke missing');
  assert(/REVOKE ALL ON TABLE public\.%I FROM authenticated/i.test(source), 'CFG-07 authenticated revoke missing');
  assert((source.match(/\bDO\s+\$\$/gi) || []).length === 1, 'CFG-07 requires exactly one controlled RLS DO block');

  return { statementCount: 9, controlledUpdateCount: 0 };
}

function validateEmpUxSql(sql) {
  const source = String(sql || '');
  rejectDestructiveSql(source);
  assert(!/\bUPDATE\b/i.test(source), 'EMP-UX UPDATE is forbidden');
  assert(!/\bALTER\s+TABLE\b/i.test(source), 'EMP-UX ALTER TABLE is forbidden');
  const statements = splitStatements(source);
  assert(statements.length === 8, 'EMP-UX requires exactly eight controlled statements');
  const tables = [...source.matchAll(/CREATE TABLE \"([^\"]+)\"/gi)].map((m) => m[1]);
  assert(tables.length === 2 && tables.includes('department_master') && tables.includes('position_master'), 'EMP-UX master table set mismatch');
  const indexes = [...source.matchAll(/CREATE (?:UNIQUE )?INDEX \"([^\"]+)\"/gi)].map((m) => m[1]);
  const expectedIndexes = ['department_master_normalized_name_key','department_master_is_active_sort_order_name_idx','position_master_normalized_name_key','position_master_is_active_sort_order_name_idx'];
  assert(indexes.length === 4 && expectedIndexes.every((name) => indexes.includes(name)), 'EMP-UX master index set mismatch');
  assert((source.match(/INSERT INTO \"department_master\"/gi) || []).length === 1, 'EMP-UX requires one Department bootstrap insert');
  assert((source.match(/INSERT INTO \"position_master\"/gi) || []).length === 1, 'EMP-UX requires one Position bootstrap insert');
  assert(/FROM \"employees\"[\s\S]*GROUP BY LOWER\(BTRIM\(\"department\"\)\)[\s\S]*ON CONFLICT \(\"normalized_name\"\) DO NOTHING/i.test(source), 'EMP-UX Department bootstrap policy mismatch');
  assert(/FROM \"employees\"[\s\S]*GROUP BY LOWER\(BTRIM\(\"job_title\"\)\)[\s\S]*ON CONFLICT \(\"normalized_name\"\) DO NOTHING/i.test(source), 'EMP-UX Position bootstrap policy mismatch');
  assert(!/INSERT INTO \"(?:employees|users|shift_assignments|leave_requests)\"/i.test(source), 'EMP-UX bootstrap target is forbidden');
  return { statementCount: 8, controlledUpdateCount: 0 };
}

function validateMdg01bSql(sql) {
  const source = String(sql || '');
  rejectDestructiveSql(source);
  assert(!/\bINSERT\s+INTO\b/i.test(source), 'MDG-01B INSERT is forbidden');
  const alterTargets = [...source.matchAll(/ALTER TABLE\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi)].map((match) => match[1] || match[2]);
  assert(alterTargets.length === 7, 'MDG-01B ALTER statement count mismatch');
  assert(alterTargets.every((table) => ['department_master', 'position_master', 'security_site_departments'].includes(table)), 'MDG-01B ALTER targets unexpected table');
  for (const table of ['department_master', 'position_master']) {
    assert(source.includes(`ALTER TABLE "${table}" ADD COLUMN "code" VARCHAR(50);`), 'MDG-01B missing ' + table + '.code add');
    assert(source.includes(`ALTER TABLE "${table}" ALTER COLUMN "code" SET NOT NULL;`), 'MDG-01B missing ' + table + '.code NOT NULL');
  }
  assert(/UPDATE "department_master" SET "code" = 'DEP-'[\s\S]*WHERE "code" IS NULL/i.test(source), 'MDG-01B Department code backfill mismatch');
  assert(/UPDATE "position_master" SET "code" = 'POS-'[\s\S]*WHERE "code" IS NULL/i.test(source), 'MDG-01B Position code backfill mismatch');
  assert(/ALTER TABLE "security_site_departments" ADD COLUMN "department_master_id" UUID/i.test(source), 'MDG-01B Department Master FK column missing');
  assert(source.includes('UPDATE "security_site_departments" ssd') && source.includes('SET "department_master_id" = dm."id"') && source.includes('lower(btrim(ssd."department_name")) = dm."normalized_name"') && source.includes('ssd."department_master_id" IS NULL'), 'MDG-01B controlled Department mapping backfill mismatch');
  assert(source.includes('IF EXISTS (SELECT 1 FROM "security_site_departments" WHERE "department_master_id" IS NULL)') && source.includes("RAISE EXCEPTION 'MDG-01B backfill failed:"), 'MDG-01B fail-closed unresolved mapping guard missing');
  assert(/ALTER TABLE "security_site_departments" ALTER COLUMN "department_master_id" SET NOT NULL/i.test(source), 'MDG-01B authority column must become NOT NULL');
  assert(source.includes('ADD CONSTRAINT "security_site_departments_department_master_id_fkey" FOREIGN KEY ("department_master_id") REFERENCES "department_master"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'), 'MDG-01B Department Master FK invariant mismatch');
  const expectedIndexes = [
    'department_master_code_key',
    'position_master_code_key',
    'security_site_departments_department_master_id_idx',
    'security_site_departments_security_site_id_department_master_id_key',
    'security_site_departments_one_default_per_department_master_key'
  ];
  const indexes = [...source.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/gi)].map((match) => match[1]);
  assert(indexes.length === expectedIndexes.length && expectedIndexes.every((name) => indexes.includes(name)), 'MDG-01B index set mismatch');
  assert(/CREATE UNIQUE INDEX "security_site_departments_one_default_per_department_master_key"[\s\S]*WHERE "is_default" = TRUE/i.test(source), 'MDG-01B one-default-per-Department guard missing');
  const updates = source.match(/(^|;)\s*UPDATE\s+/gim) || [];
  assert(updates.length === 3, 'MDG-01B requires exactly three controlled UPDATE statements');
  return { statementCount: 15, controlledUpdateCount: 3 };
}

function validateSqlForMigration(migrationId, sql) {
  if (migrationId === 'CFG-03') return validateCfg03Sql(sql);
  if (migrationId === 'CFG-04') return validateCfg04Sql(sql);
  if (migrationId === 'CFG-05') return validateCfg05Sql(sql);
  if (migrationId === 'CFG-06') return validateCfg06Sql(sql);
  if (migrationId === 'CFG-07') return validateCfg07Sql(sql);
  if (migrationId === 'MDG-01B') return validateMdg01bSql(sql);
  if (migrationId === 'EMP-UX-01') return validateEmpUxSql(sql);
  throw new Error(`production migration guard: unsupported migration_id: ${migrationId}`);
}

function validateMigrationManifest(input, { root = process.cwd(), verifySql = true } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be an object');
  assert(input.schema_version === EXPECTED.schemaVersion, 'unsupported schema_version');
  assert(input.manifest_state === EXPECTED.manifestState, 'manifest_state mismatch');
  const profile = MIGRATIONS[input.migration_id];
  assert(profile, 'unsupported migration_id');
  assert(SHA.test(input.source_commit_sha || ''), 'invalid source_commit_sha');
  assert(SHA.test(input.source_tree_sha || ''), 'invalid source_tree_sha');
  assert(MIGRATION_NAME.test(input.migration_name || ''), 'invalid migration_name');
  assert(input.migration_name === profile.migrationName, 'unexpected migration_name');
  assert(input.migration_path === `prisma/migrations/${input.migration_name}/migration.sql`, 'migration_path mismatch');
  assert(input.migration_policy === profile.migrationPolicy, 'migration_policy mismatch');
  assert(SAFE_SCRIPT.test(input.post_verify_script || ''), 'invalid post_verify_script');
  assert(input.post_verify_script === profile.postVerifyScript, 'unexpected post_verify_script');
  assert(DEPLOYMENT.test(input.current_production_deployment_id || ''), 'invalid current_production_deployment_id');
  assert(SHA.test(input.current_production_application_sha || ''), 'invalid current_production_application_sha');
  assert(input.target_environment === EXPECTED.targetEnvironment, 'target_environment mismatch');
  assert(input.target_project_name === EXPECTED.targetProjectName, 'target_project_name mismatch');
  assert(input.target_project_id === EXPECTED.targetProjectId, 'target_project_id mismatch');
  assert(input.target_org_id === EXPECTED.targetOrgId, 'target_org_id mismatch');
  assert(input.canonical_url === EXPECTED.canonicalUrl, 'canonical_url mismatch');
  assert(input.owner_action === EXPECTED.ownerAction, 'owner_action mismatch');
  assert(input.data_backfill === profile.dataBackfill, 'data_backfill mismatch');
  assert(input.application_deploy === false, 'application_deploy must be false');
  assert(input.destructive_rollback === false, 'destructive_rollback must be false');

  let sqlStats = { statementCount: 0, controlledUpdateCount: 0 };
  if (verifySql) {
    const migrationFile = path.join(root, ...input.migration_path.split('/'));
    assert(fs.existsSync(migrationFile), 'migration SQL file missing');
    sqlStats = validateSqlForMigration(input.migration_id, fs.readFileSync(migrationFile, 'utf8'));
    const verifierFile = path.join(root, ...input.post_verify_script.split('/'));
    assert(fs.existsSync(verifierFile), 'post verify script missing');
  }

  return Object.freeze({
    migrationId: input.migration_id,
    sourceCommitSha: input.source_commit_sha,
    sourceTreeSha: input.source_tree_sha,
    migrationName: input.migration_name,
    migrationPath: input.migration_path,
    migrationPolicy: input.migration_policy,
    postVerifyScript: input.post_verify_script,
    currentProductionDeploymentId: input.current_production_deployment_id,
    currentProductionApplicationSha: input.current_production_application_sha,
    targetProjectName: input.target_project_name,
    targetProjectId: input.target_project_id,
    targetOrgId: input.target_org_id,
    canonicalUrl: input.canonical_url,
    dataBackfill: input.data_backfill,
    schemaChanged: profile.schemaChanged,
    statementCount: sqlStats.statementCount,
    controlledUpdateCount: sqlStats.controlledUpdateCount
  });
}

function outputLines(result) {
  return [
    'PRODUCTION_MIGRATION_MANIFEST_GUARD=PASS',
    `migration_id=${result.migrationId}`,
    `source_commit_sha=${result.sourceCommitSha}`,
    `source_tree_sha=${result.sourceTreeSha}`,
    `migration_name=${result.migrationName}`,
    `migration_path=${result.migrationPath}`,
    `migration_policy=${result.migrationPolicy}`,
    `post_verify_script=${result.postVerifyScript}`,
    `current_production_deployment_id=${result.currentProductionDeploymentId}`,
    `current_production_application_sha=${result.currentProductionApplicationSha}`,
    `target_project_name=${result.targetProjectName}`,
    `target_project_id=${result.targetProjectId}`,
    `target_org_id=${result.targetOrgId}`,
    `canonical_url=${result.canonicalUrl}`,
    `data_backfill=${result.dataBackfill}`,
    `prisma_schema_changed=${result.schemaChanged}`,
    `sql_statement_count=${result.statementCount}`,
    `controlled_update_count=${result.controlledUpdateCount}`
  ];
}

function main() {
  const file = process.argv[2];
  assert(file, 'manifest path is required');
  const result = validateMigrationManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(`${outputLines(result).join('\n')}\n`);
}

if (require.main === module) main();

module.exports = {
  EXPECTED,
  MIGRATIONS,
  outputLines,
  splitStatements,
  validateCfg03Sql,
  validateCfg04Sql,
  validateCfg05Sql,
  validateCfg06Sql,
  validateCfg07Sql,
  validateEmpUxSql,
  validateMdg01bSql,
  validateSqlForMigration,
  validateMigrationManifest
};
