'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_PENDING,
  LEDGER_SQL,
  assertPendingMigrations,
  assertReconciliationPlan,
  candidateVariants,
  classifyCandidateMatches,
  classifyPrismaStatus,
  hasNewlineInsideSqlQuotedConstruct,
  inspectPendingMigrationRecords,
  runApprovedPreviewMutation,
  safeCrlfCandidate,
  safeApplyFailure,
} = require('../scripts/ci/apply-reconciled-preview-g06-migrations');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ci/g06-preview-migration-candidates.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/migrate-approved-pr-preview-attendance-time-policy.yml'), 'utf8').replace(/\r\n/g, '\n');

function candidateSet(digest = 'a'.repeat(64)) {
  return new Map(manifest.canonicalCandidates.map((item, index) => [
    item.name,
    [{ blob: index.toString(16).padStart(40, '0'), digest, label: 'MATCH_ORIGINAL', bytes: Buffer.from('pinned') }],
  ]));
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ledgerRows(checksum = 'a'.repeat(64)) {
  return manifest.canonicalCandidates.map((item, index) => ({
    migration_name: item.name,
    checksum,
    started_at: new Date('2026-08-01T00:00:00.000Z'),
    finished_at: new Date('2026-08-01T00:01:00.000Z'),
    rolled_back_at: null,
    applied_steps_count: 1,
  }));
}

function plan(overrides = {}) {
  return {
    status: 'SUCCESS',
    previewTargetGuard: 'PASS',
    migrationPlan: 'APPLY_001_THEN_002',
    predecessorSchema: 'PREDECESSOR_SCHEMA_ABSENT',
    predecessorLedger: 'ABSENT',
    targetLedger: 'ABSENT',
    targetPolicySchema: 'ABSENT',
    historical28001: 'MATCH_F2121BB',
    historical28002: 'MATCH_F2121BB',
    historicalVariant: 'SPLIT_HISTORY_MATCH',
    gpsOnlyUat: 'YES',
    provenanceCheck: 'YES',
    faceNullability: 'NULLABLE',
    canonicalNext: 'CANONICAL_NEXT_001',
    otherCanonicalPending: 'NONE',
    incompleteCanonical: 'NONE',
    canonicalChecksumMismatch: 'NONE',
    unexplainedLedger: 'NONE',
    unexpectedDuplicateGroups: 'NONE',
    historyExplained: 'YES',
    duplicateClassifications: {
      first: 'VALID_ROLLBACK_REAPPLY_HISTORY',
      second: 'VALID_ROLLBACK_REAPPLY_HISTORY',
    },
    ...overrides,
  };
}

function statusOutput(names = EXPECTED_PENDING) {
  return { status: 1, stdout: 'Following migration(s) have not yet been applied:\n' + names.join('\n'), stderr: '' };
}

function runOptions(overrides = {}) {
  const calls = [];
  const rows = ledgerRows();
  return {
    calls,
    options: {
      env: {
        VERCEL_ENV: 'preview',
        DATABASE_URL: 'postgresql://redacted-test.invalid/db',
        DIRECT_URL: 'postgresql://redacted-test.invalid/db',
        SOURCE_SHA: manifest.application.sha,
        SOURCE_TREE: manifest.application.tree,
        RUNNER_TEMP: 'C:/temp',
      },
      manifest,
      targetGuard: async () => { calls.push('guard'); },
      validateApplication: async () => {},
      loadCandidates: async () => ({ canonical: candidateSet(), historicalPreview: [] }),
      readLedger: async () => { calls.push('read'); return rows.map((row) => ({ ...row })); },
      buildBundle: async () => ({ schemaPath: 'schema.prisma', migrationsRoot: 'migrations', targetMigrationPath: 'target.sql' }),
      reconcile: async () => { calls.push('reconcile'); return plan(); },
      runStatus: () => { calls.push('status'); return statusOutput(); },
      apply: () => { calls.push('apply'); return { status: 0, stdout: '', stderr: '' }; },
      postVerify: async () => { calls.push('post'); return { predecessorSchema: 'PASS', targetSchema: 'PASS', runtime: 'PASS', policyGet: 'HTTP_401_AUTH_REQUIRED' }; },
      log: (line) => calls.push('log:' + line),
      outputPath: null,
      ...overrides,
    },
  };
}

test('ledger inspection is explicitly read-only and contains no business-row query', () => {
  assert.match(LEDGER_SQL, /^SELECT\b/i);
  assert.match(LEDGER_SQL, /FROM public\."_prisma_migrations"/);
  assert.doesNotMatch(LEDGER_SQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i);
});

test('workflow rechecks ledger stability before apply and stops on change', async () => {
  const setup = runOptions();
  let reads = 0;
  setup.options.readLedger = async () => {
    reads += 1;
    return ledgerRows(reads === 1 ? 'a'.repeat(64) : 'b'.repeat(64));
  };
  const report = await runApprovedPreviewMutation(setup.options);
  assert.equal(report.applyAttempted, false);
  assert.equal(report.failureCategory, 'MIGRATION_LEDGER_CHANGED_DURING_PREFLIGHT');
  assert.equal(setup.calls.includes('apply'), false);
});
test('candidate matcher recognizes a single pinned source without exposing checksum material', () => {
  const result = classifyCandidateMatches(ledgerRows(), candidateSet(), manifest.canonicalCandidates.map((item) => item.name));
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 18);
  assert.ok(result.results.every((item) => item.classification === 'MATCH_ORIGINAL'));
  assert.equal(JSON.stringify(result).includes('a'.repeat(64)), false);
});

