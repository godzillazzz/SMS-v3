'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BASELINE_ALLOWLIST,
  CORRECTED_FIRST_PENDING,
  FORBIDDEN_RESOLVE_MIGRATIONS,
  RECONCILED_PREDECESSOR,
  fileSha256,
  hasDataStatements,
  verifyManifest,
  verifyManifestOrdering,
  verifyManifestProvenance,
} = require('../scripts/ci/verify-preview-baseline-manifest');
const {
  ATTENDANCE_EVENT_WORKFLOW_CONTRACT,
  EXPECTED,
  FACE_EXPECTED_SEMANTICS,
  canonicalBooleanExpression,
  contractObjectCount,
  evaluateContract,
  evaluateFaceVerifiedStateSemantics,
  expectedCheckMatches,
  expectedForeignKeyMatches,
  expectedIndexMatches,
  normalizeSqlExpression,
  parseForeignKey,
  parseIndexDefinition,
  postgresCheckAccepts,
} = require('../scripts/ci/verify-preview-baseline-effects');
const {
  CHECKSUMS,
  postcondition,
  precondition,
} = require('../scripts/ci/verify-preview-baseline-ledger');
const { parseTarget, targetFingerprint } = require('../scripts/ci/verify-deployment-target');
const { verifyPreviewMigrationTarget } = require('../scripts/ci/verify-preview-migration-target');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'governance', 'preview-baseline-reconstruction-20260907.json');
const workflowPath = path.join(root, '.github', 'workflows', 'reconcile-approved-preview-baseline.yml');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const workflow = fs.readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');

test('manifest guard proves corrected provenance, exact checksums and ordered allowlist', () => {
  const result = verifyManifest({ cwd: root, log: () => {} });
  assert.deepEqual(result.baselineAllowlist, BASELINE_ALLOWLIST);
  assert.equal(BASELINE_ALLOWLIST[0], CORRECTED_FIRST_PENDING);
  assert.equal(BASELINE_ALLOWLIST.length, 10);
  const candidate = manifest.candidates.find((entry) => entry.migration_name === CORRECTED_FIRST_PENDING);
  assert.equal(candidate.eligible_for_resolve, true);
  assert.equal(candidate.diagnostic_evidence_run, '34089859937');
  assert.deepEqual(candidate.ledger_evidence, {
    checksum_match_source: true,
    finished: false,
    rolled_back: false,
    applied_steps_count: 0,
    state: 'FAILED',
  });
  assert.deepEqual(candidate.semantic_evidence, {
    expected_object_count: 52,
    matching_object_count_before_cast_normalization: 50,
    differing_object_count_before_cast_normalization: 2,
    missing_object_count: 0,
    differences: [
      'attendance_sessions_expectation_digest_format: PostgreSQL-added ::text cast only',
      'attendance_events_context_digest_format: PostgreSQL-added ::text cast only',
    ],
  });
});

test('run 34080212561 is authoritative only for 240003 and cannot be attributed to 240004', () => {
  const predecessor = manifest.reconciled_predecessors[0];
  assert.equal(predecessor.migration_name, RECONCILED_PREDECESSOR.migrationName);
  assert.equal(predecessor.resolve_run, RECONCILED_PREDECESSOR.resolveRun);
  assert.equal(predecessor.resolve_command_target, RECONCILED_PREDECESSOR.migrationName);
  assert.equal(predecessor.diagnostic_confirmation_run, RECONCILED_PREDECESSOR.diagnosticRun);
  assert.equal(predecessor.ledger_state, 'APPLIED_NOT_PENDING');

  const wrongName = structuredClone(manifest);
  wrongName.reconciled_predecessors[0].migration_name = CORRECTED_FIRST_PENDING;
  assert.throws(() => verifyManifestProvenance(wrongName), /migration-name attribution mismatch/);

  const wrongCandidate = structuredClone(manifest);
  wrongCandidate.candidates.find((entry) => entry.migration_name === CORRECTED_FIRST_PENDING).prior_resolve_run = '34080212561';
  assert.throws(() => verifyManifestProvenance(wrongCandidate), /cannot be attributed to 240004/);
});

test('ordered allowlist cannot skip unresolved earlier migration', () => {
  const copy = structuredClone(manifest);
  copy.baseline_allowlist = copy.baseline_allowlist.slice(1);
  assert.throws(() => verifyManifestOrdering(copy), /skips or reorders/);
});

