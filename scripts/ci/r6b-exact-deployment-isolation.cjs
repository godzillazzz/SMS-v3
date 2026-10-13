'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const EXPECTED = Object.freeze({
  repo: 'godzillazzz/SMS-v3',
  owner: 'godzillazzz',
  ownerId: 279642101,
  issue: 614,
  command: '/sms-v3-r6b-exact-isolation-attestation-v3',
  environment: 'Hosted UAT',
  integrationBranch: 'fix/serverless-database-reliability',
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  teamId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  previewRef: 'ezxanpfagitckpfsnflp',
  previewBucket: 'license-documents-g05-preview',
  productionDeploymentId: 'dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP',
  productionSha: '77641a2657aa4fd05276afe645dd32648f5cc56b',
  aliases: ['sms-v3-staging-godzillazzz.vercel.app', 'sms-v3-staging-ten.vercel.app'],
  probePath: '/api/v1/ops/preview-isolation-attestation'
});
const SHA = /^[a-f0-9]{40}$/;
const REF = /^[a-z0-9]{20}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const SAFE_METHODS = Object.freeze(['GET', 'OPTIONS']);
const RECEIPT_CONTRACT = 'sms-v3-preview-isolation/v3';
const RUNTIME_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const CLUSTER_FINGERPRINT = /^[0-9a-f]{64}$/;

function fail(code) { throw new Error(code); }
function ensure(condition, code) { if (!condition) fail(code); }
function projectIsExpected(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const identities = [];
  if (Object.hasOwn(obj, 'projectId')) {
    if (typeof obj.projectId !== 'string') return false;
    identities.push(obj.projectId);
  }
  if (Object.hasOwn(obj, 'project')) {
    const p = obj.project;
    if (typeof p === 'string') identities.push(p);
    else if (p && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'string') identities.push(p.id);
    else return false;
  }
  return identities.length > 0 && identities.every(v => v === EXPECTED.projectId);
}
function parseOwnerCommand(body) {
  const prefix = EXPECTED.command + ' sha=';
  ensure(typeof body === 'string' && body.startsWith(prefix),
    'EXACT_OWNER_ISSUE_COMMAND_REQUIRED');
  const remainder = body.slice(prefix.length);
  const marker = ' deployment=';
  const markerIndex = remainder.indexOf(marker);
  ensure(markerIndex > 0 && remainder.indexOf(marker, markerIndex + marker.length) === -1,
    'EXACT_OWNER_ISSUE_COMMAND_REQUIRED');
  const integrationSha = remainder.slice(0, markerIndex);
  const deploymentId = remainder.slice(markerIndex + marker.length);
  ensure(SHA.test(integrationSha) && DEPLOYMENT.test(deploymentId),
    'EXACT_OWNER_ISSUE_COMMAND_REQUIRED');
  return { integrationSha, deploymentId };
}

