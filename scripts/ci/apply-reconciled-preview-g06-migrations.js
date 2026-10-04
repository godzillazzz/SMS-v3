'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const RECON = require('./reconcile-preview-g06-migrations-readonly');
const POLICY = require('./inspect-approved-pr-preview-attendance-time-policy-migration');
const RUNTIME = require('./verify-preview-attendance-time-policy-readonly-runtime');

const PRED = '202610020001_g06_simple_device_offline';
const TARGET = '202610020002_attendance_time_policy_v1';
const PENDING = [PRED, TARGET];
const SAFE_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ALLOWED_CANDIDATE_TRANSFORMS = Object.freeze(['IDENTITY', 'LF_TO_CRLF_SQL_SAFE']);
const LEDGER_SQL = 'SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM public."_prisma_migrations" ORDER BY started_at, migration_name';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validHex(value, size) { return typeof value === 'string' && new RegExp('^[0-9a-f]{' + size + '}$', 'i').test(value); }
function gitText(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function gitBytes(root, args) { return execFileSync('git', args, { cwd: root, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }); }

function readAndValidateManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.evidenceRun !== '37124477331'
      || manifest.canonicalCandidates?.length !== 18 || manifest.historicalPreviewMigrations?.length !== 2
      || JSON.stringify(manifest.candidateTransforms) !== JSON.stringify(ALLOWED_CANDIDATE_TRANSFORMS)) {
    throw new Error('PINNED_CANDIDATE_MANIFEST_INVALID');
  }
  const seen = new Set();
  for (const item of [...manifest.canonicalCandidates, ...manifest.historicalPreviewMigrations]) {
    if (!SAFE_NAME.test(item.name) || seen.has(item.name) || !validHex(item.commit, 40) || !validHex(item.blob, 40)) {
      throw new Error('PINNED_CANDIDATE_MANIFEST_INVALID');
    }
    seen.add(item.name);
  }
  return manifest;
}

