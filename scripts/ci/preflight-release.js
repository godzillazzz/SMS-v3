'use strict';

/**
 * Release preflight — read-only rehearsal of every gate the production workflow enforces.
 *
 * Run this BEFORE asking the owner to approve a deployment. It never deploys, never dispatches and
 * never touches Production data: it only reads git, the release manifests, GitHub run metadata and
 * the public health endpoints.
 *
 *   node scripts/ci/preflight-release.js                        # check only
 *   node scripts/ci/preflight-release.js --prepare-next-release # set the rollback checkpoint from
 *                                                               # the live deployment (new release only)
 *
 * The rollback checkpoint is the deployment a new release would replace. It must never be repointed
 * at a deployment this manifest itself produced: that erases the previous known-good state.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateRecord } = require('./verify-post-release-record');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = '.github/releases/approved-production.json';
const BRANCH = 'fix/serverless-database-reliability';
const DEPLOY_WORKFLOW = 'deploy-approved-production-v2.yml';
const CI_WORKFLOW = 'CI';
const BASE_URL = 'https://sms-v3-staging-ten.vercel.app';

const SHA = /^[0-9a-f]{40}$/;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function loadManifest(root = ROOT, file = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

/** The deployment id published by the release workflow summary block. */
function parseDeploymentId(log) {
  const match = String(log || '').match(/Deployment ID:\s*(dpl_[A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Reads every post-release record and returns the ones bound to this manifest.
 * Binding is explicit (release_id + approved_manifest + deployed source SHA), never filename order,
 * and ambiguity fails closed.
 */
function postReleaseRecords(root = ROOT) {
  const dir = path.join(root, 'docs/releases');
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (record?.record_type === 'POST_RELEASE_RECORD') records.push({ file: `docs/releases/${file}`, record });
    } catch { /* malformed records are ignored here and caught by the validator */ }
  }
  return records;
}

/**
 * Orders the post-release history canonically: newest `deployed.verified_at` first, then the higher
 * deploy run id. File names, directory order and git order never decide the canonical deployment.
 * Fails closed on records that do not satisfy the record contract, duplicates, ambiguous ties and a
 * history chain that contradicts itself.
 */
function orderPostReleaseRecords(entries) {
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const ordered = [];
  for (const entry of list) {
    const deployed = entry?.record?.deployed || {};
    try {
      validateRecord(entry.record);
    } catch (error) {
      return { ok: false, reason: `record ${entry.file} violates the post-release contract: ${error.message}`, ordered: [] };
    }
    const verifiedAt = Date.parse(deployed.verified_at);
    if (!Number.isFinite(verifiedAt)) return { ok: false, reason: `record ${entry.file} has no usable verified_at`, ordered: [] };
    if (!Number.isSafeInteger(deployed.deploy_run_id) || deployed.deploy_run_id <= 0) {
      return { ok: false, reason: `record ${entry.file} has no usable deploy_run_id`, ordered: [] };
    }
    ordered.push({
      file: entry.file,
      record: entry.record,
      deploymentId: deployed.deployment_id,
      sourceSha: deployed.source_sha,
      verifiedAt,
      runId: deployed.deploy_run_id
    });
  }

  const seen = new Map();
  for (const item of ordered) {
    if (seen.has(item.deploymentId)) {
      return { ok: false, reason: `duplicate post-release records claim ${item.deploymentId}`, ordered: [] };
    }
    seen.set(item.deploymentId, item.file);
  }

  ordered.sort((a, b) => (b.verifiedAt - a.verifiedAt) || (b.runId - a.runId) || a.deploymentId.localeCompare(b.deploymentId));

  for (let index = 1; index < ordered.length; index += 1) {
    const newer = ordered[index - 1];
    const older = ordered[index];
    if (newer.verifiedAt === older.verifiedAt && newer.runId === older.runId) {
      return { ok: false, reason: `ambiguous post-release ordering between ${newer.deploymentId} and ${older.deploymentId}`, ordered: [] };
    }
    const previous = newer.record.previous_known_good || {};
    if (previous.deployment_id !== older.deploymentId || previous.source_sha !== older.sourceSha) {
      return { ok: false, reason: `conflicting post-release history: ${newer.deploymentId} claims ${previous.deployment_id || 'no predecessor'}, expected ${older.deploymentId}`, ordered: [] };
    }
  }

  return { ok: true, ordered };
}

/** The single canonical (latest verified) post-release record, or a fail-closed reason. */
function selectCanonicalRecord(entries) {
  const ordering = orderPostReleaseRecords(entries);
  if (!ordering.ok) return { ok: false, reason: ordering.reason, canonical: null, ordered: [] };
  return { ok: true, reason: '', canonical: ordering.ordered[0] || null, ordered: ordering.ordered };
}

/**
 * The canonical record is the only authority for "what Production runs now": its deployment, source
 * SHA and the manifest's rollback checkpoint must describe the same deployment.
 */
function checkpointBinding(manifest, canonical) {
  if (!canonical) return { ok: false, reason: 'no verified post-release record exists yet' };
  const problems = [];
  if (canonical.deploymentId !== manifest.rollback_deployment_id) {
    problems.push(`canonical deployment ${canonical.deploymentId} is not the manifest checkpoint ${manifest.rollback_deployment_id}`);
  }
  if (manifest.production_canonical_deployment_id_before_release && manifest.production_canonical_deployment_id_before_release !== canonical.deploymentId) {
    problems.push(`production_canonical_deployment_id_before_release ${manifest.production_canonical_deployment_id_before_release} is not ${canonical.deploymentId}`);
  }
  if (canonical.sourceSha !== manifest.current_production_source_sha) {
    problems.push(`canonical source ${canonical.sourceSha} is not current_production_source_sha ${manifest.current_production_source_sha}`);
  }
  if (manifest.production_canonical_source_sha_before_release && manifest.production_canonical_source_sha_before_release !== canonical.sourceSha) {
    problems.push(`production_canonical_source_sha_before_release ${manifest.production_canonical_source_sha_before_release} is not ${canonical.sourceSha}`);
  }
  return problems.length ? { ok: false, reason: problems.join('; ') } : { ok: true, reason: '' };
}

function recordBinding(manifest, entry) {
  const record = entry.record || {};
  const deployed = record.deployed || {};
  return record.approved_manifest === MANIFEST_PATH
    && record.release_id === manifest.release_id
    && deployed.source_sha === manifest.commit_sha;
}

/**
 * Refuse to repoint the checkpoint at a deployment this manifest already produced, and refuse to move
 * the checkpoint backwards to an older verified release. Fails closed when several records bind to
 * the manifest or their metadata disagree.
 */
function canRepointCheckpoint(manifest, live, records) {
  if (!live?.id) return { ok: false, reason: 'live deployment unknown' };
  const list = Array.isArray(records) ? records : records ? [records] : [];
  const bound = list.filter((entry) => recordBinding(manifest, entry));
  if (bound.length > 1) return { ok: false, reason: 'multiple post-release records bind to this manifest' };
  if (bound.length === 1) {
    const deployed = bound[0].record.deployed || {};
    if (deployed.deployment_id !== live.id) {
      return { ok: false, reason: `record deployment ${deployed.deployment_id} is not the live deployment ${live.id}` };
    }
    return { ok: false, reason: 'this manifest is already deployed; prepare a new release manifest' };
  }
  const ordering = orderPostReleaseRecords(list);
  if (ordering.ok && ordering.ordered.length) {
    const liveIndex = ordering.ordered.findIndex((item) => item.deploymentId === live.id);
    const checkpointIndex = ordering.ordered.findIndex((item) => item.deploymentId === manifest.rollback_deployment_id);
    if (liveIndex === -1) {
      return { ok: false, reason: `live deployment ${live.id} is not a verified post-release record` };
    }
    if (checkpointIndex !== -1 && liveIndex > checkpointIndex) {
      return { ok: false, reason: `refusing to move the rollback checkpoint backwards from ${manifest.rollback_deployment_id} to ${live.id}` };
    }
  }
  return { ok: true };
}

function policyChecks(manifest) {
  const checks = [
    ['manifest.commit_sha is a 40-hex SHA', SHA.test(manifest.commit_sha || '')],
    ['manifest.tree_sha is a 40-hex SHA', SHA.test(manifest.tree_sha || '')],
    ['manifest.run_migrations is false', manifest.run_migrations === false],
    ['manifest.source_branch is the release branch', manifest.source_branch === BRANCH]
  ];
  if (manifest.database_change_policy === 'NO_DATABASE_CHANGES') {
    checks.push(['no migration evidence is referenced', manifest.pre_applied_migration_manifest_path === null && manifest.pre_applied_migration_evidence_run_id === null]);
  } else if (manifest.database_change_policy === 'PRE_APPLIED_APPROVED_MIGRATION') {
    checks.push(['migration evidence manifest is referenced', Boolean(manifest.pre_applied_migration_manifest_path)]);
    checks.push(['migration evidence run id is referenced', Number.isSafeInteger(manifest.pre_applied_migration_evidence_run_id)]);
  } else {
    checks.push([`known database_change_policy (got ${manifest.database_change_policy})`, false]);
  }
  return checks;
}

function prismaDiffIsEmpty(fromSha, toSha) {
  try {
    execFileSync('git', ['diff', '--quiet', fromSha, toSha, '--', 'prisma/schema.prisma', 'prisma/migrations'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function successfulCiRun(sha) {
  try {
    const raw = gh(['run', 'list', '--workflow', CI_WORKFLOW, '--commit', sha, '--limit', '10', '--json', 'databaseId,status,conclusion']);
    const runs = JSON.parse(raw || '[]');
    return runs.find((run) => run.status === 'completed' && run.conclusion === 'success') || null;
  } catch {
    return null;
  }
}

function evidenceRun(runId) {
  try {
    const raw = gh(['api', `repos/{owner}/{repo}/actions/runs/${runId}`, '--jq', '{name,status,conclusion,event,head_branch,head_sha}']);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Fallback used only while no verified post-release record exists (the very first governed release):
 * read the deployment id from the last successful deploy run log. Once a record exists the canonical
 * record is the sole authority and this log scan is never consulted.
 */
function latestDeploymentId() {
  try {
    const raw = gh(['run', 'list', '--workflow', DEPLOY_WORKFLOW, '--limit', '20', '--json', 'databaseId,conclusion']);
    const runs = JSON.parse(raw || '[]').filter((run) => run.conclusion === 'success');
    for (const run of runs.slice(0, 3)) {
      try {
        const log = execFileSync('gh', ['run', 'view', String(run.databaseId), '--log'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const id = parseDeploymentId(log);
        if (id) return { id, runId: run.databaseId, source: 'deploy-run-log' };
      } catch {
        /* try the next run */
      }
    }
  } catch {
    /* fall through to no deployment id */
  }
  return null;
}

async function liveHealth() {
  const results = [];
  for (const endpoint of ['/api/v1/health', '/api/v1/ready']) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, { signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => ({}));
      results.push({ endpoint, status: response.status, body });
    } catch (error) {
      results.push({ endpoint, status: 0, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const prepareNext = args.includes('--prepare-next-release');
  const manifest = loadManifest();
  const head = git(['rev-parse', 'HEAD']);
  const checks = [];

  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  // 1. Manifest contract
  try {
    execFileSync('node', ['scripts/ci/verify-release-manifest.js', MANIFEST_PATH], { cwd: ROOT, stdio: 'ignore' });
    add('manifest passes the repository validator', true);
  } catch {
    add('manifest passes the repository validator', false, 'run node scripts/ci/verify-release-manifest.js ' + MANIFEST_PATH);
  }
  for (const [name, ok] of policyChecks(manifest)) add(name, ok);

  // 2. Source identity
  const targetSha = manifest.commit_sha;
  let targetTree = null;
  try { targetTree = git(['rev-parse', `${targetSha}^{tree}`]); } catch { /* reported below */ }
  add('commit_sha exists in the repository', Boolean(targetTree));
  add('tree_sha matches the commit tree', targetTree === manifest.tree_sha, targetTree ? `git tree ${targetTree.slice(0, 8)}` : 'missing commit');
  add('commit_sha is an ancestor of the release branch', isAncestor(targetSha, `origin/${BRANCH}`));
  add('current production source is an ancestor of the release', isAncestor(manifest.current_production_source_sha, targetSha));

  // 3. Database policy arithmetic
  if (manifest.database_change_policy === 'NO_DATABASE_CHANGES') {
    add('prisma tree is unchanged between production and the release', prismaDiffIsEmpty(manifest.current_production_source_sha, targetSha));
  } else if (manifest.database_change_policy === 'PRE_APPLIED_APPROVED_MIGRATION') {
    let guardOk = false;
    try {
      execFileSync('node', ['scripts/ci/verify-approved-production-migration.js', manifest.pre_applied_migration_manifest_path], { cwd: ROOT, stdio: 'ignore' });
      guardOk = true;
    } catch { /* reported below */ }
    add('migration guard passes for the evidence manifest', guardOk);
    const run = evidenceRun(manifest.pre_applied_migration_evidence_run_id);
    add('evidence run succeeded', Boolean(run && run.conclusion === 'success'), run ? `${run.name} ${run.status}/${run.conclusion}` : 'run not found');
    add('evidence run was triggered by push', Boolean(run && run.event === 'push'), run ? `event=${run.event}` : '');
    add('evidence run is on the release branch', Boolean(run && run.head_branch === BRANCH), run ? `branch=${run.head_branch}` : '');
    if (run && run.head_sha) {
      add('evidence head is an ancestor of the dispatch SHA', isAncestor(run.head_sha, head), `evidence head ${run.head_sha.slice(0, 8)}`);
      add('evidence artefacts are unchanged since that run', quietDiff(run.head_sha, head, manifest));
    }
  }

  // 4. Exact-SHA CI evidence for both SHAs the gate checks
  add('CI is green for commit_sha', Boolean(successfulCiRun(targetSha)), targetSha.slice(0, 8));
  add('CI is green for the dispatch SHA (HEAD)', Boolean(successfulCiRun(head)), head.slice(0, 8));

  // 5. Canonical post-release history, the rollback checkpoint and the live deployment
  const records = postReleaseRecords();
  const selection = selectCanonicalRecord(records);
  add('post-release history is unambiguous', selection.ok, selection.ok ? `${selection.ordered.length} verified record(s)` : selection.reason);
  let live = null;
  if (selection.ok && selection.canonical) {
    live = {
      id: selection.canonical.deploymentId,
      sourceSha: selection.canonical.sourceSha,
      runId: selection.canonical.runId,
      verifiedAt: selection.canonical.verifiedAt,
      source: selection.canonical.file
    };
    const binding = checkpointBinding(manifest, selection.canonical);
    add('canonical post-release record binds current_production_source_sha and the checkpoint', binding.ok, binding.ok ? `${live.id} ${live.sourceSha.slice(0, 8)}` : binding.reason);
  } else if (selection.ok) {
    live = latestDeploymentId();
  }
  if (!live) {
    add('rollback checkpoint matches the live canonical deployment', false, 'could not read the deployment id from the last successful deploy log');
  } else if (live.id === manifest.rollback_deployment_id) {
    add('rollback checkpoint matches the live canonical deployment', true, live.id);
  } else if (prepareNext) {
    const allowed = canRepointCheckpoint(manifest, live, records);
    if (!allowed.ok) {
      add('rollback checkpoint may be repointed for a new release', false, allowed.reason);
    } else {
      manifest.rollback_deployment_id = live.id;
      manifest.production_canonical_deployment_id_before_release = live.id;
      if (live.sourceSha) {
        manifest.current_production_source_sha = live.sourceSha;
        manifest.production_canonical_source_sha_before_release = live.sourceSha;
      }
      fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
      add('rollback checkpoint matches the live canonical deployment', true, `set to ${live.id} for the next release`);
    }
  } else {
    add('rollback checkpoint differs from the live canonical deployment', false, `manifest ${manifest.rollback_deployment_id} vs live ${live.id} — expected for an undeployed release; use --prepare-next-release when preparing one`);
  }

  // 6. Live endpoints
  for (const result of await liveHealth()) {
    const ok = result.status === 200 && (result.endpoint.endsWith('/health') ? result.body.status === 'ok' : result.body.status === 'ready' && result.body.database === 'ok');
    add(`live ${result.endpoint} responds healthy`, ok, result.error || `status ${result.status}`);
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? `  [${check.detail}]` : ''}`);
  }
  console.log('');
  console.log(`PREFLIGHT_RESULT=${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length}`);
  if (failed.length) process.exitCode = 1;
}

function quietDiff(fromSha, toSha, manifest) {
  let paths = [
    '.github/releases/approved-attendance-multilevel-production-migration.json',
    '.github/workflows/apply-approved-attendance-multilevel-production-migration.yml',
    'scripts/ci/verify-approved-production-migration.js',
    'scripts/ci/verify-attendance-multilevel-constraints.js'
  ];
  if (manifest && (manifest.pre_applied_migration_manifest_path === '.github/releases/approved-attendance-device-selfie-production-migration.json' || manifest.pre_applied_migration_manifest_path === '.github/releases/approved-attendance-device-selfie-migration.json')) {
    paths = [
      manifest.pre_applied_migration_manifest_path,
      '.github/workflows/apply-approved-attendance-device-selfie-production-migration.yml',
      'scripts/ci/verify-approved-production-migration.js',
      'scripts/ci/verify-attendance-device-selfie-table.js'
    ];
  }
  try {
    execFileSync('git', ['diff', '--quiet', fromSha, toSha, '--', ...paths], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('PREFLIGHT_CRASH', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseDeploymentId,
  policyChecks,
  prismaDiffIsEmpty,
  isAncestor,
  quietDiff,
  canRepointCheckpoint,
  checkpointBinding,
  orderPostReleaseRecords,
  postReleaseRecords,
  selectCanonicalRecord,
  BRANCH
};