test('SQL-safe LF-to-CRLF candidate is derived deterministically and only accepted by exact byte digest', () => {
  const lf = Buffer.from('-- pinned source\nCREATE TABLE sample (id integer);\n', 'utf8');
  const crlf = safeCrlfCandidate(lf);
  assert.ok(crlf);
  assert.equal(crlf.toString('utf8').replace(/\r\n/g, '\n'), lf.toString('utf8'));
  assert.equal(safeCrlfCandidate(crlf), null);
  const variants = candidateVariants({ bytes: lf, blob: '1'.repeat(40), label: 'MATCH_ORIGINAL', commit: '2'.repeat(40) }, manifest);
  assert.equal(variants.length, 2);
  assert.equal(variants[1].label, 'MATCH_ORIGINAL_CRLF');
  assert.equal(variants[1].transform, 'LF_TO_CRLF_SQL_SAFE');

  const name = manifest.canonicalCandidates[0].name;
  const candidates = new Map([[name, [
    { blob: '1'.repeat(40), digest: digest(lf), label: 'MATCH_ORIGINAL', bytes: lf },
    { blob: '1'.repeat(40), digest: digest(crlf), label: 'MATCH_ORIGINAL_CRLF', bytes: crlf },
  ]]]);
  const row = { ...ledgerRows()[0], checksum: digest(crlf) };
  const result = classifyCandidateMatches([row], candidates, [name]);
  assert.equal(result.ok, true);
  assert.equal(result.results[0].classification, 'MATCH_ORIGINAL_CRLF');
  assert.equal(JSON.stringify(result).includes(digest(crlf)), false);
});

test('line-ending candidate is refused when newlines occur in SQL literals, quoted identifiers, dollar blocks, or COPY data', () => {
  const quotedInputs = [
    "INSERT INTO sample VALUES ('first line\nsecond line');\n",
    "INSERT INTO sample VALUES (E'first\\\nsecond');\n",
    'CREATE TABLE sample ("first\nsecond" text);\n',
    'DO $$ BEGIN\n  PERFORM 1;\nEND $$;\n',
  ];
  for (const input of quotedInputs) {
    assert.equal(hasNewlineInsideSqlQuotedConstruct(input), true);
    assert.equal(safeCrlfCandidate(Buffer.from(input, 'utf8')), null);
  }
  const copyInput = 'COPY sample FROM STDIN;\nrow\n\\.\n';
  assert.equal(hasNewlineInsideSqlQuotedConstruct(copyInput), false);
  assert.equal(safeCrlfCandidate(Buffer.from(copyInput, 'utf8')), null);
});

test('candidate matcher fails closed for no match, duplicate ledger rows, incomplete row, and ambiguous source blobs', () => {
  const names = [manifest.canonicalCandidates[0].name];
  assert.equal(classifyCandidateMatches(ledgerRows('b'.repeat(64)), candidateSet(), names).results[0].classification, 'NO_MATCH');

  const rows = ledgerRows();
  assert.equal(classifyCandidateMatches([rows[0], rows[0]], candidateSet(), names).results[0].classification, 'AMBIGUOUS');

  assert.equal(classifyCandidateMatches([{ ...rows[0], finished_at: null }], candidateSet(), names).results[0].classification, 'FAILED_OR_INCOMPLETE');

  const ambiguous = candidateSet();
  ambiguous.set(names[0], [
    { blob: '1'.repeat(40), digest: 'a'.repeat(64), label: 'MATCH_ORIGINAL', bytes: Buffer.from('one') },
    { blob: '2'.repeat(40), digest: 'a'.repeat(64), label: 'MATCH_RECONCILED_VERSION', bytes: Buffer.from('two') },
  ]);
  assert.equal(classifyCandidateMatches([rows[0]], ambiguous, names).results[0].classification, 'AMBIGUOUS');
});

