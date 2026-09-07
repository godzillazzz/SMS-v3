'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { verifyPreviewMigrationTarget } = require('./verify-preview-migration-target');

const EXPECTED_HEAD = '202609010002_mdg_master_codes_department_site_authority';
const FOCUS_MIGRATION = '202608240004_g06_attendance_event_workflow_v1';
const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

function emit(name, value) {
  console.log(`${name}=${value}`);
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)--[^\r\n]*/g, '$1');
}

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  let dollarTag = null;
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '$') {
      const tag = sql.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
      if (tag) {
        dollarTag = tag[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;
    if (char === ';' && depth === 0) {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function splitTopLevel(value) {
  const result = [];
  let start = 0;
  let quote = null;
  let dollarTag = null;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (dollarTag) {
      if (value.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '$') {
      const tag = value.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
      if (tag) {
        dollarTag = tag[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function matchingParen(text, openingIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openingIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function unquote(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function expectedType(value) {
  return String(value || '')
    .replace(/\b(NOT\s+NULL|NULL|DEFAULT|COLLATE|GENERATED|CONSTRAINT)\b[\s\S]*$/i, '')
    .trim()
    .toLowerCase();
}

function constraintType(definition) {
  const text = String(definition || '').toUpperCase();
  if (text.includes('PRIMARY KEY')) return 'p';
  if (text.includes('FOREIGN KEY')) return 'f';
  if (text.includes('UNIQUE')) return 'u';
  if (text.includes('CHECK')) return 'c';
  return null;
}

function addObject(objects, object) {
  const key = JSON.stringify(object);
  if (!objects.some((candidate) => JSON.stringify(candidate) === key)) objects.push(object);
}

function parseCreateTable(statement, objects) {
  const match = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s*/i);
  if (!match) return;
  const table = match[1];
  addObject(objects, { kind: 'table', table });
  const opening = statement.indexOf('(', match.index + match[0].length - 1);
  if (opening < 0) return;
  const closing = matchingParen(statement, opening);
  if (closing < 0) return;
  for (const part of splitTopLevel(statement.slice(opening + 1, closing))) {
    const column = part.match(/^"([^"]+)"\s+([\s\S]+)$/);
    if (column && !/^CONSTRAINT\b|^PRIMARY\b|^UNIQUE\b|^CHECK\b|^FOREIGN\b/i.test(part)) {
      addObject(objects, {
        kind: 'column',
        table,
        column: column[1],
        type: expectedType(column[2]),
        notNull: /\bNOT\s+NULL\b/i.test(column[2]),
        hasDefault: /\bDEFAULT\b/i.test(column[2]),
      });
    }
    const inlineConstraint = part.match(/^CONSTRAINT\s+"([^"]+)"\s+([\s\S]+)$/i);
    if (inlineConstraint) {
      addObject(objects, {
        kind: 'constraint',
        table,
        name: inlineConstraint[1],
        type: constraintType(inlineConstraint[2]),
        definition: inlineConstraint[2],
      });
    }
  }
}

function parseMigration(name, sql) {
  const cleaned = stripSqlComments(sql);
  const statements = splitStatements(cleaned);
  const objects = [];
  const unsupported = [];
  const dataStatements = statements.some((statement) => /^\s*(?:INSERT\s+INTO|UPDATE\s+["A-Za-z_]|DELETE\s+FROM|COPY\s+)/i.test(statement));
  const enums = [];

  for (const statement of statements) {
    parseCreateTable(statement, objects);
    for (const match of statement.matchAll(/CREATE\s+TYPE\s+(?:"public"\.)?"([^"]+)"\s+AS\s+ENUM\s*\(([^)]*)\)/gi)) {
      const labels = [...match[2].matchAll(/'((?:''|[^'])*)'/g)].map((label) => label[1].replace(/''/g, "'"));
      const object = { kind: 'enum', typeName: match[1], labels };
      addObject(objects, object);
      enums.push(object);
    }
    for (const match of statement.matchAll(/ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"([\s\S]*)/gi)) {
      const table = match[1];
      const tail = match[2];
      for (const column of tail.matchAll(/ADD\s+COLUMN\s+"([^"]+)"\s+([\s\S]*?)(?=,\s*ADD\s+(?:COLUMN|CONSTRAINT)|$)/gi)) {
        addObject(objects, {
          kind: 'column',
          table,
          column: column[1],
          type: expectedType(column[2]),
          notNull: /\bNOT\s+NULL\b/i.test(column[2]),
          hasDefault: /\bDEFAULT\b/i.test(column[2]),
        });
      }
      for (const constraint of tail.matchAll(/(?:ADD\s+)?CONSTRAINT\s+"([^"]+)"\s+([\s\S]*?)(?=,\s*(?:ADD\s+)?CONSTRAINT|$)/gi)) {
        addObject(objects, {
          kind: 'constraint',
          table,
          name: constraint[1],
          type: constraintType(constraint[2]),
          definition: constraint[2],
        });
      }
      for (const dropped of tail.matchAll(/DROP\s+CONSTRAINT\s+"([^"]+)"/gi)) {
        addObject(objects, { kind: 'drop_constraint', table, name: dropped[1] });
      }
      for (const dropped of tail.matchAll(/DROP\s+COLUMN\s+"([^"]+)"/gi)) {
        addObject(objects, { kind: 'drop_column', table, column: dropped[1] });
      }
      if (/\bALTER\s+COLUMN\b/i.test(tail)) unsupported.push('ALTER_COLUMN');
      if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(tail)) {
        addObject(objects, { kind: 'rls', table, enabled: true, forced: /\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(tail) });
      }
    }
    for (const index of statement.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"\s*\(([^)]*)\)([\s\S]*)/gi)) {
      const columns = [...index[4].matchAll(/"([^"]+)"/g)].map((column) => column[1]);
      addObject(objects, {
        kind: 'index',
        table: index[3],
        name: index[2],
        unique: Boolean(index[1]),
        columns,
        predicate: index[5].match(/\bWHERE\b([\s\S]*)/i)?.[1] || '',
      });
    }
    for (const policy of statement.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"/gi)) {
      addObject(objects, { kind: 'policy', table: policy[2], name: policy[1] });
    }
    if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER|VIEW|RULE|SEQUENCE)\b/i.test(statement)) unsupported.push('UNSUPPORTED_OBJECT');
    if (/^\s*DO\s+\$\$/i.test(statement) && !/ROW\s+LEVEL\s+SECURITY/i.test(statement)) unsupported.push('DO_BLOCK');
  }

  return {
    name,
    sql,
    checksum: crypto.createHash('sha256').update(sql).digest('hex'),
    statements,
    statementCount: statements.length,
    dataStatements,
    objects,
    unsupported: [...new Set(unsupported)],
    enums,
  };
}

function readMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const name = entry.name;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
      return parseMigration(name, sql);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') throw new Error('read-only Prisma query unavailable');
  return prisma.$queryRawUnsafe(sql);
}

async function loadInventory(prisma) {
  const [tables, columns, enums, constraints, indexes, policies, rls] = await Promise.all([
    queryRaw(prisma, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`),
    queryRaw(prisma, `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public'`),
    queryRaw(prisma, `SELECT t.typname AS type_name, e.enumsortorder, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`),
    queryRaw(prisma, `SELECT cls.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = cls.relnamespace WHERE ns.nspname = 'public'`),
    queryRaw(prisma, `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`),
    queryRaw(prisma, `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'`),
    queryRaw(prisma, `SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`),
  ]);
  const enumMap = new Map();
  for (const row of enums) {
    const key = String(row.type_name);
    if (!enumMap.has(key)) enumMap.set(key, []);
    enumMap.get(key).push(String(row.enumlabel));
  }
  return {
    tables: new Set(tables.map((row) => String(row.table_name))),
    columns: new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row])),
    enums: enumMap,
    constraints: new Map(constraints.map((row) => [`${row.table_name}.${row.conname}`, row])),
    indexes: new Map(indexes.map((row) => [`${row.tablename}.${row.indexname}`, row])),
    policies: new Map(policies.map((row) => [`${row.tablename}.${row.policyname}`, row])),
    rls: new Map(rls.map((row) => [String(row.table_name), row])),
  };
}

