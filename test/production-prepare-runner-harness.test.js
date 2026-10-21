'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-prepare-checkout-'));
  const trusted = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-extracted-trusted-'));
  fs.mkdirSync(path.join(checkout, '.github/releases'), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'docs/releases'), { recursive: true });
  fs.copyFileSync(path.join(root, manifestPath), path.join(checkout, manifestPath));
  fs.copyFileSync(path.join(root, recordPath), path.join(checkout, recordPath));
  for (const file of ['trusted-production-baseline-collector.js', 'verify-pre-applied-migration-production-baseline.js']) {
    fs.writeFileSync(path.join(trusted, file), execFileSync('git', ['show', `${trustedSha}:scripts/ci/${file}`], { cwd: root }));
  }
  return { checkout, trusted };
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

function runRunner({ mutate, removeRepositoryRoot = false, addVercelRequest = false } = {}) {
  const { checkout, trusted } = makeFixture();
  fs.writeFileSync(path.join(checkout, 'preload.js'), fetchPreload());
  try {
    let runner = extractNodeHeredoc(fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n'), 'Verify pre-applied Production baseline before Owner gate');
    if (removeRepositoryRoot) runner = runner.replace(', { repositoryRoot: process.cwd() }', '');
    if (mutate) runner = mutate(runner);
    runner += `\nconst guard = verifier.validateProductionBaseline(JSON.parse(fs.readFileSync('/tmp/pre-applied-baseline-input.json', 'utf8')), { repositoryRoot: process.cwd() });\nprocess.stdout.write('PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=' + guard.mode + '\\n');\n`;
    if (addVercelRequest) runner += `\ntrusted.collectVercel({ request, token: 'unexpected', teamId: 'team_fixture', projectId: 'prj_fixture', deploymentId: '${rollbackId}', canonicalUrl: process.env.CANONICAL_URL });\n`;
    const result = spawnSync(process.execPath, ['-r', path.join(checkout, 'preload.js'), '-', trusted], {
      cwd: checkout,
      encoding: 'utf8',
      input: runner,
      env: { ...process.env, CURRENT_PRODUCTION_SOURCE_SHA: sourceSha, ROLLBACK_DEPLOYMENT_ID: rollbackId, CURRENT_PRODUCTION_POST_RELEASE_RECORD: recordPath, CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app', GITHUB_REPOSITORY: 'godzillazzz/SMS-v3', GH_TOKEN: 'test-token' },
    });
    return result;
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
    fs.rmSync(trusted, { recursive: true, force: true });
  }
}

test('PREPARE runner harness executes extracted trusted code through the Owner-gate boundary', () => {
  const { checkout, trusted } = makeFixture();
  fs.writeFileSync(path.join(checkout, 'preload.js'), fetchPreload());
  try {
    const result = runRunner();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PRE_GATE_BASELINE=SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE/);
    assert.match(result.stdout, /PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE/);
    assert.match(result.stdout, /INVARIANT_FINGERPRINT=[0-9a-f]{64}/);
    assert.equal(result.stderr, '', result.stderr);
    assert.ok(fs.existsSync(path.join(checkout, '.github/releases/approved-attendance-selfie-policy-migration.json')));
    assert.ok(fs.existsSync(path.join(checkout, recordPath)));
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
    fs.rmSync(trusted, { recursive: true, force: true });
  }
});

test('PREPARE harness mutation proofs fail closed', () => {
  assert.match(runRunner({ removeRepositoryRoot: true }).stderr, /ENOENT|baseline evidence retrieval failed/);
  assert.match(runRunner({ mutate: source => source.replace("vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT'", "vercelCanonicalIdentity: 'VERIFIED_IN_PROTECTED_ENVIRONMENT'") }).stderr, /deferred|project\/team|Vercel/);
  assert.match(runRunner({ mutate: source => source.replace('rollbackDeploymentId: process.env.ROLLBACK_DEPLOYMENT_ID', "rollbackDeploymentId: 'dpl_changed'") }).stderr, /mismatch|record/);
  assert.match(runRunner({ addVercelRequest: true }).stderr, /Vercel request attempted|api\.vercel\.com/);
});