function loadPinnedFile(root, item) {
  const file = 'prisma/migrations/' + item.name + '/migration.sql';
  if (gitText(root, ['rev-parse', item.commit + ':' + file]) !== item.blob.toLowerCase()) throw new Error('PINNED_GIT_BLOB_MISMATCH');
  const bytes = gitBytes(root, ['show', item.commit + ':' + file]);
  const actual = execFileSync('git', ['hash-object', '--stdin'], { cwd: root, input: bytes, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  if (actual !== item.blob.toLowerCase()) throw new Error('PINNED_GIT_BLOB_MISMATCH');
  return { bytes, blob: actual, label: item.label, commit: item.commit };
}

function hasNewlineInsideSqlQuotedConstruct(sql) {
  let state = 'normal';
  let dollarTag = '';
  for (let i = 0; i < sql.length; i += 1) {
    const current = sql[i];
    const next = sql[i + 1];
    if ((current === '\n' || current === '\r') && ['single', 'double', 'dollar'].includes(state)) return true;
    if (state === 'line-comment') {
      if (current === '\n' || current === '\r') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') { state = 'normal'; i += 1; }
      continue;
    }
    if (state === 'single') {
      if (current === '\\') {
        if (next === '\n' || next === '\r') return true;
        i += 1;
        continue;
      }
      if (current === "'" && next === "'") { i += 1; continue; }
      if (current === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      if (current === '"' && next === '"') { i += 1; continue; }
      if (current === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; state = 'normal'; dollarTag = ''; }
      continue;
    }
    if (current === '-' && next === '-') { state = 'line-comment'; i += 1; continue; }
    if (current === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }
    if (current === "'") { state = 'single'; continue; }
    if (current === '"') { state = 'double'; continue; }
    if (current === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; state = 'dollar'; i += dollarTag.length - 1; }
    }
  }
  return false;
}

function safeCrlfCandidate(bytes) {
  const sql = bytes.toString('utf8');
  if (!Buffer.from(sql, 'utf8').equals(bytes) || sql.includes('\r') || !sql.includes('\n')
      || /\bCOPY\b[\s\S]*\bFROM\s+STDIN\b/i.test(sql)
      || hasNewlineInsideSqlQuotedConstruct(sql)) return null;
  const candidate = Buffer.from(sql.replace(/\n/g, '\r\n'), 'utf8');
  return candidate.equals(bytes) ? null : candidate;
}

function candidateVariants(source, manifest) {
  const variants = [{ ...source, digest: sha256(source.bytes), transform: 'IDENTITY' }];
  if (manifest.candidateTransforms.includes('LF_TO_CRLF_SQL_SAFE')) {
    const crlf = safeCrlfCandidate(source.bytes);
    if (crlf) variants.push({
      ...source,
      bytes: crlf,
      digest: sha256(crlf),
      label: source.label + '_CRLF',
      transform: 'LF_TO_CRLF_SQL_SAFE',
    });
  }
  return variants;
}

function applicationRootFacts(root, manifest) {
  if (gitText(root, ['rev-parse', 'HEAD']) !== manifest.application.sha
      || gitText(root, ['rev-parse', 'HEAD^{tree}']) !== manifest.application.tree) throw new Error('APPLICATION_SOURCE_IDENTITY_MISMATCH');
  const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'));
  const predecessor = fs.readFileSync(path.join(root, 'prisma', 'migrations', PRED, 'migration.sql'));
  const target = fs.readFileSync(path.join(root, 'prisma', 'migrations', TARGET, 'migration.sql'));
  if (sha256(schema) !== RECON.EXPECTED.schemaSha256
      || sha256(predecessor) !== RECON.EXPECTED.predecessorSha256
      || sha256(target) !== RECON.EXPECTED.targetSha256) throw new Error('APPLICATION_MIGRATION_PIN_MISMATCH');
  return { schema, predecessor, target };
}

function loadCandidateSources({ manifest, gitRoot, applicationRoot }) {
  const canonical = new Map();
  for (const item of manifest.canonicalCandidates) {
    const historical = loadPinnedFile(gitRoot, item);
    const relative = 'prisma/migrations/' + item.name + '/migration.sql';
    const current = fs.readFileSync(path.join(applicationRoot, relative));
    const currentBlob = gitText(applicationRoot, ['rev-parse', 'HEAD:' + relative]);
    const verifiedCurrent = execFileSync('git', ['hash-object', '--stdin'], { cwd: applicationRoot, input: current, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (verifiedCurrent !== currentBlob) throw new Error('PINNED_APPLICATION_BLOB_MISMATCH');
    canonical.set(item.name, [
      ...candidateVariants(historical, manifest),
      ...candidateVariants({ bytes: current, blob: currentBlob, label: 'MATCH_CURRENT_SOURCE', commit: manifest.application.sha }, manifest),
    ]);
  }
  const historicalPreview = manifest.historicalPreviewMigrations.map((item) => ({ ...item, ...loadPinnedFile(gitRoot, item) }));
  return { canonical, historicalPreview };
}

function classifyCandidateMatches(rows, candidates, names) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.migration_name !== 'string' || !SAFE_NAME.test(row.migration_name)
        || !validHex(String(row.checksum || '').toLowerCase(), 64)) {
      return { ok: false, results: [{ name: 'LEDGER', classification: 'LEDGER_RESULT_MALFORMED' }], selected: new Map() };
    }
    if (!groups.has(row.migration_name)) groups.set(row.migration_name, []);
    groups.get(row.migration_name).push(row);
  }
  const results = [];
  const selected = new Map();
  for (const name of names) {
    const records = groups.get(name) || [];
    if (records.length !== 1) {
      results.push({ name, classification: records.length ? 'AMBIGUOUS' : 'LEDGER_RECORD_ABSENT' });
      continue;
    }
    if (!records[0].finished_at || records[0].rolled_back_at) {
      results.push({ name, classification: 'FAILED_OR_INCOMPLETE' });
      continue;
    }
    const matches = (candidates.get(name) || []).filter((item) => item.digest === String(records[0].checksum).toLowerCase());
    const distinct = [];
    for (const item of matches) {
      if (!Buffer.isBuffer(item.bytes)) return { ok: false, results: [{ name, classification: 'CANDIDATE_SOURCE_MALFORMED' }], selected };
      if (!distinct.some((candidate) => candidate.bytes.equals(item.bytes))) distinct.push(item);
    }
    if (distinct.length !== 1) {
      results.push({ name, classification: distinct.length ? 'AMBIGUOUS' : 'NO_MATCH' });
      continue;
    }
    const item = distinct[0];
    selected.set(name, item);
    results.push({ name, classification: item.label });
  }
  return { ok: results.length === names.length && results.every((row) => row.classification.startsWith('MATCH_')), results, selected };
}

function classifyPrismaStatus(result) {
  const output = String(result?.stdout || '') + '\n' + String(result?.stderr || '');
  if (/\bP30(?:09|18)\b/i.test(output) || /failed migration|migration history.{0,30}(?:diverg|inconsistent|mismatch)/i.test(output)) return 'HISTORY_DIVERGED';
  const names = [...new Set(output.match(/\b\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*\b/g) || [])];
  const pending = /following migration(?:\(s\)|s)? have not yet been applied|pending migration/i.test(output);
  if (pending && names.join('|') === PENDING.join('|')) return 'EXACTLY_PENDING_001_THEN_002';
  if (Number(result?.status) === 0 && /database schema is up to date|no pending migrations|all migrations have been applied/i.test(output)) return 'UP_TO_DATE';
  return pending || names.length ? 'OTHER_PENDING_MIGRATIONS' : 'STATUS_READ_FAILED';
}

function safeDatabaseFailure(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (['42501', 'P1010'].includes(code)) return 'DATABASE_PERMISSION';
  if (['57014', 'P1002', 'ETIMEDOUT'].includes(code)) return 'DATABASE_TIMEOUT';
  if (/^08[A-Z0-9]{3}$/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) return 'DATABASE_CONNECTION';
  if (['42P01', '42703', '3F000'].includes(code)) return 'MIGRATION_METADATA_UNAVAILABLE';
  return 'DATABASE_READ_FAILED';
}

async function readLedgerRows(env) {
  if (!env.DATABASE_URL) throw Object.assign(new Error(), { safeCategory: 'DATABASE_CONNECTION' });
  const { Client } = require('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000, query_timeout: 20000 });
  let inTransaction = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout = '20000ms'");
    const result = await client.query(LEDGER_SQL);
    if (!Array.isArray(result.rows)) throw Object.assign(new Error(), { safeCategory: 'LEDGER_RESULT_MALFORMED' });
    return result.rows;
  } catch (error) {
    if (error.safeCategory) throw error;
    throw Object.assign(new Error(), { safeCategory: safeDatabaseFailure(error) });
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

function ledgerFingerprint(rows) {
  const normalized = [...rows].map((row) => ({
    name: row.migration_name, checksum: String(row.checksum || '').toLowerCase(),
    started: row.started_at == null ? null : new Date(row.started_at).toISOString(),
    finished: row.finished_at == null ? null : new Date(row.finished_at).toISOString(),
    rolledBack: row.rolled_back_at == null ? null : new Date(row.rolled_back_at).toISOString(),
    steps: row.applied_steps_count == null ? null : Number(row.applied_steps_count),
  })).sort((a, b) => a.name.localeCompare(b.name) || String(a.started).localeCompare(String(b.started)));
  return sha256(Buffer.from(JSON.stringify(normalized), 'utf8'));
}

function buildEphemeralMigrationSource({ applicationRoot, gitRoot, manifest, candidateSources, tempRoot }) {
  const pins = applicationRootFacts(applicationRoot, manifest);
  const root = fs.mkdtempSync(path.join(tempRoot || os.tmpdir(), 'smsv3-g06-preview-migration-'));
  const prismaRoot = path.join(root, 'prisma');
  const migrationsRoot = path.join(prismaRoot, 'migrations');
  fs.mkdirSync(prismaRoot, { recursive: true });
  fs.copyFileSync(path.join(applicationRoot, 'prisma', 'schema.prisma'), path.join(prismaRoot, 'schema.prisma'));
  fs.cpSync(path.join(applicationRoot, 'prisma', 'migrations'), migrationsRoot, { recursive: true });
  for (const [name, item] of candidateSources.selected) {
    const target = path.join(migrationsRoot, name, 'migration.sql');
    if (!fs.existsSync(target)) throw new Error('CANONICAL_MIGRATION_SOURCE_MISSING');
    fs.writeFileSync(target, item.bytes);
  }
  for (const item of candidateSources.historicalPreview) {
    const target = path.join(migrationsRoot, item.name);
    if (fs.existsSync(target)) throw new Error('PREVIEW_HISTORICAL_MIGRATION_NAME_CONFLICT');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'migration.sql'), item.bytes);
  }
  const lock = path.join(migrationsRoot, 'migration_lock.toml');
  if (!fs.existsSync(lock)) {
    const schemaText = pins.schema.toString('utf8');
    const provider = schemaText.match(/datasource\s+\w+\s*\{[\s\S]*?\bprovider\s*=\s*"([^"]+)"/);
    if (!provider || provider[1] !== 'postgresql') throw new Error('MIGRATION_PROVIDER_UNVERIFIED');
    fs.writeFileSync(lock, 'provider = "postgresql"\n', 'utf8');
  }
  return { root, prismaRoot, migrationsRoot, schemaPath: path.join(prismaRoot, 'schema.prisma'), targetMigrationPath: path.join(migrationsRoot, TARGET, 'migration.sql') };
}

function assertReconciliationPlan(report) {
  const duplicateStates = Object.values(report.duplicateClassifications || {});
  return report.status !== 'STATUS_READ_FAILED' && report.previewTargetGuard === 'PASS'
    && report.migrationPlan === 'APPLY_001_THEN_002'
    && report.predecessorSchema === 'PREDECESSOR_SCHEMA_ABSENT'
    && report.predecessorLedger === 'ABSENT' && report.targetLedger === 'ABSENT'
    && report.targetPolicySchema === 'ABSENT'
    && report.historical28001 === 'MATCH_F2121BB' && report.historical28002 === 'MATCH_F2121BB'
    && report.historicalVariant === 'SPLIT_HISTORY_MATCH'
    && report.gpsOnlyUat === 'YES' && report.provenanceCheck === 'YES' && report.faceNullability === 'NULLABLE'
    && report.canonicalNext === 'CANONICAL_NEXT_001' && report.otherCanonicalPending === 'NONE'
    && report.incompleteCanonical === 'NONE' && report.canonicalChecksumMismatch === 'NONE'
    && report.unexplainedLedger === 'NONE' && report.unexpectedDuplicateGroups === 'NONE'
    && report.historyExplained === 'YES' && duplicateStates.length === 2
    && duplicateStates.every((value) => value === 'VALID_ROLLBACK_REAPPLY_HISTORY');
}

function assertPendingMigrations(rows) {
  const names = new Set(rows.map((row) => row.migration_name));
  if (PENDING.some((name) => names.has(name))) throw new Error('PREDECESSOR_OR_TARGET_LEDGER_CHANGED');
}

function sameCandidateResult(a, b) {
  if (!a.ok || !b.ok || a.selected.size !== b.selected.size) return false;
  for (const [name, item] of a.selected) {
    const selected = b.selected.get(name);
    if (!selected || selected.digest !== item.digest || !Buffer.isBuffer(selected.bytes) || !selected.bytes.equals(item.bytes)) return false;
  }
  return true;
}

function targetGuardFor(env) {
  const guardPath = path.join(env.RELEASE_CONTROL_ROOT || '', 'scripts', 'ci', 'verify-preview-migration-target.js');
  if (!fs.existsSync(guardPath)) throw new Error('RELEASE_CONTROL_GUARD_UNAVAILABLE');
  const verify = require(guardPath).verifyPreviewMigrationTarget;
  return async () => verify({ env, log: () => {} });
}

function statusCommand(schemaPath, env, runner = spawnSync) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return runner(command, ['--no-install', 'prisma', 'migrate', 'status', '--schema', schemaPath], {
    cwd: env.GITHUB_WORKSPACE || process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
}

function deployCommand(schemaPath, env, runner = spawnSync) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return runner(command, ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: env.GITHUB_WORKSPACE || process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
  });
}

