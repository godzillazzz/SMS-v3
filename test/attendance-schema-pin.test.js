'use strict';
// Release-control contract: one reviewed attendance schema pin, fail-closed in every plane.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = 'prisma/schema.prisma';
const PIN_FILE = 'scripts/ci/attendance-schema-pin.js';
const CANDIDATES_FILE = 'scripts/ci/g06-production-migration-candidates.json';
const ATP_WORKFLOW = '.github/workflows/apply-approved-attendance-time-policy-production-migration.yml';
const DEPLOY_WORKFLOW = '.github/workflows/deploy-approved-production-v2.yml';
const RETIRED_SOURCE_SHA = '500aaa53d60d6835cccec16c79ca25de00ab06c6';
const REVIEWED_HISTORY_SHA = 'ce721ee780e105b64e2d9c9fd59beaf31dba4eec';
const PIN_UPDATE_INSTRUCTION = 'prisma/schema.prisma changed: update ATTENDANCE_SCHEMA_SHA256 in '
  + 'scripts/ci/attendance-schema-pin.js together with its governed evidence and tests in the same governed commit';

const {
  ATTENDANCE_SCHEMA_SHA256, SCHEMA_PIN_MISMATCH, assertAttendanceSchemaPin, attendanceSchemaDigest, isAttendanceSchemaPinError,
} = require('../scripts/ci/attendance-schema-pin');
const reconciliation = require('../scripts/ci/reconcile-production-attendance-migrations');
const preapplied = require('../scripts/ci/verify-preapplied-attendance-policy-readonly');
const { PREDECESSOR, TARGET } = require('../scripts/ci/verify-attendance-time-policy-production-migration');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Reporter-agnostic summary parsing: Node prints TAP on non-TTY stdout (CI) and spec otherwise.
function reportedCount(output, label) {
  const match = String(output).match(new RegExp(`^(?:ℹ|#) ${label} (\\d+)$`, 'm'));
  return match ? Number(match[1]) : null;
}
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitShow = (sha, file) => execFileSync('git', ['show', `${sha}:${file}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const readRepoFile = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const HEAD_SHA = git('rev-parse', 'HEAD');
const HEAD_TREE = git('rev-parse', 'HEAD^{tree}');
const retiredSchema = gitShow(RETIRED_SOURCE_SHA, SCHEMA_PATH);
const retiredDigest = digest(retiredSchema);

// The workflow copies from the dispatched control-plane SHA. In a clean exact-SHA checkout the
// working tree is that content, so the simulation copies the reviewed files under test.
function copiedBlob(relative) {
  return fs.readFileSync(path.join(ROOT, relative));
}

function trackedGrep(needle) {
  return spawnSync('git', ['grep', '-n', '-I', '-F', '--', needle], { cwd: ROOT, encoding: 'utf8' });
}

function cloneScratch(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sms-${label}-`));
  const clone = path.join(dir, 'clone');
  execFileSync('git', ['clone', '--quiet', '--shared', ROOT, clone], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return clone;
}

function reboundManifest() {
  const manifest = JSON.parse(readRepoFile(CANDIDATES_FILE));
  manifest.application = { sha: HEAD_SHA, tree: HEAD_TREE };
  return manifest;
}

function migrationNames() {
  const listed = execFileSync('git', ['ls-files', 'prisma/migrations'], { cwd: ROOT, encoding: 'utf8' });
  return new Set(listed.split('\n').filter((line) => line.endsWith('/migration.sql')).map((line) => line.split('/')[2]));
}
const MIGRATION_COUNT = migrationNames().size;

function codedPinRejection(error) {
  assert.equal(error.message, 'SCHEMA_PIN_MISMATCH');
  assert.equal(error.code, 'SCHEMA_PIN_MISMATCH');
  assert.equal(isAttendanceSchemaPinError(error), true);
  assert(!error.message.includes('/'), 'pin error must not leak a path');
  assert(!/[a-f0-9]{16,}/.test(error.message), 'pin error must not leak a digest');
  return true;
}

test('reviewed Prisma schema bytes match the single exported attendance pin', () => {
  const current = fs.readFileSync(path.join(ROOT, SCHEMA_PATH));
  assert.equal(digest(current), ATTENDANCE_SCHEMA_SHA256, PIN_UPDATE_INSTRUCTION);
  assert.equal(assertAttendanceSchemaPin(current), ATTENDANCE_SCHEMA_SHA256);
  assert.equal(digest(gitShow(REVIEWED_HISTORY_SHA, SCHEMA_PATH)), ATTENDANCE_SCHEMA_SHA256, PIN_UPDATE_INSTRUCTION);
});