function typeMatches(expected, actual) {
  if (!actual) return false;
  const type = normalizeWhitespace(expected).replace(/\s+/g, '');
  const udt = String(actual.udt_name || '').toLowerCase();
  const dataType = String(actual.data_type || '').toLowerCase().replace(/\s+/g, '');
  if (type.startsWith('"') && type.endsWith('"')) return udt === type.slice(1, -1).toLowerCase();
  if (type.startsWith('character varying')) return udt === 'varchar';
  if (type.startsWith('varchar')) return udt === 'varchar';
  if (type.startsWith('timestampwithtimezone') || type.startsWith('timestamptz')) return udt === 'timestamptz';
  if (type.startsWith('timestamp')) return udt === 'timestamp';
  if (type.startsWith('char')) return udt === 'bpchar';
  if (type === 'integer' || type === 'int') return udt === 'int4';
  if (type === 'bigint') return udt === 'int8';
  if (type === 'boolean' || type === 'bool') return udt === 'bool';
  if (type === 'jsonb') return udt === 'jsonb';
  if (type === 'uuid') return udt === 'uuid';
  if (type === 'date') return udt === 'date';
  if (type === 'text') return udt === 'text';
  return udt === type || dataType === type;
}

function constraintMatches(expected, actual) {
  if (!actual || (expected.type && String(actual.contype) !== expected.type)) return false;
  const expectedText = normalizeWhitespace(expected.definition).replace(/"/g, '');
  const actualText = normalizeWhitespace(actual.definition).replace(/"/g, '');
  if (expected.type === 'f') return expectedText.split(/\s+/).filter((token) => token.length > 2).every((token) => actualText.includes(token));
  return expectedText.split(/\s+/).filter((token) => token.length > 2).every((token) => actualText.includes(token));
}

function compareObject(object, inventory) {
  if (object.kind === 'table') return inventory.tables.has(object.table) ? 'MATCHING' : 'MISSING';
  if (object.kind === 'column') {
    const row = inventory.columns.get(`${object.table}.${object.column}`);
    if (!row) return 'MISSING';
    if (object.type && !typeMatches(object.type, row)) return 'DIFFERING';
    if (object.notNull !== (String(row.is_nullable).toUpperCase() === 'NO')) return 'DIFFERING';
    if (object.hasDefault !== Boolean(row.column_default)) return 'DIFFERING';
    return 'MATCHING';
  }
  if (object.kind === 'enum') {
    if (!inventory.enums.has(object.typeName)) return 'MISSING';
    return JSON.stringify(inventory.enums.get(object.typeName)) === JSON.stringify(object.labels) ? 'MATCHING' : 'DIFFERING';
  }
  if (object.kind === 'index') {
    const row = inventory.indexes.get(`${object.table}.${object.name}`);
    if (!row) return 'MISSING';
    const definition = normalizeWhitespace(row.indexdef);
    if (object.unique && !definition.includes('unique')) return 'DIFFERING';
    if (!object.columns.every((column) => definition.includes(column.toLowerCase()))) return 'DIFFERING';
    if (object.predicate && !definition.includes(normalizeWhitespace(object.predicate))) return 'DIFFERING';
    return 'MATCHING';
  }
  if (object.kind === 'constraint') {
    const row = inventory.constraints.get(`${object.table}.${object.name}`);
    if (!row) return 'MISSING';
    return constraintMatches(object, row) ? 'MATCHING' : 'DIFFERING';
  }
  if (object.kind === 'policy') return inventory.policies.has(`${object.table}.${object.name}`) ? 'MATCHING' : 'MISSING';
  if (object.kind === 'rls') {
    const row = inventory.rls.get(object.table);
    if (!row || !row.relrowsecurity) return 'MISSING';
    if (object.forced && !row.relforcerowsecurity) return 'DIFFERING';
    return 'MATCHING';
  }
  if (object.kind === 'drop_constraint') return inventory.constraints.has(`${object.table}.${object.name}`) ? 'DIFFERING' : 'MATCHING';
  if (object.kind === 'drop_column') return inventory.columns.has(`${object.table}.${object.column}`) ? 'DIFFERING' : 'MATCHING';
  return 'DIFFERING';
}

function runSchemaDiff() {
  const sourceUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!sourceUrl) return { state: 'UNKNOWN', hash: 'not_available', statementCount: 'not_available' };
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, [
    '--no-install', 'prisma', 'migrate', 'diff',
    '--from-url', sourceUrl,
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--script',
  ], { env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const stdout = String(result.stdout || '');
  const normalized = stdout.trim();
  const hash = crypto.createHash('sha256').update(stdout).digest('hex');
  if (result.status !== 0) return { state: 'UNKNOWN', hash, statementCount: 'not_available', output: stdout };
  if (!normalized) return { state: 'PASS', hash, statementCount: 0, output: stdout };
  return { state: 'FAIL', hash, statementCount: splitStatements(stripSqlComments(stdout)).length, output: stdout };
}

function classifyMigration(migration, comparison, fullSchema) {
  const { matching, differing, missing } = comparison;
  if (migration.dataStatements) return 'DATA_MIGRATION_REQUIRES_SEPARATE_REVIEW';
  if (differing > 0) return matching > 0 ? 'SCHEMA_CONFLICT' : 'SCHEMA_CONFLICT';
  if (missing > 0) return matching > 0 ? 'PARTIAL_EQUIVALENT' : 'GENUINELY_PENDING';
  if (migration.unsupported.length > 0 && fullSchema !== 'PASS') return 'UNRESOLVED';
  if (fullSchema === 'PASS' || migration.objects.length > 0 || migration.unsupported.length === 0) return 'EXACT_EQUIVALENT_ALREADY_PRESENT';
  return 'UNRESOLVED';
}

function appliedMigrationNames(rows) {
  const applied = new Set();
  for (const row of rows) {
    if (row.finished_at && !row.rolled_back_at) applied.add(String(row.migration_name));
  }
  return applied;
}

function rowState(row) {
  if (row.finished_at && !row.rolled_back_at) return 'APPLIED';
  if (row.rolled_back_at) return 'ROLLED_BACK';
  if (!row.finished_at && !row.rolled_back_at) return 'FAILED';
  return 'OTHER';
}

async function main() {
  verifyPreviewMigrationTarget({ env: process.env, log: emit });
  emit('PRODUCTION_TARGET_REJECT_GUARD', 'PASS');
  const prisma = new PrismaClient();
  try {
    const migrations = readMigrations();
    const ledgerRows = await queryRaw(prisma, `
      SELECT id::text AS id, migration_name, checksum, started_at, finished_at,
             rolled_back_at, applied_steps_count, (logs IS NOT NULL) AS logs_present
      FROM "_prisma_migrations"
      ORDER BY migration_name ASC, started_at ASC NULLS FIRST, id ASC
    `);
    const applied = appliedMigrationNames(ledgerRows);
    const pending = migrations.filter((migration) => !applied.has(migration.name));
    const focusRows = ledgerRows.filter((row) => String(row.migration_name) === FOCUS_MIGRATION);
    emit('TARGET_240004_LEDGER_ROW_COUNT', focusRows.length);
    focusRows.forEach((row, index) => {
      const n = index + 1;
      emit(`TARGET_240004_ROW_${n}_CHECKSUM_MATCH`, String(row.checksum) === migrations.find((m) => m.name === FOCUS_MIGRATION)?.checksum ? 'YES' : 'NO');
      emit(`TARGET_240004_ROW_${n}_FINISHED`, row.finished_at ? 'YES' : 'NO');
      emit(`TARGET_240004_ROW_${n}_ROLLED_BACK`, row.rolled_back_at ? 'YES' : 'NO');
      emit(`TARGET_240004_ROW_${n}_APPLIED_STEPS`, Number(row.applied_steps_count ?? 0));
      emit(`TARGET_240004_ROW_${n}_STATE`, rowState(row));
    });
    emit('TARGET_240004_FAILED_ROW_CREATED_BY_RETRY', focusRows.some((row) => !row.finished_at && !row.rolled_back_at) ? 'YES' : 'NO');
    emit('RECONCILED_240003_APPLIED', applied.has('202608240003_g06_security_site_qr_gps_v1') ? 'YES' : 'NO');
    emit('RECONCILED_240003_PENDING', applied.has('202608240003_g06_security_site_qr_gps_v1') ? 'NO' : 'YES');
    emit('TOTAL_PENDING_MIGRATIONS', pending.length);
    emit('PENDING_MIGRATION_LIST', pending.map((migration) => migration.name).join(','));

    const fullSchemaDiff = runSchemaDiff();
    emit('FULL_SCHEMA_DIFF', fullSchemaDiff.state);
    emit('FULL_SCHEMA_DIFF_SHA256', fullSchemaDiff.hash);
    emit('FULL_SCHEMA_DIFF_STATEMENT_COUNT', fullSchemaDiff.statementCount);
    const inventory = await loadInventory(prisma);
    const results = [];
    for (const migration of pending) {
      const comparison = { matching: 0, differing: 0, missing: 0, states: [] };
      for (const object of migration.objects) {
        const state = compareObject(object, inventory);
        comparison.states.push({ object, state });
        comparison[state === 'MATCHING' ? 'matching' : state === 'DIFFERING' ? 'differing' : 'missing'] += 1;
      }
      const classification = classifyMigration(migration, comparison, fullSchemaDiff.state);
      results.push({ migration, comparison, classification });
      const prefix = `MIGRATION_${migration.name}`;
      emit(`${prefix}_CHECKSUM`, migration.checksum);
      emit(`${prefix}_EXECUTABLE_STATEMENTS`, migration.statementCount);
      emit(`${prefix}_HAS_DATA_STATEMENTS`, migration.dataStatements ? 'YES' : 'NO');
      emit(`${prefix}_EXPECTED_OBJECT_COUNT`, migration.objects.length + migration.unsupported.length);
      emit(`${prefix}_MATCHING_OBJECT_COUNT`, comparison.matching + (migration.unsupported.length > 0 && fullSchemaDiff.state === 'PASS' ? migration.unsupported.length : 0));
      emit(`${prefix}_DIFFERING_OBJECT_COUNT`, comparison.differing + (migration.unsupported.length > 0 && fullSchemaDiff.state !== 'PASS' ? migration.unsupported.length : 0));
      emit(`${prefix}_MISSING_OBJECT_COUNT`, comparison.missing);
      emit(`${prefix}_CLASSIFICATION`, classification);
    }

    const focus = results.find((result) => result.migration.name === FOCUS_MIGRATION);
    emit('FAILED_STATEMENT_POSITION', focus && focus.migration.statements[0]?.startsWith('CREATE TYPE "AttendanceSessionState"') ? 1 : 'NOT_PROVEN');
    if (focus) {
      for (const typeName of ['AttendanceSessionState', 'AttendanceEventType', 'AttendanceEventProvenance', 'AttendanceTimeBasis']) {
        const expected = focus.migration.enums.find((item) => item.typeName === typeName);
        const actual = inventory.enums.get(typeName);
        emit(`ATTENDANCE_ENUM_${typeName}_EXISTS`, actual ? 'YES' : 'NO');
        emit(`ATTENDANCE_ENUM_${typeName}_LABELS_MATCH`, actual && expected && JSON.stringify(actual) === JSON.stringify(expected.labels) ? 'YES' : 'NO');
      }
      for (const table of ['attendance_sessions', 'attendance_events']) {
        emit(`ATTENDANCE_TABLE_${table}_EXISTS`, inventory.tables.has(table) ? 'YES' : 'NO');
      }
      emit('MIGRATION_202608240004_CLASSIFICATION', focus.classification);
    }
    const exact = results.filter((result) => result.classification === 'EXACT_EQUIVALENT_ALREADY_PRESENT').length;
    const genuine = results.filter((result) => result.classification === 'GENUINELY_PENDING').length;
    const partialOrConflict = results.filter((result) => ['PARTIAL_EQUIVALENT', 'SCHEMA_CONFLICT'].includes(result.classification)).length;
    const dataReview = results.filter((result) => result.classification === 'DATA_MIGRATION_REQUIRES_SEPARATE_REVIEW').length;
    const unresolved = results.filter((result) => result.classification === 'UNRESOLVED').length;
    emit('EXACT_EQUIVALENT_COUNT', exact);
    emit('GENUINELY_PENDING_COUNT', genuine);
    emit('PARTIAL_OR_CONFLICT_COUNT', partialOrConflict);
    emit('DATA_REVIEW_COUNT', dataReview);
    emit('UNRESOLVED_COUNT', unresolved);
    let overall = 'UNRESOLVED';
    if (unresolved === 0) {
      if (exact >= 2 && genuine === 0 && partialOrConflict === 0 && dataReview === 0) overall = 'FULL_PENDING_SCHEMA_PREEXISTS';
      else if (exact >= 2 && (genuine > 0 || partialOrConflict > 0 || dataReview > 0)) overall = 'MIXED_PREEXISTING_AND_PENDING';
      else if (exact >= 2) overall = 'MULTI_MIGRATION_SCHEMA_LEDGER_DIVERGENCE';
      else if (focus?.classification === 'SCHEMA_CONFLICT' || focus?.classification === 'PARTIAL_EQUIVALENT') overall = 'ISOLATED_240004';
      else if (genuine > 0) overall = 'MIXED_PREEXISTING_AND_PENDING';
    }
    emit('PREVIEW_MIGRATION_DIVERGENCE_CLASS', overall);
    if (exact > 0) emit('RECOMMENDED_REMEDIATION', 'OPTION_A_RESOLVE_EXACT_NO_DATA_ALLOWLIST_ONLY_AFTER_OWNER_APPROVAL; LEAVE_DATA_REVIEW_AND_CONFLICT_MIGRATIONS_UNRESOLVED');
    else emit('RECOMMENDED_REMEDIATION', 'OPTION_E_UNRESOLVED_STOP');
    emit('MIGRATION_DEPLOY_EXECUTED', 'NO');
    emit('RESOLVE_EXECUTED', 'NO');
    emit('DIAGNOSTIC_DB_MUTATION', 'NONE');
    emit('RAW_DATABASE_OUTPUT_EMITTED', 'false');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Preview migration-chain diagnosis failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseMigration,
  splitStatements,
  classifyMigration,
  rowState,
  normalizeWhitespace,
  stripSqlComments,
  readMigrations,
  queryRaw,
  loadInventory,
  compareObject,
  runSchemaDiff,
};