function safeApplyFailure(result) {
  const output = String(result?.stdout || '') + '\n' + String(result?.stderr || '');
  if (/\bP30(?:09|18)\b/i.test(output) || /failed migration|migration .* failed/i.test(output)) return 'MIGRATION_FAILED_OR_PARTIAL';
  if (/timeout|timed out|lock/i.test(output)) return 'MIGRATION_TIMEOUT_OR_LOCK';
  return Number(result?.status) === 0 ? 'NONE' : 'MIGRATION_APPLY_FAILED';
}

function exactAppliedRows(rows, name) {
  const matching = rows.filter((row) => row.migration_name === name);
  return matching.length === 1 && Boolean(matching[0].finished_at) && !matching[0].rolled_back_at;
}

async function reconcile(env, bundle, guard, log) {
  return RECON.reconcilePreviewG06({
    env, targetGuard: guard, applicationRoot: bundle.prismaRoot,
    ef96Root: env.APPLICATION_SOURCE_ROOT, f212Root: env.APPLICATION_SOURCE_ROOT,
    sourceVerifier: () => RECON.migrationInventory(bundle.migrationsRoot), log,
  });
}

async function verifyPostMigration({ env, bundle, targetGuard, log, readLedger = readLedgerRows, runStatus = statusCommand, reconcileFn = reconcile }) {
  const rows = await readLedger(env);
  if (!exactAppliedRows(rows, PRED) || !exactAppliedRows(rows, TARGET)) throw new Error('POST_MIGRATION_LEDGER_INVALID');
  const reconciliation = await reconcileFn(env, bundle, targetGuard, log);
  if (reconciliation.predecessorSchema !== 'PREDECESSOR_SCHEMA_PRESENT'
      || reconciliation.targetPolicySchema !== 'PRESENT' || reconciliation.predecessorLedger !== 'COMPLETED'
      || reconciliation.targetLedger !== 'COMPLETED' || reconciliation.historyExplained !== 'YES'
      || reconciliation.gpsOnlyUat !== 'YES' || reconciliation.provenanceCheck !== 'YES'
      || reconciliation.faceNullability !== 'NULLABLE') throw new Error('POST_MIGRATION_PREDECESSOR_SCHEMA_INVALID');

  const schemaText = fs.readFileSync(bundle.schemaPath, 'utf8');
  const migrationText = fs.readFileSync(bundle.targetMigrationPath, 'utf8');
  const shape = POLICY.inspectPrismaMigrationShape(schemaText, migrationText);
  if (!shape.prismaModelParsed || !shape.mappingMatches || !shape.typeShapeMatches) throw new Error('POST_MIGRATION_PRISMA_SHAPE_INVALID');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  let schema;
  try { schema = await POLICY.inspectSchema(prisma, schemaText, migrationText); }
  catch (error) { throw Object.assign(new Error(), { safeCategory: error?.schemaReadCategory || 'SCHEMA_READ_UNKNOWN' }); }
  finally { await prisma.$disconnect().catch(() => {}); }
  if (!schema.physicalVerified || !schema.verified || !schema.tablePresent || !schema.columnsPresent
      || !schema.indexesPresent || !schema.constraintsPresent || !schema.rlsEnabled || !schema.revokesApplied) {
    throw new Error('POST_MIGRATION_POLICY_SCHEMA_INVALID');
  }
  if (classifyPrismaStatus(runStatus(bundle.schemaPath, env)) !== 'UP_TO_DATE') throw new Error('POST_MIGRATION_STATUS_NOT_UP_TO_DATE');
  const runtime = await RUNTIME.verifyReadonlyRuntime({ env, log, outputPath: process.env.GITHUB_OUTPUT });
  if (runtime.runtimeChecks !== 'PASS' || runtime.failed) throw new Error('POST_MIGRATION_PREVIEW_RUNTIME_FAILED');
  log('PREVIEW_POLICY_GET=' + runtime.policyGetResult);
  log('IPHONE_AUTHENTICATED_UI_GATE_READY=YES');
  return { predecessorSchema: 'PASS', targetSchema: 'PASS', migrationStatus: 'UP_TO_DATE', runtime: 'PASS', policyGet: runtime.policyGetResult };
}