test('target/predecessor ledger state is reported safely and any existing row fails closed', () => {
  const pred = EXPECTED_PENDING[0];
  const target = EXPECTED_PENDING[1];
  assert.deepEqual(inspectPendingMigrationRecords(ledgerRows()), { predecessor: 'ABSENT', target: 'ABSENT' });

  const completed = { migration_name: pred, checksum: 'c'.repeat(64), started_at: new Date(), finished_at: new Date(), rolled_back_at: null };
  assert.deepEqual(inspectPendingMigrationRecords([...ledgerRows(), completed]), { predecessor: 'COMPLETED', target: 'ABSENT' });
  assert.deepEqual(
    inspectPendingMigrationRecords([...ledgerRows(), { ...completed, migration_name: target, finished_at: null }]),
    { predecessor: 'ABSENT', target: 'FAILED_OR_INCOMPLETE' },
  );
  assert.deepEqual(inspectPendingMigrationRecords([...ledgerRows(), completed, completed]), { predecessor: 'DUPLICATE', target: 'ABSENT' });
  assert.deepEqual(inspectPendingMigrationRecords([...ledgerRows(), { ...completed, rolled_back_at: new Date() }]), { predecessor: 'ROLLED_BACK', target: 'ABSENT' });

  assert.throws(
    () => assertPendingMigrations([...ledgerRows(), completed]),
    (error) => error.safeCategory === 'PREDECESSOR_OR_TARGET_LEDGER_PRESENT',
  );
});

test('Prisma status accepts only the exact ordered pending pair or an up-to-date state', () => {
  assert.equal(classifyPrismaStatus(statusOutput()), 'EXACTLY_PENDING_001_THEN_002');
  assert.equal(classifyPrismaStatus(statusOutput([EXPECTED_PENDING[1], EXPECTED_PENDING[0]])), 'OTHER_PENDING_MIGRATIONS');
  assert.equal(classifyPrismaStatus(statusOutput([...EXPECTED_PENDING, '202611010001_unexpected'])), 'OTHER_PENDING_MIGRATIONS');
  assert.equal(classifyPrismaStatus({ status: 0, stdout: 'Database schema is up to date!', stderr: '' }), 'UP_TO_DATE');
  assert.equal(classifyPrismaStatus({ status: 1, stdout: 'P3009 failed migration', stderr: '' }), 'HISTORY_DIVERGED');
});

test('reconciliation invariant rejects any unexplained history before migration', () => {
  assert.equal(assertReconciliationPlan(plan()), true);
  assert.equal(assertReconciliationPlan(plan({ historyExplained: 'NO' })), false);
  assert.equal(assertReconciliationPlan(plan({ predecessorSchema: 'PREDECESSOR_SCHEMA_PARTIAL' })), false);
  assert.equal(assertReconciliationPlan(plan({ gpsOnlyUat: 'UNKNOWN' })), false);
});

test('workflow stops before apply on candidate mismatch and never emits DB or checksum values', async () => {
  const setup = runOptions({ loadCandidates: async () => ({ canonical: candidateSet('a'.repeat(64)), historicalPreview: [] }) });
  setup.options.readLedger = async () => ledgerRows('b'.repeat(64));
  setup.options.env.DATABASE_URL = 'postgresql://user:private-secret@host/db';
  const report = await runApprovedPreviewMutation(setup.options);
  assert.equal(report.applyAttempted, false);
  assert.equal(report.failureCategory, 'CANONICAL_HISTORY_CANDIDATE_MISMATCH');
  assert.equal(setup.calls.includes('apply'), false);
  const output = setup.calls.join('\n');
  assert.equal(output.includes('private-secret'), false);
  assert.equal(output.includes('a'.repeat(64)), false);
  assert.equal(output.includes('b'.repeat(64)), false);
  assert.equal(output.includes('MIGRATION_APPLY_ATTEMPTED=NO'), true);
});

test('unexpected predecessor/target ledger record is summarized without mutation or checksum disclosure', async () => {
  const setup = runOptions();
  const pred = EXPECTED_PENDING[0];
  const row = { migration_name: pred, checksum: 'f'.repeat(64), started_at: new Date(), finished_at: new Date(), rolled_back_at: null, applied_steps_count: 1 };
  setup.options.readLedger = async () => [...ledgerRows(), row];
  const report = await runApprovedPreviewMutation(setup.options);
  assert.equal(report.predecessorLedgerBeforeApply, 'COMPLETED');
  assert.equal(report.targetLedgerBeforeApply, 'ABSENT');
  assert.equal(report.failureCategory, 'PREDECESSOR_OR_TARGET_LEDGER_PRESENT');
  assert.equal(report.applyAttempted, false);
  assert.equal(setup.calls.includes('reconcile'), false);
  assert.equal(setup.calls.includes('apply'), false);
  const output = setup.calls.join('\n');
  assert.match(output, /PREDECESSOR_LEDGER_BEFORE_APPLY=COMPLETED/);
  assert.equal(output.includes('f'.repeat(64)), false);
});

