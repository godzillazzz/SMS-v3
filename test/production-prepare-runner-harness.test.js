'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/deploy-approved-production-v2.yml');
const trustedSha = '371138533fd9c6cb738fb45e0f59702946192267';
const sourceSha = '83fa98c9e9cd19fc09e27b5ad106d3eee9551442';
const rollbackId = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';
const manifestPath = '.github/releases/approved-attendance-selfie-policy-migration.json';
const recordPath = 'docs/releases/R8.4-attendance-selfie-policy-post-release-20261020.json';

function extractRunBlock(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const run = workflow.indexOf('        run: |\n', start);
  const end = workflow.indexOf('\n      - ', run + 1);
  return workflow.slice(run + '        run: |\n'.length, end === -1 ? workflow.length : end)
    .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}

function extractNodeHeredoc(workflow, stepName) {
  const block = extractRunBlock(workflow, stepName);
  const start = block.indexOf("node - \"$trusted\" <<'NODE'\n");
  assert.notEqual(start, -1, 'pre-gate trusted runner heredoc missing');
  const bodyStart = start + 'node - "$trusted" <<\'NODE\'\n'.length;
  const end = block.indexOf('\nNODE\n', bodyStart);
  assert.notEqual(end, -1, 'pre-gate trusted runner heredoc terminator missing');
  return block.slice(bodyStart, end);
}

function makeFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-prepare-harness-'));
  const checkout = path.join(workspace, 'checkout');
  const trusted = path.join(workspace, 'trusted');
  const output = path.join(workspace, 'output');
  const baselinePath = path.join(output, 'pre-applied-baseline-input.json');
  fs.mkdirSync(trusted, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(checkout, '.github/releases'), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'docs/releases'), { recursive: true });
  fs.copyFileSync(path.join(root, manifestPath), path.join(checkout, manifestPath));
  fs.copyFileSync(path.join(root, recordPath), path.join(checkout, recordPath));
  for (const file of ['trusted-production-baseline-collector.js', 'verify-pre-applied-migration-production-baseline.js']) {
    fs.writeFileSync(path.join(trusted, file), execFileSync('git', ['show', `${trustedSha}:scripts/ci/${file}`], { cwd: root }));
  }
  return { workspace, checkout, trusted, output, baselinePath };
}

function fetchPreload() {
  return `global.fetch = async (url) => {\n` +
`  const u = new URL(url);\n` +
`  if (u.hostname === 'api.vercel.com') throw new Error('Vercel request attempted');\n` +
`  if (u.hostname === 'api.github.com') {\n` +
`    const isStatus = u.pathname.endsWith('/statuses');\n` +
`    const rows = isStatus ? [{ state: 'success', created_at: '2026-10-20T04:00:00Z' }] : [{ id: 7191759699, sha: '${sourceSha}', environment: 'Production', created_at: '2026-10-20T03:00:00Z' }];\n` +
`    return new Response(JSON.stringify(rows), { status: 200, headers: { 'link': '' }});\n` +
`  }\n` +
`  if (u.hostname === 'sms-v3-staging-ten.vercel.app' && u.pathname === '/api/v1/health') return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });\n` +
`  if (u.hostname === 'sms-v3-staging-ten.vercel.app' && u.pathname === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });\n` +
`  throw new Error('unexpected URL: ' + url);\n` +
`};\n`;
}