test('data-bearing and genuinely pending migrations are excluded from resolve allowlist', () => {
  assert.ok(FORBIDDEN_RESOLVE_MIGRATIONS.every((name) => !BASELINE_ALLOWLIST.includes(name)));
  for (const entry of manifest.blocked_migrations) {
    assert.equal(entry.eligible_for_resolve, false);
    const migrationFile = path.join(root, 'prisma', 'migrations', entry.migration_name, 'migration.sql');
    assert.equal(hasDataStatements(fs.readFileSync(migrationFile, 'utf8')), entry.has_data_statements);
    if (entry.has_data_statements) assert.ok(!BASELINE_ALLOWLIST.includes(entry.migration_name));
  }
});

test('ledger checksums are canonical UTF-8/LF migration checksums for every allowlisted migration', () => {
  for (const name of BASELINE_ALLOWLIST) {
    const actual = fileSha256(path.join(root, 'prisma', 'migrations', name, 'migration.sql'));
    assert.equal(CHECKSUMS[name], actual, name);
  }
});

test('PostgreSQL CHECK normalization handles wrapper, nested parentheses and ::text', () => {
  const expected = { expression: "expectation_digest ~ '^[0-9a-f]{64}$'" };
  const actual = { definition: "CHECK (((expectation_digest ~ '^[0-9a-f]{64}$'::text)))" };
  assert.equal(expectedCheckMatches(actual, expected), true);
  assert.equal(
    canonicalBooleanExpression('CHECK (((a IS NOT NULL) AND ((b IS NULL))))'),
    canonicalBooleanExpression('a IS NOT NULL AND b IS NULL'),
  );
});

test('PostgreSQL CHECK normalization treats IN/ANY and NOT IN/ALL as equivalent', () => {
  assert.equal(
    normalizeSqlExpression("status = ANY (ARRAY['CERTIFIED'::text, 'UNLOCKED'::text]::text[])"),
    normalizeSqlExpression("status IN ('CERTIFIED', 'UNLOCKED')"),
  );
  assert.equal(
    normalizeSqlExpression("status <> ALL (ARRAY['VERIFIED'::text, 'CONSUMED'::text]::text[])"),
    normalizeSqlExpression("status NOT IN ('VERIFIED', 'CONSUMED')"),
  );
});

test('exact expected Face expression equals pg_get_constraintdef-style CHECK(((...))) rendering', () => {
  const actual = `CHECK (((status <> ALL (ARRAY['VERIFIED'::text, 'CONSUMED'::text]::text[])) OR (((device_proof_verified_at IS NOT NULL) AND (verified_at IS NOT NULL) AND (face_match_passed IS TRUE)) AND ((((verification_mode = 'FACE_MATCH_WITH_LIVENESS'::text) AND (pad_passed IS TRUE) AND (injection_risk_detected IS FALSE)) OR ((verification_mode = 'FACE_MATCH_ONLY'::text) AND (pad_passed IS NULL) AND (injection_risk_detected IS NULL)))))))`;
  const proof = evaluateFaceVerifiedStateSemantics(actual);
  assert.equal(proof.rowsEvaluated, 1728);
  assert.equal(proof.notWeaker, true);
  assert.equal(proof.equivalent, true);
});

test('Face verifier rejects weaker constraint and distinguishes stronger non-equivalent constraint', () => {
  const weaker = `CHECK (status NOT IN ('VERIFIED','CONSUMED') OR face_match_passed IS TRUE)`;
  const weakProof = evaluateFaceVerifiedStateSemantics(weaker);
  assert.equal(weakProof.notWeaker, false);
  assert.equal(weakProof.equivalent, false);

  const stronger = `CHECK ((${FACE_EXPECTED_SEMANTICS}) AND status <> 'PENDING')`;
  const strongProof = evaluateFaceVerifiedStateSemantics(stronger);
  assert.equal(strongProof.notWeaker, true);
  assert.equal(strongProof.equivalent, false);
  assert.equal(strongProof.strongerButNotEquivalent, true);
});