test('ephemeral migration source build failures receive a safe category', async () => {
  const setup = runOptions({ buildBundle: async () => { throw new Error('private path and connection text'); } });
  const report = await runApprovedPreviewMutation(setup.options);
  assert.equal(report.ephemeralSource, 'FAIL');
  assert.equal(report.failureCategory, 'EPHEMERAL_SOURCE_BUILD_FAILED');
  assert.equal(report.applyAttempted, false);
  const output = setup.calls.join('\n');
  assert.equal(output.includes('private path'), false);
  assert.equal(output.includes('connection text'), false);
});

test('workflow applies exactly once only after two stable read-only passes and exact pending status', async () => {
  const setup = runOptions();
  const report = await runApprovedPreviewMutation(setup.options);
  assert.equal(report.phaseA, 'PASS');
  assert.equal(report.applyAttempted, true);
  assert.equal(report.applyResult, 'SUCCESS');
  assert.equal(report.iphoneUiGateReady, 'YES');
  assert.equal(setup.calls.filter((call) => call === 'apply').length, 1);
  assert.equal(setup.calls.filter((call) => call === 'read').length, 2);
  const applyIndex = setup.calls.indexOf('apply');
  const lastGuardIndex = setup.calls.lastIndexOf('guard', applyIndex);
  assert.ok(lastGuardIndex >= 0 && lastGuardIndex < applyIndex);
  assert.equal(setup.calls.slice(lastGuardIndex + 1, applyIndex).some((call) => call === 'read' || call === 'reconcile'), false);
  assert.equal(setup.calls.includes('post'), true);
});

test('failed preflight and failed migration each stop without retry', async () => {
  const preflight = runOptions({ reconcile: async () => plan({ migrationPlan: 'MIGRATION_HISTORY_RECOVERY_REQUIRED' }) });
  const preflightReport = await runApprovedPreviewMutation(preflight.options);
  assert.equal(preflightReport.applyAttempted, false);
  assert.equal(preflight.calls.includes('apply'), false);

  const failedApply = runOptions();
  failedApply.options.apply = () => { failedApply.calls.push('apply'); return { status: 1, stdout: '', stderr: 'P3018' }; };
  const failedReport = await runApprovedPreviewMutation(failedApply.options);
  assert.equal(failedReport.applyAttempted, true);
  assert.equal(failedReport.applyResult, 'FAILED');
  assert.equal(failedApply.calls.filter((call) => call === 'apply').length, 1);
  assert.equal(failedApply.calls.includes('post'), false);
  assert.equal(safeApplyFailure({ status: 1, stderr: 'P3018 migration failed' }), 'MIGRATION_FAILED_OR_PARTIAL');
});

test('protected workflow runs only from main in Preview Environment and contains no ledger repair or schema push', () => {
  assert.match(workflow, /environment:\n\s+name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /apply-reconciled-preview-g06-migrations\.js/);
  assert.match(workflow, /predecessor_ledger_before_apply/);
  assert.match(workflow, /target_ledger_before_apply/);
  assert.match(workflow, /ephemeral_source/);
  assert.doesNotMatch(workflow, /prisma\s+migrate\s+resolve/i);
  assert.doesNotMatch(workflow, /prisma\s+db\s+push/i);
  assert.match(workflow, /APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT/);
  const jobEnv = workflow.match(/jobs:\n\s+migrate:[\s\S]*?\n\s+env:\n([\s\S]*?)\n\s+steps:/)?.[1] || '';
  assert.doesNotMatch(jobEnv, /DATABASE_URL:|DIRECT_URL:/);
  assert.equal((workflow.match(/^\s*(?:DATABASE_URL|DIRECT_URL):\s+\$\{\{\s*secrets\.(?:DATABASE_URL|DIRECT_URL)\s*\}\}/gm) || []).length, 4);
});

test('candidate manifest pins names and immutable Git sources, never database ledger values', () => {
  assert.equal(manifest.canonicalCandidates.length, 18);
  assert.equal(manifest.historicalPreviewMigrations.length, 2);
  assert.deepEqual(manifest.candidateTransforms, ['IDENTITY', 'LF_TO_CRLF_SQL_SAFE']);
  for (const item of [...manifest.canonicalCandidates, ...manifest.historicalPreviewMigrations]) {
    assert.match(item.commit, /^[0-9a-f]{40}$/);
    assert.match(item.blob, /^[0-9a-f]{40}$/);
    assert.equal(Object.hasOwn(item, 'checksum'), false);
  }
});