async function runRunner({ fixture: suppliedFixture, mutate, removeRepositoryRoot = false, addVercelRequest = false } = {}) {
  const callerOwnsLifecycle = Boolean(suppliedFixture);
  const fixture = suppliedFixture || makeFixture();
  const { workspace, checkout, trusted, baselinePath, output } = fixture;
  try {
    fs.writeFileSync(path.join(checkout, 'preload.js'), fetchPreload());
    let runner = extractNodeHeredoc(fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n'), 'Verify pre-applied Production baseline before Owner gate');
    const sharedBaselineLiteral = '/tmp/' + 'pre-applied-baseline-input.json';
    runner = runner.replaceAll(sharedBaselineLiteral, 'process.env.BASELINE_INPUT_PATH');
    runner = runner.replace('input.invariantFingerprint = result.invariantFingerprint;', "input.invariantFingerprint = result.invariantFingerprint; fs.mkdirSync(path.dirname(process.env.BASELINE_INPUT_PATH), { recursive: true }); fs.writeFileSync(process.env.BASELINE_INPUT_PATH, JSON.stringify(input));");
    runner = `const baselineWorkspace = ${JSON.stringify(workspace)};\nconst baselineInputPath = process.env.BASELINE_INPUT_PATH;\nif (!baselineInputPath || !require('node:path').resolve(baselineInputPath).startsWith(require('node:path').resolve(baselineWorkspace) + require('node:path').sep)) throw new Error('baseline input path must be inside fixture workspace');\n` + runner;
    assert.match(runner, /process\.env\.BASELINE_INPUT_PATH/);
    assert.match(runner, /mkdirSync\(path\.dirname\(process\.env\.BASELINE_INPUT_PATH\)/);
    assert.doesNotMatch(runner, new RegExp(sharedBaselineLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (removeRepositoryRoot) runner = runner.replace(', { repositoryRoot: process.cwd() }', '');
    if (mutate) runner = mutate(runner);
    runner = runner.replace('})().catch(error =>', `})().then(() => { const guard = verifier.validateProductionBaseline(JSON.parse(fs.readFileSync(process.env.BASELINE_INPUT_PATH, 'utf8')), { repositoryRoot: process.cwd() }); process.stdout.write('PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=' + guard.mode + '\\n'); }).catch(error =>`);
    if (addVercelRequest) runner += `\ntrusted.collectVercel({ request, token: 'unexpected', teamId: 'team_fixture', projectId: 'prj_fixture', deploymentId: '${rollbackId}', canonicalUrl: process.env.CANONICAL_URL });\n`;
    const childEnv = { ...process.env, BASELINE_INPUT_PATH: baselinePath, GITHUB_OUTPUT: path.join(output, 'github-output'), CURRENT_PRODUCTION_SOURCE_SHA: sourceSha, ROLLBACK_DEPLOYMENT_ID: rollbackId, CURRENT_PRODUCTION_POST_RELEASE_RECORD: recordPath, CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app', GITHUB_REPOSITORY: 'godzillazzz/SMS-v3', GH_TOKEN: 'test-token' };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', path.join(checkout, 'preload.js'), '-', trusted], { cwd: checkout, env: childEnv });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, signal: null, stdout, stderr }));
      child.stdin.end(runner);
    });
    const resolvedBaselinePath = path.resolve(childEnv.BASELINE_INPUT_PATH);
    assert.equal(resolvedBaselinePath.startsWith(`${path.resolve(workspace)}${path.sep}`), true);
    return callerOwnsLifecycle ? { result, fixture } : result;
  } finally {
    if (!callerOwnsLifecycle) fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test('PREPARE runner harness executes extracted trusted code through the Owner-gate boundary', async () => {
  const fixture = makeFixture();
  try {
    const { result } = await runRunner({ fixture });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PRE_GATE_BASELINE=SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE/);
    assert.match(result.stdout, /PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE/);
    assert.match(result.stdout, /INVARIANT_FINGERPRINT=[0-9a-f]{64}/);
    assert.equal(result.stderr, '', result.stderr);
    assert.ok(fs.existsSync(path.join(fixture.checkout, '.github/releases/approved-attendance-selfie-policy-migration.json')));
    assert.ok(fs.existsSync(path.join(fixture.checkout, recordPath)));
    assert.ok(fs.existsSync(fixture.baselinePath));
  } finally {
    fs.rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test('PREPARE harness mutation proofs fail closed', async () => {
  for (const options of [{ removeRepositoryRoot: true }, { mutate: source => source.replace("vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT'", "vercelCanonicalIdentity: 'VERIFIED_IN_PROTECTED_ENVIRONMENT'") }, { mutate: source => source.replace('rollbackDeploymentId: process.env.ROLLBACK_DEPLOYMENT_ID', "rollbackDeploymentId: 'dpl_changed'") }, { addVercelRequest: true }]) {
    const fixture = makeFixture();
    try { assert.match((await runRunner({ ...options, fixture })).result.stderr, /ENOENT|baseline evidence retrieval failed|deferred|project\/team|Vercel|mismatch|record/); } finally { fs.rmSync(fixture.workspace, { recursive: true, force: true }); }
  }
});

test('PREPARE harness keeps concurrent baseline outputs isolated', async () => {
  const fixtures = [makeFixture(), makeFixture()];
  try {
    const runs = await Promise.all(fixtures.map(fixture => runRunner({ fixture })));
    assert.notEqual(runs[0].fixture.baselinePath, runs[1].fixture.baselinePath);
    for (const { result, fixture } of runs) {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE/);
      assert.match(fs.readFileSync(fixture.baselinePath, 'utf8'), new RegExp(sourceSha));
    }
  } finally { for (const fixture of fixtures) fs.rmSync(fixture.workspace, { recursive: true, force: true }); }
});

test('PREPARE harness source contains no shared baseline literal', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(source, new RegExp('/tmp/' + 'pre-applied-baseline-input\\.json'));
});