test('retired and mutated schema bytes are rejected with one coded token and no digest, path or content', () => {
  assert.equal(SCHEMA_PIN_MISMATCH, 'SCHEMA_PIN_MISMATCH');
  for (const bytes of [retiredSchema, Buffer.from('// unreviewed schema edit\n'), '', null, 42]) {
    assert.throws(() => assertAttendanceSchemaPin(bytes), codedPinRejection);
  }
  assert.equal(attendanceSchemaDigest(Buffer.from('')), digest(Buffer.from('')));
});

test('tracked sources carry the reviewed digest exactly once, in the helper, and no retired digest', () => {
  const retired = trackedGrep(retiredDigest);
  assert.equal(retired.status, 1, 'retired schema digest must not appear in tracked files');
  assert.equal(String(retired.stdout).trim(), '');
  const hits = String(trackedGrep(ATTENDANCE_SCHEMA_SHA256).stdout).trim().split('\n').filter(Boolean);
  assert.equal(hits.length, 1, 'the reviewed pin must be written exactly once');
  assert.equal(hits[0].split(':')[0], PIN_FILE);
});

test('real repository source loads against the reviewed application HEAD and pin', () => {
  const sources = reconciliation.loadSources(ROOT, reboundManifest());
  assert(MIGRATION_COUNT >= 18);
  assert.equal(sources.canonical.size, MIGRATION_COUNT);
  assert(sources.canonical.has(PREDECESSOR) && sources.canonical.has(TARGET));
  assert.equal(sources.candidates.size >= MIGRATION_COUNT, true);
  assert.equal(sources.candidates.get(TARGET).length >= 1, true);
  assert.equal(digest(fs.readFileSync(path.join(ROOT, SCHEMA_PATH))), ATTENDANCE_SCHEMA_SHA256);
});

test('scratch copy with an unreviewed schema fails closed and never writes tracked source', (t) => {
  const scratch = cloneScratch(t, 'pin-scratch');
  const manifest = reboundManifest();
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim(), HEAD_SHA);
  // Unmutated scratch clone loads exactly like the reviewed repository.
  assert.equal(reconciliation.loadSources(scratch, manifest).canonical.size, MIGRATION_COUNT);
  fs.appendFileSync(path.join(scratch, SCHEMA_PATH), '\n// unreviewed schema edit\n');
  assert.throws(() => reconciliation.loadSources(scratch, manifest), codedPinRejection);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: scratch, encoding: 'utf8' }).trim(),
    `M ${SCHEMA_PATH}`, 'only the injected scratch edit may exist');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', SCHEMA_PATH], { cwd: ROOT, encoding: 'utf8' }).trim(), '',
    'the verified repository must stay unmodified');
});

test('coded pin failure through the real run and release wrapper is fail-closed and silent', async () => {
  const secret = 'postgresql://sentinel:sup3rsecret@10.9.8.7:5432/prod?sslmode=require';
  const counts = { created: 0, queries: 0, disconnects: 0, applies: 0 };
  const output = [];
  const log = (line) => output.push(String(line));
  const throwPin = () => assertAttendanceSchemaPin('unreviewed schema bytes');
  const clientFactory = () => {
    counts.created += 1;
    return { $disconnect: async () => { counts.disconnects += 1; }, meta: { code: secret } };
  };
  const baseOptions = {
    guard: async () => {},
    env: { SOURCE_SHA: HEAD_SHA, SOURCE_TREE: HEAD_TREE },
    manifest: { application: { sha: HEAD_SHA, tree: HEAD_TREE } },
    loadSources: throwPin,
    createClient: clientFactory,
    observe: async () => { counts.queries += 1; return { plan: 'PLAN_NO_DATABASE_CHANGE' }; },
    apply: () => { counts.applies += 1; return { status: 0 }; },
    log,
  };
  await assert.rejects(reconciliation.run(baseOptions), codedPinRejection);
  assert.deepEqual(counts, { created: 0, queries: 0, disconnects: 0, applies: 0 });
  const text = output.join('\n');
  assert(text.includes('PRODUCTION_RECONCILIATION_FAILURE_STAGE=PINNED_SOURCE_LOAD'));
  assert(text.includes('PRODUCTION_RECONCILIATION_FAILURE_CATEGORY=SCHEMA_PIN_MISMATCH'));
  assert(text.includes('DATABASE_MUTATION_ATTEMPTED=NO'));
  assert(!text.includes(secret));
  assert(!text.includes('TypeError'));
  assert(!text.includes(ROOT));
  assert(!text.includes('    at '));

  // The release wrapper runs the real reconciliation and only reports an allowlisted category.
  const runOptions = { guard: baseOptions.guard, manifest: baseOptions.manifest, loadSources: throwPin,
    createClient: clientFactory, observe: baseOptions.observe, apply: baseOptions.apply, log };
  let wrapperError;
  await assert.rejects(preapplied.verify({
    env: { TARGET_SHA: HEAD_SHA, TARGET_TREE: HEAD_TREE },
    run: (options) => reconciliation.run({ ...options, ...runOptions }),
  }), (error) => { wrapperError = error; return codedPinRejection(error); });
  assert.equal(preapplied.preappliedFailureCategory(wrapperError), 'SCHEMA_PIN_MISMATCH');
  assert.equal(preapplied.preappliedFailureCategory(new Error(secret)), 'INVARIANT_OR_QUERY_FAIL_CLOSED');
  assert.equal(preapplied.preappliedFailureCategory(Object.assign(new Error('permission denied'), { meta: { code: '42501' } })),
    'SCHEMA_READ_PERMISSION_DENIED');
  assert.equal(preapplied.preappliedFailureCategory(new Error('PREAPPLIED_SCHEMA_NOT_VALID')), 'PREAPPLIED_SCHEMA_NOT_VALID');
  assert.deepEqual(counts, { created: 0, queries: 0, disconnects: 0, applies: 0 });
  assert(Object.isFrozen(preapplied.PREAPPLIED_FAILURE_CATEGORIES));
  for (const category of preapplied.PREAPPLIED_FAILURE_CATEGORIES) {
    assert.match(category, /^[A-Z_]+$/, 'every reportable category is an allowlisted token');
  }
});

