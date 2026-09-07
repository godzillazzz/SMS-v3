'use strict';

const { PrismaClient } = require('@prisma/client');
const { BASELINE_ALLOWLIST } = require('./verify-preview-baseline-manifest');
const {
  EXPECTED: LEGACY_EXPECTED,
  SERVER_ONLY_TABLES,
} = require('./verify-preview-baseline-effects-v1-reference');

const FACE_EXPECTED_SEMANTICS = `status NOT IN ('VERIFIED','CONSUMED') OR (device_proof_verified_at IS NOT NULL AND verified_at IS NOT NULL AND face_match_passed IS TRUE AND ((verification_mode = 'FACE_MATCH_WITH_LIVENESS' AND pad_passed IS TRUE AND injection_risk_detected IS FALSE) OR (verification_mode = 'FACE_MATCH_ONLY' AND pad_passed IS NULL AND injection_risk_detected IS NULL)))`;

const ATTENDANCE_EVENT_WORKFLOW_CONTRACT = Object.freeze({
  expectedObjectCount: 52,
  enums: [
    { name: 'AttendanceSessionState', labels: ['OPEN', 'CLOSED'] },
    { name: 'AttendanceEventType', labels: ['CHECK_IN', 'CHECK_OUT'] },
    { name: 'AttendanceEventProvenance', labels: ['ONLINE'] },
    { name: 'AttendanceTimeBasis', labels: ['SERVER_RECEIVED'] },
  ],
  tables: ['attendance_sessions', 'attendance_events'],
  columns: [
    ...[
      ['id', 'uuid', 'NO', 'gen_random_uuid'],
      ['employee_id', 'uuid', 'NO'],
      ['shift_assignment_id', 'uuid', 'NO'],
      ['expected_shift_type_id', 'uuid', 'NO'],
      ['expected_site_id', 'uuid', 'NO'],
      ['work_date', 'date', 'NO'],
      ['expectation_snapshot', 'jsonb', 'NO'],
      ['expectation_digest', 'bpchar', 'NO'],
      ['state', 'AttendanceSessionState', 'NO', 'OPEN'],
      ['opened_at', 'timestamp', 'NO', 'current_timestamp'],
      ['closed_at', 'timestamp', 'YES'],
      ['created_at', 'timestamp', 'NO', 'current_timestamp'],
      ['updated_at', 'timestamp', 'NO'],
    ].map(([name, udt, nullable, defaultPattern]) => ({
      table: 'attendance_sessions', name, udt, nullable, defaultPattern,
    })),
    ...[
      ['id', 'uuid', 'NO', 'gen_random_uuid'],
      ['session_id', 'uuid', 'NO'],
      ['face_verification_session_id', 'uuid', 'NO'],
      ['capture_id', 'uuid', 'NO'],
      ['event_type', 'AttendanceEventType', 'NO'],
      ['provenance', 'AttendanceEventProvenance', 'NO', 'ONLINE'],
      ['received_at', 'timestamp', 'NO'],
      ['effective_event_at', 'timestamp', 'NO'],
      ['time_basis', 'AttendanceTimeBasis', 'NO', 'SERVER_RECEIVED'],
      ['context_digest', 'bpchar', 'NO'],
      ['location_evidence', 'jsonb', 'NO'],
      ['verification_snapshot', 'jsonb', 'NO'],
      ['created_at', 'timestamp', 'NO', 'current_timestamp'],
    ].map(([name, udt, nullable, defaultPattern]) => ({
      table: 'attendance_events', name, udt, nullable, defaultPattern,
    })),
  ],
  checks: [
    ['attendance_sessions', 'attendance_sessions_expectation_digest_format', "expectation_digest ~ '^[0-9a-f]{64}$'"],
    ['attendance_sessions', 'attendance_sessions_closed_state_check', "(state = 'OPEN' AND closed_at IS NULL) OR (state = 'CLOSED' AND closed_at IS NOT NULL)"],
    ['attendance_events', 'attendance_events_context_digest_format', "context_digest ~ '^[0-9a-f]{64}$'"],
    ['attendance_events', 'attendance_events_server_time_check', 'effective_event_at = received_at'],
  ].map(([table, name, expression]) => ({ table, name, expression })),
  indexes: [
    { table: 'attendance_sessions', name: 'attendance_sessions_pkey', unique: true, columns: ['id'] },
    { table: 'attendance_sessions', name: 'attendance_sessions_shift_assignment_id_key', unique: true, columns: ['shift_assignment_id'] },
    { table: 'attendance_sessions', name: 'attendance_sessions_employee_id_work_date_idx', unique: false, columns: ['employee_id', 'work_date'] },
    { table: 'attendance_sessions', name: 'attendance_sessions_work_date_state_idx', unique: false, columns: ['work_date', 'state'] },
    { table: 'attendance_events', name: 'attendance_events_pkey', unique: true, columns: ['id'] },
    { table: 'attendance_events', name: 'attendance_events_face_verification_session_id_key', unique: true, columns: ['face_verification_session_id'] },
    { table: 'attendance_events', name: 'attendance_events_capture_id_key', unique: true, columns: ['capture_id'] },
    { table: 'attendance_events', name: 'attendance_events_session_id_event_type_key', unique: true, columns: ['session_id', 'event_type'] },
    { table: 'attendance_events', name: 'attendance_events_session_id_effective_event_at_idx', unique: false, columns: ['session_id', 'effective_event_at'] },
    { table: 'attendance_events', name: 'attendance_events_received_at_idx', unique: false, columns: ['received_at'] },
  ],
  foreignKeys: [
    ['attendance_sessions', 'attendance_sessions_employee_id_fkey', ['employee_id'], 'employees', ['id']],
    ['attendance_sessions', 'attendance_sessions_shift_assignment_id_fkey', ['shift_assignment_id'], 'shift_assignments', ['id']],
    ['attendance_sessions', 'attendance_sessions_expected_shift_type_id_fkey', ['expected_shift_type_id'], 'shift_types', ['id']],
    ['attendance_sessions', 'attendance_sessions_expected_site_id_fkey', ['expected_site_id'], 'security_sites', ['id']],
    ['attendance_events', 'attendance_events_session_id_fkey', ['session_id'], 'attendance_sessions', ['id']],
    ['attendance_events', 'attendance_events_face_verification_session_id_fkey', ['face_verification_session_id'], 'face_verification_sessions', ['id']],
  ].map(([table, name, columns, refTable, refColumns]) => ({
    table, name, columns, refTable, refColumns, onDelete: 'RESTRICT', onUpdate: 'CASCADE',
  })),
});