test('Face CHECK rejects missing proof fields and incorrect FACE_MATCH_ONLY branch', () => {
  const base = {
    status: 'verified',
    verification_mode: 'face_match_only',
    device_proof_verified_at: 'ts',
    verified_at: 'ts',
    face_match_passed: true,
    pad_passed: null,
    injection_risk_detected: null,
  };
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, base), true);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, device_proof_verified_at: null }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, verified_at: null }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, face_match_passed: false }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, pad_passed: true }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, injection_risk_detected: false }), false);
});

test('Face CHECK rejects incorrect FACE_MATCH_WITH_LIVENESS branch', () => {
  const base = {
    status: 'consumed',
    verification_mode: 'face_match_with_liveness',
    device_proof_verified_at: 'ts',
    verified_at: 'ts',
    face_match_passed: true,
    pad_passed: true,
    injection_risk_detected: false,
  };
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, base), true);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, pad_passed: null }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, pad_passed: false }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, injection_risk_detected: true }), false);
  assert.equal(postgresCheckAccepts(FACE_EXPECTED_SEMANTICS, { ...base, injection_risk_detected: null }), false);
});

test('Face-security proof is independent from unrelated migration-contract failures', () => {
  const logs = [];
  assert.throws(() => evaluateContract('202608250001_g06_face_match_only_mode_v1', {
    tableRows: [],
    columnRows: [],
    indexRows: [],
    enumRows: [],
    rlsRows: [],
    grantRows: [],
    policyRows: [],
    constraintRows: [{
      table_name: 'face_verification_sessions',
      conname: 'face_verification_sessions_verified_state_check',
      definition: `CHECK ((${FACE_EXPECTED_SEMANTICS}))`,
    }],
  }, (line) => logs.push(line)), /semantic effect verification failed/);
  assert.ok(logs.includes('FACE_VERIFIED_STATE_TRUTH_TABLE_ROWS=1728'));
  assert.ok(logs.includes('FACE_VERIFIED_STATE_NOT_WEAKER=YES'));
  assert.ok(logs.includes('FACE_VERIFIED_STATE_EQUIVALENT=YES'));
});

test('240004 contract covers all 52 objects and both digest CHECK cast-normalization cases', () => {
  assert.equal(EXPECTED['202608240004_g06_attendance_event_workflow_v1'], ATTENDANCE_EVENT_WORKFLOW_CONTRACT);
  assert.equal(contractObjectCount(ATTENDANCE_EVENT_WORKFLOW_CONTRACT), 52);
  const sessionsDigest = ATTENDANCE_EVENT_WORKFLOW_CONTRACT.checks.find((item) => item.name === 'attendance_sessions_expectation_digest_format');
  const eventsDigest = ATTENDANCE_EVENT_WORKFLOW_CONTRACT.checks.find((item) => item.name === 'attendance_events_context_digest_format');
  assert.equal(expectedCheckMatches({ definition: "CHECK ((expectation_digest ~ '^[0-9a-f]{64}$'::text))" }, sessionsDigest), true);
  assert.equal(expectedCheckMatches({ definition: "CHECK ((context_digest ~ '^[0-9a-f]{64}$'::text))" }, eventsDigest), true);
});

test('partial unique-index equivalence compares uniqueness, columns and predicate', () => {
  const actual = parseIndexDefinition('CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = true)');
  assert.equal(actual.unique, true);
  assert.equal(expectedIndexMatches({ indexdef: 'CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = true)' }, {
    unique: true,
    columns: ['department_name'],
    predicate: 'is_default = TRUE',
  }), true);
  assert.equal(expectedIndexMatches({ indexdef: 'CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = false)' }, {
    unique: true,
    columns: ['department_name'],
    predicate: 'is_default = TRUE',
  }), false);
});