test('pre-applied wrapper entrypoint reports only the allowlisted failure category', () => {
  const source = readRepoFile('scripts/ci/verify-preapplied-attendance-policy-readonly.js');
  assert(source.includes("console.error('PREAPPLIED_FAILURE_CATEGORY=' + preappliedFailureCategory(error));"));
  assert(source.includes("console.error('PREAPPLIED_ATTENDANCE_POLICY=FAIL_CLOSED');"));
  assert(source.includes('PREAPPLIED_FAILURE_CATEGORIES.includes(message)'),
    'arbitrary error text must never be echoed');
});

test('retired ATP workflow applies the copied pin helper to its stale manifest source', () => {
  const workflow = readRepoFile(ATP_WORKFLOW);
  assert(workflow.includes('      - scripts/ci/attendance-schema-pin.js\n'), 'push paths must trigger on the pin');
  assert(workflow.includes('git cat-file -e "$GITHUB_SHA:scripts/ci/attendance-schema-pin.js"'));
  assert(workflow.includes('git show "$GITHUB_SHA:scripts/ci/attendance-schema-pin.js" >/tmp/attendance-schema-pin.js'));
  assert(workflow.includes("require('/tmp/attendance-schema-pin.js')"));
  assert(workflow.includes('assertAttendanceSchemaPin(schema)'));
  assert(workflow.indexOf('/tmp/attendance-schema-pin.js') < workflow.indexOf('node /tmp/reconcile-production-attendance-migrations.js'),
    'the helper must be copied before the reconciliation module runs');
  assert(!workflow.includes(retiredDigest), 'the retired inline digest must be gone');
  assert(!workflow.includes(ATTENDANCE_SCHEMA_SHA256), 'the pin lives only in the helper');
  // Owner/migration gates are unchanged and still ordered before any mutation.
  assert(workflow.includes('name: production-sms-v3-staging'));
  assert(workflow.indexOf('Verify Production database target guard') < workflow.indexOf('Inspect exact Production ledger'));
  assert(!/migrate resolve|db push|UAT_PASSWORD/.test(workflow));
});