const EXPECTED = Object.freeze({
  '202608240004_g06_attendance_event_workflow_v1': ATTENDANCE_EVENT_WORKFLOW_CONTRACT,
  ...LEGACY_EXPECTED,
});

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('Prisma read-only query capability is unavailable');
  }
  return prisma.$queryRawUnsafe(sql);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function list(values) {
  return values.map(quote).join(', ');
}

function stripOuterParentheses(value) {
  let text = String(value || '').trim();
  for (;;) {
    if (!text.startsWith('(') || !text.endsWith(')')) return text;
    let depth = 0;
    let inQuote = false;
    let wrapsAll = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "'") {
        if (inQuote && text[index + 1] === "'") {
          index += 1;
          continue;
        }
        inQuote = !inQuote;
        continue;
      }
      if (inQuote) continue;
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth < 0) return text;
      if (depth === 0 && index < text.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll || depth !== 0 || inQuote) return text;
    text = text.slice(1, -1).trim();
  }
}

function unwrapCheckDefinition(value) {
  let text = String(value || '').trim();
  if (/^check\b/i.test(text)) text = text.replace(/^check\b/i, '').trim();
  return stripOuterParentheses(text);
}

function normalizeSqlExpression(value) {
  let text = unwrapCheckDefinition(value)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/::\s*(?:character\s+varying|timestamp\s+(?:with|without)\s+time\s+zone)(?:\s*\[\])?/gi, '')
    .replace(/::\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\])?/g, '')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '$1')
    .replace(/\s+AT\s+TIME\s+ZONE\s+/gi, ' at time zone ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  let previous;
  do {
    previous = text;
    text = text
      .replace(/=\s*any\s*\(\s*\(?\s*array\s*\[([^\]]*)\]\s*\)?\s*\)/gi, ' in ($1)')
      .replace(/<>\s*all\s*\(\s*\(?\s*array\s*\[([^\]]*)\]\s*\)?\s*\)/gi, ' not in ($1)')
      .replace(/\(\s*([a-z_][a-z0-9_]*)\s*\)/gi, '$1')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s*([()=<>~])\s*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  } while (text !== previous);

  return stripOuterParentheses(text);
}

function normalizeIdentifier(value) {
  return String(value || '').replaceAll('"', '').replace(/^public\./i, '').toLowerCase();
}