test('foreign-key equivalence rejects action mismatch', () => {
  const actual = { definition: 'FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE RESTRICT' };
  const expected = { columns: ['employee_id'], refTable: 'employees', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
  assert.deepEqual(parseForeignKey(actual.definition), expected);
  assert.equal(expectedForeignKeyMatches(actual, expected), true);
  assert.equal(expectedForeignKeyMatches({ definition: 'FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE' }, expected), false);
});

test('RLS and grant mismatches still fail the exact final-state contract', () => {
  assert.throws(() => evaluateContract('202608270004_attendance_face_evidence_rls_v1', {
    tableRows: [{ table_name: 'attendance_evidence' }],
    columnRows: [], constraintRows: [], indexRows: [], enumRows: [],
    rlsRows: [{ table_name: 'attendance_evidence', relrowsecurity: true, relforcerowsecurity: true }],
    grantRows: [], policyRows: [{ table_name: 'attendance_evidence', policy_count: 0 }],
  }), /semantic effect verification failed/);
  assert.throws(() => evaluateContract('202608270004_attendance_face_evidence_rls_v1', {
    tableRows: [{ table_name: 'attendance_evidence' }],
    columnRows: [], constraintRows: [], indexRows: [], enumRows: [],
    rlsRows: [{ table_name: 'attendance_evidence', relrowsecurity: true, relforcerowsecurity: false }],
    grantRows: [{ table_name: 'attendance_evidence', grantee: 'anon', privilege_type: 'SELECT' }],
    policyRows: [{ table_name: 'attendance_evidence', policy_count: 0 }],
  }), /semantic effect verification failed/);
});

test('ledger precondition rejects partial failed rows and postcondition requires every allowlisted row', () => {
  const failedRows = BASELINE_ALLOWLIST.map((migration_name, index) => ({
    id: String(index),
    migration_name,
    checksum: CHECKSUMS[migration_name],
    started_at: null,
    finished_at: null,
    rolled_back_at: null,
    applied_steps_count: index === 0 ? 1 : 0,
  }));
  assert.throws(() => precondition(failedRows, () => {}), /partial failed steps/);

  const before = BASELINE_ALLOWLIST.map((migration_name, index) => ({
    id: String(index),
    migration_name,
    checksum: CHECKSUMS[migration_name],
    started_at: null,
    finished_at: null,
    rolled_back_at: null,
    applied_steps_count: 0,
  }));
  const after = before.map((row) => ({
    ...row,
    finished_at: '2026-09-07T00:00:00.000Z',
    applied_steps_count: 1,
  }));
  assert.equal(postcondition(before, after, () => {}), true);
  assert.throws(() => postcondition(before, after.slice(1), () => {}), /not applied/);
});

test('Preview target guard rejects Production fingerprint reuse', () => {
  const databaseUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
  const directUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
  const fingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));
  assert.throws(() => verifyPreviewMigrationTarget({
    env: {
      VERCEL_ENV: 'preview',
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint,
      APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT: fingerprint,
    },
    log: () => {},
  }), /distinct/);
});

test('workflow is protected, hardcoded, repository-ordered and has no generic repair path', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /verify-preview-baseline-effects\.js/);
  assert.match(workflow, /verify-preview-baseline-ledger\.js --mode=pre/);
  assert.doesNotMatch(workflow, /verify-preview-baseline-effects-v1-reference\.js/);
  const resolveNames = [...workflow.matchAll(/prisma migrate resolve --applied ([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual(resolveNames, BASELINE_ALLOWLIST);
  assert.equal(resolveNames.length, 10);
  assert.ok(FORBIDDEN_RESOLVE_MIGRATIONS.every((name) => !resolveNames.includes(name)));
  assert.doesNotMatch(workflow, /inputs\.migration|prisma\s+migrate\s+(?:deploy|reset)|--rolled-back|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b|db:seed|prisma\s+db\s+push/i);
  assert.match(workflow, /MIGRATION_DEPLOY_EXECUTED=NO/);
  assert.match(workflow, /BASELINE_RECONSTRUCTION_POSTCHECK=PASS/);
});

test('partial semantic preflight failure implies zero resolve commands can execute', () => {
  const effectPosition = workflow.indexOf('node scripts/ci/verify-preview-baseline-effects.js');
  const ledgerPosition = workflow.indexOf('verify-preview-baseline-ledger.js --mode=pre');
  const firstResolvePosition = workflow.indexOf('prisma migrate resolve --applied');
  assert.ok(effectPosition >= 0);
  assert.ok(ledgerPosition > effectPosition);
  assert.ok(firstResolvePosition > ledgerPosition);
  assert.doesNotMatch(workflow.slice(0, firstResolvePosition), /prisma migrate resolve --applied/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/i);
});

test('workflow does not print database secrets or raw connection values', () => {
  assert.doesNotMatch(workflow, /echo\s+.*\$\{?DATABASE_URL/i);
  assert.doesNotMatch(workflow, /echo\s+.*\$\{?DIRECT_URL/i);
  assert.doesNotMatch(workflow, /printenv|env\s*\|/i);
});