function assertOwnerEvent(event, env) {
  ensure(env.GITHUB_REPOSITORY === EXPECTED.repo
    && env.GITHUB_EVENT_NAME === 'issue_comment'
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_RUN_ATTEMPT === '1'
    && SHA.test(env.GITHUB_SHA || ''), 'TRUSTED_MAIN_REQUIRED');
  ensure(event && event.action === 'created'
    && event.issue?.number === EXPECTED.issue
    && event.issue?.state === 'open'
    && !event.issue?.pull_request
    && Number.isSafeInteger(event.comment?.id)
    && event.comment.id > 0
    && event.comment.author_association === 'OWNER', 'EXACT_OWNER_ISSUE_COMMAND_REQUIRED');
  for (const a of [event.sender, event.comment.user]) {
    ensure(a?.login === EXPECTED.owner && a.id === EXPECTED.ownerId
      && a.type === 'User', 'OWNER_IDENTITY_REQUIRED');
  }
  return { commentId: event.comment.id, ...parseOwnerCommand(event.comment.body) };
}
function verifyEnvironment(meta, policies) {
  ensure(meta?.name === EXPECTED.environment && meta.can_admins_bypass === false, 'ENVIRONMENT_BYPASS_REJECTED');
  const reviewers = meta.protection_rules?.find(r => r.type === 'required_reviewers')?.reviewers;
  ensure(Array.isArray(reviewers) && reviewers.some(r => r.type === 'User'
    && r.reviewer?.id === EXPECTED.ownerId && r.reviewer?.login === EXPECTED.owner),
  'HUMAN_OWNER_APPROVAL_REQUIRED');
  ensure(meta.deployment_branch_policy?.protected_branches === false
    && meta.deployment_branch_policy.custom_branch_policies === true
    && policies?.total_count === 1 && policies.branch_policies?.length === 1
    && policies.branch_policies[0].name === 'main'
    && policies.branch_policies[0].type === 'branch', 'MAIN_ONLY_ENVIRONMENT_REQUIRED');
}
function verifyDeployment(dep, host, expected) {
  ensure(expected && DEPLOYMENT.test(expected.deploymentId) && SHA.test(expected.integrationSha),
    'EXACT_PREVIEW_DEPLOYMENT_REQUIRED');
  ensure(dep?.id === expected.deploymentId
    && dep.name === 'sms-v3-staging' && projectIsExpected(dep)
    && dep.url === host && (dep.readyState || dep.state) === 'READY'
    && (dep.target === null || dep.target === 'preview')
    && dep.meta?.githubCommitSha === expected.integrationSha
    && dep.meta?.githubCommitRef === EXPECTED.integrationBranch
    && dep.meta?.githubOrg === 'godzillazzz'
    && dep.meta?.githubRepo === 'SMS-v3',
  'EXACT_PREVIEW_DEPLOYMENT_REQUIRED');
}
function verifyProduction(dep) {
  ensure(dep?.id === EXPECTED.productionDeploymentId
    && dep.target === 'production' && (dep.readyState || dep.state) === 'READY'
    && dep.meta?.githubCommitSha === EXPECTED.productionSha
    && projectIsExpected(dep), 'FROZEN_PRODUCTION_CHANGED');
}
function verifyCi(runs, integrationSha, integrationBranch) {
  ensure(SHA.test(integrationSha) && integrationBranch === EXPECTED.integrationBranch,
    'EXACT_INTEGRATION_CI_REQUIRED');
  const candidates = Array.isArray(runs?.workflow_runs)
    ? runs.workflow_runs.filter(r => r?.name === 'CI'
      && r.head_sha === integrationSha
      && r.head_branch === integrationBranch
      && r.status === 'completed' && r.conclusion === 'success')
    : [];
  const run = candidates.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  ensure(run?.name === 'CI' && run.head_sha === integrationSha
    && run.head_branch === integrationBranch
    && run.status === 'completed' && run.conclusion === 'success',
  'EXACT_INTEGRATION_CI_REQUIRED');
  return { id: run.id, headSha: run.head_sha, headBranch: run.head_branch };
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function verifyRuntimeReceipt(receipt, nonce, provenance) {
  // Receipt v3 adds an observed Prisma principal and a hashed cluster witness.
  // Provider-side fingerprints and the approved runtime principal remain
  // mandatory inputs; missing evidence fails closed before any release result.
  ensure(provenance?.deploymentVerified === true, 'DEPLOYMENT_PROVENANCE_REQUIRED');
  const expectedDeploymentId = provenance?.deploymentId;
  const expectedApplicationSha = provenance?.applicationSha;
  const expectedIntegrationRef = provenance?.integrationRef;
  ensure(DEPLOYMENT.test(expectedDeploymentId || '')
    && SHA.test(expectedApplicationSha || '')
    && expectedIntegrationRef === EXPECTED.integrationBranch,
  'RUNTIME_PROBE_IDENTITY_UNVERIFIED');
  ensure(exactKeys(receipt, [
    'contract', 'nonce', 'deploymentId', 'applicationSha', 'vercelProjectId',
    'gitCommitRef', 'signedChallengeIdentity', 'database', 'storage'
  ]) && receipt.contract === RECEIPT_CONTRACT
    && typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce)
    && receipt.nonce === nonce
    && receipt.deploymentId === expectedDeploymentId
    && receipt.applicationSha === expectedApplicationSha
    && receipt.vercelProjectId === EXPECTED.projectId
    && receipt.gitCommitRef === EXPECTED.integrationBranch,
  'RUNTIME_PROBE_MISSING_OR_UNTRUSTED');

  const challenge = receipt.signedChallengeIdentity;
  ensure(exactKeys(challenge, ['host', 'deploymentId', 'applicationSha', 'nonce', 'issuedAt', 'signatureVerified'])
    && typeof challenge.host === 'string'
    && /^[a-z0-9][a-z0-9.-]+\.vercel\.app$/.test(challenge.host)
    && challenge.deploymentId === receipt.deploymentId
    && challenge.applicationSha === receipt.applicationSha
    && challenge.nonce === receipt.nonce
    && Number.isSafeInteger(challenge.issuedAt)
    && challenge.signatureVerified === true,
  'SIGNED_CHALLENGE_IDENTITY_UNVERIFIED');

  const db = receipt.database;
  ensure(exactKeys(db, [
    'configuredDatabaseProjectRef', 'configuredDirectProjectRef',
    'configuredDatabaseName', 'observedDatabaseName',
    'runtimePrincipal', 'runtimeClusterFingerprintSha256',
    'targetGuardMatched', 'databaseReadOnlyQuerySucceeded', 'transactionReadOnly',
    'runtimeWitnessVerified'
  ]) && db.configuredDatabaseProjectRef === EXPECTED.previewRef
    && db.configuredDirectProjectRef === EXPECTED.previewRef
    && typeof db.configuredDatabaseName === 'string'
    && /^[A-Za-z0-9_-]{1,63}$/.test(db.configuredDatabaseName)
    && db.observedDatabaseName === db.configuredDatabaseName
    && db.targetGuardMatched === true
    && db.databaseReadOnlyQuerySucceeded === true
    && db.transactionReadOnly === true
    && db.runtimeWitnessVerified === true
    && typeof db.runtimePrincipal === 'string'
    && RUNTIME_ROLE.test(db.runtimePrincipal)
    && typeof db.runtimeClusterFingerprintSha256 === 'string'
    && CLUSTER_FINGERPRINT.test(db.runtimeClusterFingerprintSha256),
  'RUNTIME_DATABASE_TARGET_UNVERIFIED');

  const expectedPrincipal = provenance?.approvedRuntimePrincipal;
  ensure(typeof expectedPrincipal === 'string'
    && RUNTIME_ROLE.test(expectedPrincipal)
    && db.runtimePrincipal === expectedPrincipal,
  'RUNTIME_PRINCIPAL_UNVERIFIED');

  const previewCluster = provenance?.approvedPreviewClusterFingerprintSha256;
  const productionCluster = provenance?.approvedProductionClusterFingerprintSha256;
  ensure(typeof previewCluster === 'string' && CLUSTER_FINGERPRINT.test(previewCluster)
    && typeof productionCluster === 'string' && CLUSTER_FINGERPRINT.test(productionCluster)
    && previewCluster !== productionCluster
    && db.runtimeClusterFingerprintSha256 === previewCluster,
  'DATABASE_PROVIDER_WITNESS_UNVERIFIED');

  const storage = receipt.storage;
  ensure(exactKeys(storage, [
    'configuredEndpointProjectRef', 'bucket',
    'privateBucketMetadataReadSucceeded', 'bucketIsPrivate'
  ]) && storage.configuredEndpointProjectRef === EXPECTED.previewRef
    && storage.bucket === EXPECTED.previewBucket
    && storage.privateBucketMetadataReadSucceeded === true
    && storage.bucketIsPrivate === true,
  'RUNTIME_STORAGE_TARGET_UNVERIFIED');

  // Independent production refs can reject collisions, but cannot alone
  // prove effective Preview Storage credential binding.
  for (const ref of [provenance.approvedProductionDatabaseRef,
    provenance.approvedProductionStorageRef]) {
    if (ref !== undefined && ref !== '') {
      ensure(typeof ref === 'string' && REF.test(ref) && ref !== EXPECTED.previewRef,
        'PRODUCTION_SEPARATION_UNVERIFIED');
    }
  }
  return {
    deploymentIdentity: 'PASS',
    configuredDatabaseTarget: 'MATCH',
    databaseReadOnlyCheck: 'PASS',
    runtimePrincipal: 'MATCH',
    runtimeClusterFingerprint: 'MATCH_CANDIDATE',
    configuredStorageEndpoint: 'MATCH',
    privateBucketMetadataGet: 'PASS',
    database: 'UNVERIFIED',
    storage: 'UNVERIFIED',
    productionSeparation: 'UNVERIFIED'
  };
}
function safeUrl(raw, host) {
  let u;
  try { u = new URL(raw); } catch { fail('UNSAFE_URL'); }
  ensure(u.protocol === 'https:' && u.hostname === host
    && !u.username && !u.password && !u.search && !u.hash, 'UNSAFE_URL');
  return u;
}
function client(env, fetcher = globalThis.fetch) {
  async function request(url, headers = {}, method = 'GET') {
    ensure(SAFE_METHODS.includes(method), 'UNSAFE_METHOD');
    const u = new URL(url);
    ensure(u.protocol === 'https:' && !u.username && !u.password, 'UNSAFE_REQUEST');
    let response;
    try {
      response = await fetcher(u, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch { fail('NETWORK_UNVERIFIED'); }
    ensure(response.status !== 301 && response.status !== 302 && response.status !== 307 && response.status !== 308,
      'REDIRECT_REJECTED');
    return response;
  }
  async function read(url, token) {
    ensure(Boolean(token), 'TOKEN_REQUIRED');
    const res = await request(url, { Authorization: 'Bearer ' + token, Accept: 'application/json' });
    ensure(res.status === 200, 'PROVIDER_GET_FAILED');
    try { return await res.json(); } catch { fail('PROVIDER_RESPONSE_INVALID'); }
  }
  function gh(path) { return read('https://api.github.com/repos/' + EXPECTED.repo + '/' + path, env.GH_TOKEN); }
  function vercel(path) { return read('https://api.vercel.com/' + path + '?teamId=' + EXPECTED.teamId, env.VERCEL_TOKEN); }
  return { request, gh, vercel };
}
async function guardGovernance(api, env) {
  const [meta, policies, main] = await Promise.all([
    api.gh('environments/' + encodeURIComponent(EXPECTED.environment)),
    api.gh('environments/' + encodeURIComponent(EXPECTED.environment) + '/deployment-branch-policies?per_page=100'),
    api.gh('branches/main')
  ]);
  verifyEnvironment(meta, policies);
  ensure(main?.protected === true && main.commit?.sha === env.GITHUB_SHA, 'MAIN_MOVED_OR_UNPROTECTED');
}
async function guardIntegration(api, integrationSha) {
  const [ref, runs] = await Promise.all([
    api.gh('git/ref/heads/' + EXPECTED.integrationBranch),
    api.gh('actions/runs?head_sha=' + integrationSha + '&per_page=100')
  ]);
  ensure(ref?.object?.sha === integrationSha, 'INTEGRATION_MOVED');
  return verifyCi(runs, integrationSha, EXPECTED.integrationBranch);
}
async function prepare(event, env, fetcher) {
  const ownerCommand = assertOwnerEvent(event, env);
  const api = client(env, fetcher);
  await guardGovernance(api, env);
  const ci = await guardIntegration(api, ownerCommand.integrationSha);
  return { version: 3, commentId: ownerCommand.commentId, mainSha: env.GITHUB_SHA,
    integrationSha: ownerCommand.integrationSha, integrationBranch: EXPECTED.integrationBranch,
    deploymentId: ownerCommand.deploymentId, ciRunId: ci.id };
}
function verifyPlan(plan, event, env) {
  const ownerCommand = assertOwnerEvent(event, env);
  ensure(plan?.version === 3 && plan.commentId === ownerCommand.commentId
    && plan.mainSha === env.GITHUB_SHA
    && plan.integrationSha === ownerCommand.integrationSha
    && plan.integrationBranch === EXPECTED.integrationBranch
    && plan.deploymentId === ownerCommand.deploymentId
    && Number.isSafeInteger(plan.ciRunId), 'PLAN_TAMPERED');
  return ownerCommand;
}
function signRuntimeChallenge(secret, fields) {
  return 'v1=' + crypto.createHmac('sha256', secret).update([
    'GET', EXPECTED.probePath, fields.host.toLowerCase(),
    fields.deploymentId, fields.sha.toLowerCase(),
    fields.nonce.toLowerCase(), String(fields.issuedAt)
  ].join('\n')).digest('hex');
}
async function verify(plan, event, env, fetcher) {
  verifyPlan(plan, event, env);
  ensure(env.VERCEL_TOKEN && env.VERCEL_AUTOMATION_BYPASS_SECRET,
    'PROTECTED_READONLY_ACCESS_REQUIRED');
  const secret = env.RUNTIME_ISOLATION_PROBE_HMAC_SECRET;
  ensure(typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32,
    'PROBE_AUTH_NOT_CONFIGURED');
  for (const k of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET', 'SMTP_PASSWORD', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_PASSWORD']) {
    ensure(!env[k], 'UNEXPECTED_DATA_CREDENTIAL');
  }
  // Never touch the runtime probe without separate source review authorization.
  ensure(env.RUNTIME_PROBE_SOURCE_REVIEW_APPROVED === plan.integrationSha,
    'PROBE_SOURCE_REVIEW_REQUIRED');
  const api = client(env, fetcher);
  await guardGovernance(api, env);
  const ci = await guardIntegration(api, plan.integrationSha);
  ensure(ci.id === plan.ciRunId, 'EXACT_INTEGRATION_CI_REQUIRED');
  const [byId, production] = await Promise.all([
    api.vercel('v13/deployments/' + plan.deploymentId),
    api.vercel('v13/deployments/' + EXPECTED.productionDeploymentId)
  ]);
  const host = byId?.url;
  ensure(typeof host === 'string'
    && /^sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/.test(host),
    'PREVIEW_HOST_UNTRUSTED');
  const byHost = await api.vercel('v13/deployments/' + host);
  verifyDeployment(byId, host, plan);
  verifyDeployment(byHost, host, plan);
  verifyProduction(production);
  for (const alias of EXPECTED.aliases) {
    const info = await api.vercel('v4/aliases/' + alias);
    ensure(info?.alias === alias && info?.deploymentId === EXPECTED.productionDeploymentId,
      'PRODUCTION_ALIAS_CHANGED');
  }
  const bypass = { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET };
  const previewUrl = 'https://' + host;
  safeUrl(previewUrl, host);
  const ready = await api.request(previewUrl + '/api/v1/ready', bypass);
  let status;
  try { status = ready.status === 200 ? await ready.json() : null; } catch { status = null; }
  ensure(ready.status === 200 && status?.status === 'ready' && status.database === 'ok',
    'READINESS_UNVERIFIED');
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const signature = signRuntimeChallenge(secret, {
    host, deploymentId: plan.deploymentId, sha: plan.integrationSha, nonce, issuedAt
  });
  const params = new URLSearchParams({
    nonce, sha: plan.integrationSha, deploymentId: plan.deploymentId,
    issuedAt: String(issuedAt)
  });
  const reply = await api.request(previewUrl + EXPECTED.probePath + '?' + params.toString(),
    { ...bypass, 'x-smsv3-probe-signature': signature });
  ensure(reply.status === 200, 'RUNTIME_ATTESTATION_ENDPOINT_UNAVAILABLE');
  let receipt;
  try { receipt = await reply.json(); } catch { fail('RUNTIME_PROBE_RESPONSE_INVALID'); }
  const partial = verifyRuntimeReceipt(receipt, nonce, {
    deploymentVerified: true,
    deploymentId: plan.deploymentId,
    applicationSha: plan.integrationSha,
    integrationRef: plan.integrationBranch,
    projectId: EXPECTED.projectId,
    approvedRuntimePrincipal: env.APPROVED_PREVIEW_RUNTIME_PRINCIPAL,
    approvedPreviewClusterFingerprintSha256: env.APPROVED_PREVIEW_DB_CLUSTER_FINGERPRINT,
    approvedProductionClusterFingerprintSha256: env.APPROVED_PRODUCTION_DB_CLUSTER_FINGERPRINT,
    approvedProductionDatabaseRef: env.APPROVED_PRODUCTION_DB_REF,
    approvedProductionStorageRef: env.APPROVED_PRODUCTION_STORAGE_REF
  });
  // Without independent provider/runtime credential binding proof these can
  // NEVER satisfy the R6-B Release gate, even when individual GET checks succeed.
  return { result: 'UNVERIFIED', ...partial, deploymentId: plan.deploymentId,
    integrationSha: plan.integrationSha, productionUnchanged: true };
}
async function main() {
  const env = process.env;
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const mode = process.argv[2];
  try {
    if (mode === 'prepare') {
      const plan = await prepare(event, env);
      const out = JSON.stringify(plan);
      ensure(!out.includes(env.GH_TOKEN || '__none__'), 'UNSAFE_OUTPUT');
      fs.appendFileSync(env.GITHUB_OUTPUT, 'plan=' + out + '\n');
      console.log('TRUSTED_MAIN_AND_INTEGRATION_PREFLIGHT=PASS');
    } else if (mode === 'verify') {
      const p = JSON.parse(env.R6B_ISOLATION_PLAN || '{}');
      const result = await verify(p, event, env);
      console.log('EXACT_DEPLOYMENT_ISOLATION=' + result.result);
      console.log('DATABASE_ISOLATION=UNVERIFIED');
      console.log('STORAGE_ISOLATION=UNVERIFIED');
      console.log('PRODUCTION_SEPARATION=UNVERIFIED');
      process.exitCode = 1;
      console.log('PRODUCTION_UNCHANGED=PASS');
    } else fail('MODE_INVALID');
  } catch (error) {
    const known = /^[A-Z_]+$/.test(error.message) ? error.message : 'FAIL_CLOSED';
    console.error('EXACT_DEPLOYMENT_ISOLATION=UNVERIFIED');
    console.error('ATTESTATION_FAILURE_CATEGORY=' + known);
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { EXPECTED, projectIsExpected, parseOwnerCommand, assertOwnerEvent, verifyEnvironment, verifyDeployment,
  verifyProduction, verifyCi, verifyRuntimeReceipt, signRuntimeChallenge, safeUrl, verifyPlan, prepare, verify, client };