function outputReport(report, file = process.env.GITHUB_OUTPUT) {
  if (!file) return;
  const fields = [
    ['phase_a', report.phaseA], ['candidate_match', report.candidateMatch], ['migration_plan', report.migrationPlan],
    ['migration_status', report.migrationStatus], ['migration_apply_attempted', report.applyAttempted ? 'YES' : 'NO'],
    ['migration_apply_result', report.applyResult], ['post_schema', report.postSchema], ['preview_runtime', report.previewRuntime],
    ['policy_get', report.policyGet], ['iphone_ui_gate_ready', report.iphoneUiGateReady], ['failure_category', report.failureCategory],
  ];
  fs.appendFileSync(file, fields.map(([key, value]) => key + '=' + (value || 'UNKNOWN')).join('\n') + '\n', 'utf8');
}

async function runApprovedPreviewMutation(options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;
  const report = { phaseA: 'FAIL', candidateMatch: 'UNKNOWN', migrationPlan: 'NOT_RUN', migrationStatus: 'NOT_RUN', applyAttempted: false, applyResult: 'NOT_RUN', postSchema: 'NOT_RUN', previewRuntime: 'NOT_RUN', policyGet: 'NOT_RUN', iphoneUiGateReady: 'NO', failureCategory: 'NONE' };
  const emit = (key, value) => log(key + '=' + value);
  let targetGuard = options.targetGuard;
  let targetGuardPassed = false;
  try {
    if (!targetGuard) targetGuard = targetGuardFor(env);
    await targetGuard();
    targetGuardPassed = true;
    emit('PREVIEW_TARGET_GUARD', 'PASS');
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview' || !env.DATABASE_URL || !env.DIRECT_URL) {
      throw Object.assign(new Error(), { safeCategory: 'PREVIEW_TARGET_GUARD_FAILED' });
    }
    const manifest = options.manifest || readAndValidateManifest(env.CANDIDATE_MANIFEST);
    if (manifest.application.sha !== env.SOURCE_SHA || manifest.application.tree !== env.SOURCE_TREE) throw new Error('APPLICATION_INPUT_PIN_MISMATCH');
    const applicationRoot = env.APPLICATION_SOURCE_ROOT;
    const gitRoot = env.GITHUB_WORKSPACE;
    if (options.validateApplication) await options.validateApplication(applicationRoot, manifest);
    else applicationRootFacts(applicationRoot, manifest);
    const candidateSources = options.loadCandidates
      ? await options.loadCandidates({ manifest, gitRoot, applicationRoot })
      : loadCandidateSources({ manifest, gitRoot, applicationRoot });
    const readLedger = options.readLedger || readLedgerRows;
    const firstRows = await readLedger(env);
    const first = classifyCandidateMatches(firstRows, candidateSources.canonical, manifest.canonicalCandidates.map((item) => item.name));
    for (const result of first.results) emit('CANONICAL_HISTORY_' + result.name, result.classification);
    if (!first.ok) {
      report.candidateMatch = 'FAIL';
      throw Object.assign(new Error(), { safeCategory: 'CANONICAL_HISTORY_CANDIDATE_MISMATCH' });
    }
    report.candidateMatch = 'PASS';
    assertPendingMigrations(firstRows);

    const bundle = (options.buildBundle || buildEphemeralMigrationSource)({
      applicationRoot, gitRoot, manifest, candidateSources, tempRoot: env.RUNNER_TEMP || os.tmpdir(),
    });
    emit('EPHEMERAL_MIGRATION_SOURCE', 'PASS');
    const reconcileFn = options.reconcile || reconcile;
    const initial = await reconcileFn(env, bundle, targetGuard, log);
    report.migrationPlan = initial.migrationPlan || 'FAIL_CLOSED_UNKNOWN';
    if (!assertReconciliationPlan(initial)) throw Object.assign(new Error(), { safeCategory: 'MIGRATION_HISTORY_OR_SCHEMA_GUARD_FAILED' });

    const runStatus = options.runStatus || statusCommand;
    report.migrationStatus = classifyPrismaStatus(runStatus(bundle.schemaPath, env));
    if (report.migrationStatus !== 'EXACTLY_PENDING_001_THEN_002') throw Object.assign(new Error(), { safeCategory: 'PRISMA_PENDING_SET_MISMATCH' });
    emit('PRISMA_STATUS', report.migrationStatus);

    const secondRows = await readLedger(env);
    if (ledgerFingerprint(firstRows) !== ledgerFingerprint(secondRows)) throw Object.assign(new Error(), { safeCategory: 'MIGRATION_LEDGER_CHANGED_DURING_PREFLIGHT' });
    const second = classifyCandidateMatches(secondRows, candidateSources.canonical, manifest.canonicalCandidates.map((item) => item.name));
    if (!sameCandidateResult(first, second)) throw Object.assign(new Error(), { safeCategory: 'MIGRATION_LEDGER_CHANGED_DURING_PREFLIGHT' });
    assertPendingMigrations(secondRows);
    const finalPreflight = await reconcileFn(env, bundle, targetGuard, log);
    if (!assertReconciliationPlan(finalPreflight)) throw Object.assign(new Error(), { safeCategory: 'MIGRATION_PREFLIGHT_CHANGED' });
    await targetGuard();
    report.phaseA = 'PASS';
    emit('FINAL_TARGET_GUARD', 'PASS');
    emit('PHASE_A_READ_ONLY_PREFLIGHT', 'PASS');

    const apply = options.apply || ((schemaPath, runEnv) => deployCommand(schemaPath, runEnv));
    report.applyAttempted = true;
    const applyResult = apply(bundle.schemaPath, env);
    const applyFailure = safeApplyFailure(applyResult);
    report.applyResult = applyFailure === 'NONE' ? 'SUCCESS' : 'FAILED';
    emit('MIGRATION_APPLY_ATTEMPTED', 'YES');
    emit('MIGRATION_APPLY_RESULT', report.applyResult);
    if (applyFailure !== 'NONE') throw Object.assign(new Error(), { safeCategory: applyFailure });

    const post = await (options.postVerify || verifyPostMigration)({ env, bundle, targetGuard, log, readLedger, runStatus, reconcileFn });
    report.postSchema = post.predecessorSchema === 'PASS' && post.targetSchema === 'PASS' ? 'PASS' : 'FAIL';
    report.previewRuntime = post.runtime || 'FAIL';
    report.policyGet = post.policyGet || 'NOT_RUN';
    report.iphoneUiGateReady = report.postSchema === 'PASS' && report.previewRuntime === 'PASS' ? 'YES' : 'NO';
    if (report.iphoneUiGateReady !== 'YES') throw Object.assign(new Error(), { safeCategory: 'POST_MIGRATION_GUARD_FAILED' });
    emit('POST_MIGRATION_SCHEMA', report.postSchema);
    emit('PREVIEW_RUNTIME', report.previewRuntime);
    emit('IPHONE_AUTHENTICATED_UI_GATE_READY', 'YES');
  } catch (error) {
    if (!targetGuardPassed) emit('PREVIEW_TARGET_GUARD', 'FAIL');
    report.failureCategory = error?.safeCategory || (error?.code ? safeDatabaseFailure(error) : 'FAIL_CLOSED_UNKNOWN');
    emit('G06_PREVIEW_MIGRATION_RESULT', 'STOPPED');
    emit('G06_PREVIEW_MIGRATION_FAILURE_CATEGORY', report.failureCategory);
    emit('MIGRATION_APPLY_ATTEMPTED', report.applyAttempted ? 'YES' : 'NO');
    emit('DATABASE_MUTATION_PERFORMED', report.applyAttempted ? 'YES_OR_PARTIAL' : 'NO');
    emit('RAW_DATABASE_ERROR_EMITTED', 'false');
    emit('RAW_MIGRATION_CHECKSUMS_EMITTED', 'false');
    emit('PRODUCTION_ACCESSED', 'false');
  }
  outputReport(report, options.outputPath || process.env.GITHUB_OUTPUT);
  return report;
}

async function main() {
  const result = await runApprovedPreviewMutation();
  return result.failureCategory === 'NONE' && result.applyResult === 'SUCCESS' && result.postSchema === 'PASS' && result.previewRuntime === 'PASS' ? 0 : 1;
}
if (require.main === module) main().then((status) => { process.exitCode = status; });

module.exports = {
  EXPECTED_PENDING: PENDING, LEDGER_SQL, assertPendingMigrations, assertReconciliationPlan, buildEphemeralMigrationSource,
  candidateVariants, classifyCandidateMatches, classifyPrismaStatus, hasNewlineInsideSqlQuotedConstruct,
  ledgerFingerprint, loadCandidateSources, outputReport, readAndValidateManifest, runApprovedPreviewMutation,
  safeApplyFailure, safeCrlfCandidate, safeDatabaseFailure, verifyPostMigration,
};