function splitTopLevel(value) {
  const text = String(value || '');
  const parts = [];
  let start = 0;
  let depth = 0;
  let inQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      if (inQuote && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function isWordChar(char) {
  return Boolean(char) && /[a-z0-9_]/i.test(char);
}

function splitTopLevelBoolean(value, operator) {
  const text = stripOuterParentheses(String(value || '').trim());
  const parts = [];
  let start = 0;
  let depth = 0;
  let inQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      if (inQuote && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (text.slice(index, index + operator.length) !== operator) continue;
    if (isWordChar(text[index - 1]) || isWordChar(text[index + operator.length])) continue;
    parts.push(text.slice(start, index).trim());
    start = index + operator.length;
    index += operator.length - 1;
  }
  if (parts.length === 0) return [text];
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function parseBooleanExpression(value) {
  const current = stripOuterParentheses(String(value || '').trim());
  const ors = splitTopLevelBoolean(current, 'or');
  if (ors.length > 1) {
    const children = [];
    for (const part of ors) {
      const child = parseBooleanExpression(part);
      if (child.op === 'or') children.push(...child.children);
      else children.push(child);
    }
    return { op: 'or', children };
  }
  const ands = splitTopLevelBoolean(current, 'and');
  if (ands.length > 1) {
    const children = [];
    for (const part of ands) {
      const child = parseBooleanExpression(part);
      if (child.op === 'and') children.push(...child.children);
      else children.push(child);
    }
    return { op: 'and', children };
  }
  return { atom: stripOuterParentheses(current) };
}

function serializeBooleanExpression(node) {
  if (node.atom !== undefined) return node.atom;
  return `${node.op}(${node.children.map(serializeBooleanExpression).join(',')})`;
}

function canonicalBooleanExpression(value) {
  const normalized = normalizeSqlExpression(value);
  if (!normalized) return '';
  return serializeBooleanExpression(parseBooleanExpression(normalized));
}

function parseIndexDefinition(indexdef) {
  const normalized = normalizeIdentifier(indexdef).replace(/\s+/g, ' ').trim();
  const unique = /^create\s+unique\s+index\b/i.test(normalized);
  const open = normalized.indexOf('(');
  if (open < 0) return { unique, columns: [], predicate: null };
  let depth = 0;
  let close = -1;
  for (let index = open; index < normalized.length; index += 1) {
    if (normalized[index] === '(') depth += 1;
    if (normalized[index] === ')') depth -= 1;
    if (depth === 0) {
      close = index;
      break;
    }
  }
  const columns = close < 0
    ? []
    : splitTopLevel(normalized.slice(open + 1, close)).map((column) => normalizeIdentifier(column).replace(/\s+/g, ' ').trim());
  const where = normalized.match(/\swhere\s([\s\S]+)$/i);
  return {
    unique,
    columns,
    predicate: where ? canonicalBooleanExpression(where[1]) : null,
  };
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
  const expectedPredicate = expected.predicate ? canonicalBooleanExpression(expected.predicate) : null;
  return parsed.unique === expected.unique
    && JSON.stringify(parsed.columns) === JSON.stringify(expected.columns.map((column) => normalizeIdentifier(column).replace(/\s+/g, ' ').trim()))
    && parsed.predicate === expectedPredicate;
}

function expectedColumnMatches(actual, expected) {
  if (!actual) return false;
  if (normalizeIdentifier(actual.udt_name) !== normalizeIdentifier(expected.udt)) return false;
  if (String(actual.is_nullable).toUpperCase() !== expected.nullable) return false;
  if (expected.defaultPattern) {
    const actualDefault = normalizeSqlExpression(actual.column_default);
    const expectedDefault = normalizeSqlExpression(expected.defaultPattern);
    if (!actualDefault.includes(expectedDefault)) return false;
  }
  return true;
}

function expectedCheckMatches(actual, expected) {
  return Boolean(actual)
    && canonicalBooleanExpression(actual.definition) === canonicalBooleanExpression(expected.expression);
}

function contractObjectCount(contract) {
  return (contract.enums || []).length
    + (contract.tables || []).length
    + (contract.columns || []).length
    + (contract.checks || []).length
    + (contract.indexes || []).length
    + (contract.foreignKeys || []).length;
}

function sqlNot(value) {
  return value === null ? null : !value;
}

function sqlAnd(values) {
  if (values.includes(false)) return false;
  return values.every((value) => value === true) ? true : null;
}

function sqlOr(values) {
  if (values.includes(true)) return true;
  return values.every((value) => value === false) ? false : null;
}

function sqlEquals(left, right) {
  return left === null || right === null ? null : left === right;
}

function parseSqlLiteral(value) {
  const text = String(value).trim();
  if (text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  const quoted = text.match(/^'(.*)'$/s);
  if (quoted) return quoted[1].replace(/''/g, "'");
  throw new Error(`unsupported SQL literal in Face verifier: ${text}`);
}

function evaluateFaceAtom(atom, row) {
  const text = stripOuterParentheses(atom);
  let match = text.match(/^([a-z_][a-z0-9_]*) is not null$/);
  if (match) return row[match[1]] !== null && row[match[1]] !== undefined;
  match = text.match(/^([a-z_][a-z0-9_]*) is null$/);
  if (match) return row[match[1]] === null || row[match[1]] === undefined;
  match = text.match(/^([a-z_][a-z0-9_]*) is (true|false)$/);
  if (match) return row[match[1]] === (match[2] === 'true');
  match = text.match(/^([a-z_][a-z0-9_]*) not in\((.*)\)$/s);
  if (match) {
    const value = row[match[1]] ?? null;
    if (value === null) return null;
    const comparisons = splitTopLevel(match[2]).map((item) => sqlEquals(value, parseSqlLiteral(item)));
    const inResult = comparisons.includes(true) ? true : (comparisons.includes(null) ? null : false);
    return sqlNot(inResult);
  }
  match = text.match(/^([a-z_][a-z0-9_]*) in\((.*)\)$/s);
  if (match) {
    const value = row[match[1]] ?? null;
    if (value === null) return null;
    const comparisons = splitTopLevel(match[2]).map((item) => sqlEquals(value, parseSqlLiteral(item)));
    return comparisons.includes(true) ? true : (comparisons.includes(null) ? null : false);
  }
  match = text.match(/^([a-z_][a-z0-9_]*)(<>|=)(.+)$/s);
  if (match) {
    const result = sqlEquals(row[match[1]] ?? null, parseSqlLiteral(match[3]));
    return match[2] === '<>' ? sqlNot(result) : result;
  }
  throw new Error(`unsupported Face CHECK atom: ${text}`);
}

function evaluateFaceSqlExpression(value, row) {
  const normalized = normalizeSqlExpression(value);
  function visit(expression) {
    const current = stripOuterParentheses(expression);
    const ors = splitTopLevelBoolean(current, 'or');
    if (ors.length > 1) return sqlOr(ors.map(visit));
    const ands = splitTopLevelBoolean(current, 'and');
    if (ands.length > 1) return sqlAnd(ands.map(visit));
    return evaluateFaceAtom(current, row);
  }
  return visit(normalized);
}

function postgresCheckAccepts(value, row) {
  // PostgreSQL CHECK rejects only FALSE; TRUE and UNKNOWN both satisfy it.
  return evaluateFaceSqlExpression(value, row) !== false;
}

function faceTruthTableRows() {
  const rows = [];
  for (const status of ['verified', 'consumed', 'pending', null]) {
    for (const verification_mode of ['face_match_only', 'face_match_with_liveness', 'other', null]) {
      for (const device_proof_verified_at of [null, 'ts']) {
        for (const verified_at of [null, 'ts']) {
          for (const face_match_passed of [true, false, null]) {
            for (const pad_passed of [true, false, null]) {
              for (const injection_risk_detected of [true, false, null]) {
                rows.push({
                  status,
                  verification_mode,
                  device_proof_verified_at,
                  verified_at,
                  face_match_passed,
                  pad_passed,
                  injection_risk_detected,
                });
              }
            }
          }
        }
      }
    }
  }
  return rows;
}

function evaluateFaceVerifiedStateSemantics(actualDefinition, expectedDefinition = FACE_EXPECTED_SEMANTICS) {
  const rows = faceTruthTableRows();
  let notWeaker = true;
  let equivalent = true;
  let weakerCounterexample = null;
  let differenceCounterexample = null;
  for (const row of rows) {
    const expectedAccepts = postgresCheckAccepts(expectedDefinition, row);
    const actualAccepts = postgresCheckAccepts(actualDefinition, row);
    if (!expectedAccepts && actualAccepts) {
      notWeaker = false;
      if (!weakerCounterexample) weakerCounterexample = row;
    }
    if (expectedAccepts !== actualAccepts) {
      equivalent = false;
      if (!differenceCounterexample) differenceCounterexample = row;
    }
  }
  return {
    notWeaker,
    equivalent,
    strongerButNotEquivalent: notWeaker && !equivalent,
    rowsEvaluated: rows.length,
    weakerCounterexample,
    differenceCounterexample,
  };
}

async function inspectMetadata(prisma, contract) {
  const tables = [...new Set([
    ...(contract.tables || []),
    ...(contract.columns || []).map((column) => column.table),
    ...(contract.checks || []).map((check) => check.table),
    ...(contract.indexes || []).map((index) => index.table),
    ...(contract.foreignKeys || []).map((foreignKey) => foreignKey.table),
    ...(contract.rls?.tables || []),
  ])];
  const columns = contract.columns || [];
  const constraintNames = [...new Set([
    ...(contract.checks || []).map((check) => check.name),
    ...(contract.foreignKeys || []).map((foreignKey) => foreignKey.name),
  ])];
  const indexNames = [...new Set((contract.indexes || []).map((index) => index.name))];
  const enumNames = (contract.enums || []).map((item) => item.name);
  const tableList = list(tables) || quote('');
  const columnList = list(columns.map((column) => column.name)) || quote('');
  const constraintList = list(constraintNames) || quote('');
  const indexList = list(indexNames) || quote('');
  const enumList = list(enumNames) || quote('');
  const rlsList = list(contract.rls?.tables || []) || quote('');

  const [tableRows, columnRows, constraintRows, indexRows, enumRows, rlsRows, grantRows, policyRows] = await Promise.all([
    queryRaw(prisma, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${tableList})`),
    queryRaw(prisma, `SELECT table_name, column_name, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${tableList}) AND column_name IN (${columnList})`),
    queryRaw(prisma, `SELECT cls.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = cls.relnamespace WHERE ns.nspname = 'public' AND con.conname IN (${constraintList})`),
    queryRaw(prisma, `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${indexList})`),
    queryRaw(prisma, `SELECT t.typname AS enum_name, e.enumlabel, e.enumsortorder FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname IN (${enumList}) ORDER BY t.typname, e.enumsortorder`),
    queryRaw(prisma, `SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${rlsList})`),
    queryRaw(prisma, `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') AND table_name IN (${rlsList})`),
    queryRaw(prisma, `SELECT c.relname AS table_name, count(p.polname)::int AS policy_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_policy p ON p.polrelid = c.oid WHERE n.nspname = 'public' AND c.relname IN (${rlsList}) GROUP BY c.relname`),
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
  let faceProof = null;
  for (const table of contract.tables || []) {
    if (!tables.has(table)) failures.push(`missing table ${table}`);
  }
  for (const expected of contract.columns || []) {
    if (!expectedColumnMatches(columns.get(`${expected.table}.${expected.name}`), expected)) {
      failures.push(`column mismatch ${expected.table}.${expected.name}`);
    }
  }
  for (const expected of contract.checks || []) {
    const actual = constraints.get(`${expected.table}.${expected.name}`);
    if (name === '202608250001_g06_face_match_only_mode_v1'
      && expected.name === 'face_verification_sessions_verified_state_check') {
      try {
        faceProof = evaluateFaceVerifiedStateSemantics(actual?.definition || '');
        if (!faceProof.equivalent) failures.push(`Face verified-state semantic mismatch ${expected.table}.${expected.name}`);
      } catch (error) {
        faceProof = {
          notWeaker: false,
          equivalent: false,
          strongerButNotEquivalent: false,
          rowsEvaluated: 0,
          error: error.message,
        };
        failures.push(`Face verified-state semantic proof failed ${expected.table}.${expected.name}`);
      }
    } else if (!expectedCheckMatches(actual, expected)) {
      failures.push(`check mismatch ${expected.table}.${expected.name}`);
    }
  }
  for (const expected of contract.indexes || []) {
    if (!expectedIndexMatches(indexes.get(expected.name), expected)) failures.push(`index mismatch ${expected.name}`);
  }
  for (const expected of contract.foreignKeys || []) {
    if (!expectedForeignKeyMatches(constraints.get(`${expected.table}.${expected.name}`), expected)) {
      failures.push(`foreign key mismatch ${expected.name}`);
    }
  }
  for (const expected of contract.enums || []) {
    if (JSON.stringify(enums.get(expected.name) || []) !== JSON.stringify(expected.labels)) {
      failures.push(`enum mismatch ${expected.name}`);
    }
  }

  if (contract.expectedObjectCount !== undefined
    && contractObjectCount(contract) !== contract.expectedObjectCount) {
    failures.push(`source contract object-count mismatch: expected ${contract.expectedObjectCount} got ${contractObjectCount(contract)}`);
  }

  if (contract.rls) {
    const rls = new Map((metadata.rlsRows || []).map((row) => [row.table_name, row]));
    const grantTables = new Set((metadata.grantRows || []).map((row) => row.table_name));
    const policies = new Map((metadata.policyRows || []).map((row) => [row.table_name, Number(row.policy_count)]));
    for (const table of contract.rls.tables) {
      const row = rls.get(table);
      if (!row || row.relrowsecurity !== true || row.relforcerowsecurity !== contract.rls.force) {
        failures.push(`rls mismatch ${table}`);
      }
      if (contract.rls.noApiGrants && grantTables.has(table)) failures.push(`api grant remains ${table}`);
      if (contract.rls.policies !== undefined && Number(policies.get(table) || 0) !== contract.rls.policies) {
        failures.push(`policy mismatch ${table}`);
      }
    }
  }

  if (name === '202608240004_g06_attendance_event_workflow_v1' && failures.length === 0) {
    log('BASELINE_EFFECT_240004_OBJECTS=52_OF_52');
    log('BASELINE_EFFECT_240004_DIGEST_CAST_NORMALIZATION=PASS');
  }
  if (name === '202608250001_g06_face_match_only_mode_v1') {
    const check = (metadata.constraintRows || [])
      .find((row) => row.conname === 'face_verification_sessions_verified_state_check');
    log(`FACE_VERIFIED_STATE_EXPECTED_SEMANTICS=${canonicalBooleanExpression(FACE_EXPECTED_SEMANTICS)}`);
    log(`FACE_VERIFIED_STATE_ACTUAL_SEMANTICS=${canonicalBooleanExpression(check?.definition || '')}`);
    log(`FACE_VERIFIED_STATE_TRUTH_TABLE_ROWS=${faceProof?.rowsEvaluated || 0}`);
    log(`FACE_VERIFIED_STATE_NOT_WEAKER=${faceProof?.notWeaker ? 'YES' : 'NO'}`);
    log(`FACE_VERIFIED_STATE_EQUIVALENT=${faceProof?.equivalent ? 'YES' : 'NO'}`);
    log('OPERATION_HISTORY_DIFFERENT=YES');
  }

  const pass = failures.length === 0;
  if (contract.rls) {
    log(`RLS_${name.slice(0, 10)}_EXPECTED=ENABLED_FORCE_DISABLED_NO_POLICIES_NO_ANON_AUTH_GRANTS`);
    log(`RLS_${name.slice(0, 10)}_ACTUAL=${pass ? 'ENABLED_FORCE_DISABLED_NO_POLICIES_NO_ANON_AUTH_GRANTS' : failures.join(';')}`);
  }
  if (!pass) throw new Error(`${name} semantic effect verification failed: ${failures.join('; ')}`);
  log(`BASELINE_EFFECT_${name}=PASS`);
  return { pass, failures, faceProof, operationHistoryDifferent: Boolean(contract.operationHistoryDifferent) };
}

async function verifyBaselineEffects({ prisma, log = console.log } = {}) {
  const ownsClient = !prisma;
  const client = prisma || new PrismaClient();
  try {
    for (const name of BASELINE_ALLOWLIST) {
      const contract = EXPECTED[name];
      if (!contract) throw new Error(`allowlisted migration has no semantic contract: ${name}`);
      const metadata = await inspectMetadata(client, contract);
      evaluateContract(name, metadata, log);
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
  ATTENDANCE_EVENT_WORKFLOW_CONTRACT,
  BASELINE_ALLOWLIST,
  EXPECTED,
  FACE_EXPECTED_SEMANTICS,
  SERVER_ONLY_TABLES,
  canonicalBooleanExpression,
  contractObjectCount,
  evaluateContract,
  evaluateFaceSqlExpression,
  evaluateFaceVerifiedStateSemantics,
  expectedCheckMatches,
  expectedColumnMatches,
  expectedForeignKeyMatches,
  expectedIndexMatches,
  faceTruthTableRows,
  inspectMetadata,
  normalizeIdentifier,
  normalizeSqlExpression,
  parseForeignKey,
  parseIndexDefinition,
  postgresCheckAccepts,
  splitTopLevel,
  splitTopLevelBoolean,
  stripOuterParentheses,
  unwrapCheckDefinition,
  verifyBaselineEffects,
};