test('the retired ATP checkout fails the workflow pin snippet before any database step', (t) => {
  const workflow = readRepoFile(ATP_WORKFLOW);
  const blocks = workflow.split("node - <<'NODE'").slice(1);
  const block = blocks.find((part) => part.includes('assertAttendanceSchemaPin(schema)'));
  assert(block, 'the ATP revalidation step must use the copied pin helper');
  const body = block.split('\n          NODE')[0].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
  assert(body.includes("require('/tmp/attendance-schema-pin.js')"));
  const snippet = body.replace("require('/tmp/attendance-schema-pin.js')",
    `require(${JSON.stringify(path.join(ROOT, PIN_FILE))})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-atp-stale-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true });
  fs.writeFileSync(path.join(dir, SCHEMA_PATH), retiredSchema);
  const result = spawnSync(process.execPath, ['-e', snippet], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'the retired manifest source must fail closed');
  assert(output.includes('PRISMA_SCHEMA_PIN=SCHEMA_PIN_MISMATCH'), output);
  assert(!output.includes('PRISMA_MAPPING_NATIVE_TIMESTAMP=PASS'));
  assert(!output.includes('    at '), 'the step must not print a stack trace');
});

test('deploy workflow packages the same reviewed pin blob for both database policies', () => {
  const workflow = readRepoFile(DEPLOY_WORKFLOW);
  assert(workflow.includes('git rev-parse "$TARGET_SHA:scripts/ci/attendance-schema-pin.js"'));
  assert(workflow.includes('git rev-parse "$GITHUB_SHA:scripts/ci/attendance-schema-pin.js"'));
  assert(workflow.includes('verify-preapplied-attendance-policy-readonly.js attendance-schema-pin.js'),
    'PRE_APPLIED must copy the helper into /tmp');
  assert(/git diff --quiet "\$EVIDENCE_HEAD" "\$GITHUB_SHA" -- [^\n]*scripts\/ci\/attendance-schema-pin\.js/.test(workflow),
    'PRE_APPLIED evidence quiet-diff must cover the helper');
  const unchanged = workflow.split('      - name: Revalidate unchanged Attendance schema read-only')[1]
    .split('      - name: Revalidate pre-applied Production database state')[0];
  assert(unchanged.includes('test -f scripts/ci/attendance-schema-pin.js'),
    'NO_DATABASE_CHANGES must load the helper from the checked-out TARGET source');
  assert(unchanged.includes('node scripts/ci/verify-preapplied-attendance-policy-readonly.js'));
  assert(!unchanged.includes('/tmp/reconcile-production-attendance-migrations.js'));
  assert(!workflow.includes(retiredDigest));
});

test('modules copied into one /tmp directory resolve the pin helper from that same source', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-atp-tmp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const copied = ['verify-approved-production-migration.js', 'verify-attendance-time-policy-production-migration.js',
    'reconcile-production-attendance-migrations.js', 'attendance-schema-pin.js',
    'verify-g06-simple-attendance-production-migration.js', 'g06-production-migration-candidates.json'];
  for (const file of copied) fs.writeFileSync(path.join(dir, file), copiedBlob(`scripts/ci/${file}`));
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = ${JSON.stringify(dir)};
    const reconcile = require(path.join(dir, 'reconcile-production-attendance-migrations.js'));
    const pin = require(path.join(dir, 'attendance-schema-pin.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'g06-production-migration-candidates.json'), 'utf8'));
    manifest.application = { sha: ${JSON.stringify(HEAD_SHA)}, tree: ${JSON.stringify(HEAD_TREE)} };
    const sources = reconcile.loadSources(${JSON.stringify(ROOT)}, manifest);
    process.stdout.write('TMP_COPY_MODULE_LOAD=' + (typeof reconcile.loadSources === 'function' ? 'PASS' : 'FAIL') + '\\n');
    process.stdout.write('TMP_COPY_PIN_LOAD=' + (pin.assertAttendanceSchemaPin(fs.readFileSync(${JSON.stringify(path.join(ROOT, SCHEMA_PATH))})) === pin.ATTENDANCE_SCHEMA_SHA256 ? 'PASS' : 'FAIL') + '\\n');
    let retired = 'FAIL';
    try { pin.assertAttendanceSchemaPin(Buffer.from(${JSON.stringify(retiredSchema.toString('base64'))}, 'base64')); }
    catch (error) { if (error.code === 'SCHEMA_PIN_MISMATCH') retired = 'SCHEMA_PIN_MISMATCH'; }
    process.stdout.write('TMP_COPY_RETIRED_SOURCE=' + retired + '\\n');
    process.stdout.write('TMP_COPY_CANONICAL_COUNT=' + sources.canonical.size + '\\n');
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert(output.includes('TMP_COPY_MODULE_LOAD=PASS'));
  assert(output.includes('TMP_COPY_PIN_LOAD=PASS'));
  assert(output.includes('TMP_COPY_RETIRED_SOURCE=SCHEMA_PIN_MISMATCH'));
  assert(output.includes(`TMP_COPY_CANONICAL_COUNT=${MIGRATION_COUNT}`));
});

test('existing production reconciliation suite stays green with the lifecycle change', () => {
  const env = { ...process.env };
  // The parent test runner exports an IPC context; a nested runner needs its own reporter stream.
  delete env.NODE_TEST_CONTEXT;
  // Explicit reporter: Node picks TAP for non-TTY stdout, which would hide the summary counters.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'test/production-attendance-history-reconciliation.test.js'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000, env });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.equal(reportedCount(result.stdout, 'fail'), 0, output);
  assert(reportedCount(result.stdout, 'pass') > 0, output);
  const existing = readRepoFile('test/production-attendance-history-reconciliation.test.js');
  assert(existing.includes('sources:s,client:{}'), 'the injected sources/client seam fixtures stay unchanged');
});
