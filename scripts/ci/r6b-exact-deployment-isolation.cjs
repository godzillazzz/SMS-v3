'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const EXPECTED = Object.freeze({
  repo: 'godzillazzz/SMS-v3',
  owner: 'godzillazzz',
  ownerId: 279642101,
  issue: 614,
  command: '/sms-v3-r6b-exact-isolation-attestation-20261012',
  environment: 'Hosted UAT',
  integrationBranch: 'fix/serverless-database-reliability',
  integrationSha: 'e80a1883d1598c035741ca55d9a1fc09061718f9',
  ciRunId: 38324590377,
  deploymentId: 'dpl_9FeFnk1yQx8LUsENMA7TR3R8fpwk',
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
const SAFE_METHODS = Object.freeze(['GET', 'OPTIONS']);

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
    && event.comment.body === EXPECTED.command + ' sha=' + EXPECTED.integrationSha + ' deployment=' + EXPECTED.deploymentId
    && event.comment.author_association === 'OWNER', 'EXACT_OWNER_ISSUE_COMMAND_REQUIRED');
  for (const a of [event.sender, event.comment.user]) {
    ensure(a?.login === EXPECTED.owner && a.id === EXPECTED.ownerId
      && a.type === 'User', 'OWNER_IDENTITY_REQUIRED');
  }
  return event.comment.id;
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
function verifyDeployment(dep, host) {
  ensure(dep?.id === EXPECTED.deploymentId
    && dep.name === 'sms-v3-staging' && projectIsExpected(dep)
    && dep.url === host && (dep.readyState || dep.state) === 'READY'
    && (dep.target === null || dep.target === 'preview')
    && dep.meta?.githubCommitSha === EXPECTED.integrationSha
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
function verifyCi(runs) {
  const run = runs?.workflow_runs?.find(r => r.id === EXPECTED.ciRunId);
  ensure(run?.name === 'CI' && run.head_sha === EXPECTED.integrationSha
    && run.head_branch === EXPECTED.integrationBranch
    && run.status === 'completed' && run.conclusion === 'success',
  'EXACT_INTEGRATION_CI_REQUIRED');
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function verifyRuntimeReceipt(receipt, nonce, provenance) {
  // Receipt v2 records configured targets and read-only observations,
  // not independently verified provider identity.
  ensure(provenance?.deploymentVerified === true, 'DEPLOYMENT_PROVENANCE_REQUIRED');
  ensure(exactKeys(receipt, [
    'contract', 'nonce', 'deploymentId', 'applicationSha', 'vercelProjectId',
    'gitCommitRef', 'database', 'storage'
  ]) && receipt.contract === 'sms-v3-preview-isolation/v2'
    && typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce)
    && receipt.nonce === nonce
    && receipt.deploymentId === EXPECTED.deploymentId
    && receipt.applicationSha === EXPECTED.integrationSha
    && receipt.vercelProjectId === EXPECTED.projectId
    && receipt.gitCommitRef === EXPECTED.integrationBranch,
  'RUNTIME_PROBE_MISSING_OR_UNTRUSTED');
  const db = receipt.database;
  ensure(exactKeys(db, [
    'configuredDatabaseProjectRef', 'configuredDirectProjectRef',
    'configuredDatabaseName', 'observedDatabaseName',
    'targetGuardMatched', 'databaseReadOnlyQuerySucceeded'
  ]) && db.configuredDatabaseProjectRef === EXPECTED.previewRef
    && db.configuredDirectProjectRef === EXPECTED.previewRef
    && typeof db.configuredDatabaseName === 'string'
    && /^[A-Za-z0-9_-]{1,63}$/.test(db.configuredDatabaseName)
    && db.observedDatabaseName === db.configuredDatabaseName
    && db.targetGuardMatched === true
    && db.databaseReadOnlyQuerySucceeded === true,
  'RUNTIME_DATABASE_TARGET_UNVERIFIED');
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
  // prove that effective Preview credentials are bound to that provider.
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
async function guardIntegration(api) {
  const [ref, runs] = await Promise.all([
    api.gh('git/ref/heads/' + EXPECTED.integrationBranch),
    api.gh('actions/runs?head_sha=' + EXPECTED.integrationSha + '&per_page=100')
  ]);
  ensure(ref?.object?.sha === EXPECTED.integrationSha, 'INTEGRATION_MOVED');
  verifyCi(runs);
}
async function prepare(event, env, fetcher) {
  const commentId = assertOwnerEvent(event, env);
  const api = client(env, fetcher);
  await guardGovernance(api, env);
  await guardIntegration(api);
  return { version: 2, commentId, mainSha: env.GITHUB_SHA, integrationSha: EXPECTED.integrationSha,
    deploymentId: EXPECTED.deploymentId };
}
function verifyPlan(plan, event, env) {
  const id = assertOwnerEvent(event, env);
  ensure(plan?.version === 2 && plan.commentId === id
    && plan.mainSha === env.GITHUB_SHA
    && plan.integrationSha === EXPECTED.integrationSha
    && plan.deploymentId === EXPECTED.deploymentId, 'PLAN_TAMPERED');
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
  ensure(env.RUNTIME_PROBE_SOURCE_REVIEW_APPROVED === EXPECTED.integrationSha,
    'PROBE_SOURCE_REVIEW_REQUIRED');
  const api = client(env, fetcher);
  await guardGovernance(api, env);
  await guardIntegration(api);
  const [byId, production] = await Promise.all([
    api.vercel('v13/deployments/' + EXPECTED.deploymentId),
    api.vercel('v13/deployments/' + EXPECTED.productionDeploymentId)
  ]);
  const host = byId?.url;
  ensure(typeof host === 'string'
    && /^sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/.test(host),
    'PREVIEW_HOST_UNTRUSTED');
  const byHost = await api.vercel('v13/deployments/' + host);
  verifyDeployment(byId, host);
  verifyDeployment(byHost, host);
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
    host, deploymentId: EXPECTED.deploymentId, sha: EXPECTED.integrationSha, nonce, issuedAt
  });
  const params = new URLSearchParams({
    nonce, sha: EXPECTED.integrationSha, deploymentId: EXPECTED.deploymentId,
    issuedAt: String(issuedAt)
  });
  const reply = await api.request(previewUrl + EXPECTED.probePath + '?' + params.toString(),
    { ...bypass, 'x-smsv3-probe-signature': signature });
  ensure(reply.status === 200, 'RUNTIME_ATTESTATION_ENDPOINT_UNAVAILABLE');
  let receipt;
  try { receipt = await reply.json(); } catch { fail('RUNTIME_PROBE_RESPONSE_INVALID'); }
  const partial = verifyRuntimeReceipt(receipt, nonce, {
    deploymentVerified: true,
    approvedProductionDatabaseRef: env.APPROVED_PRODUCTION_DB_REF,
    approvedProductionStorageRef: env.APPROVED_PRODUCTION_STORAGE_REF
  });
  // Without independent provider/runtime credential binding proof these can
  // NEVER satisfy the R6-B Release gate, even when individual GET checks succeed.
  return { result: 'UNVERIFIED', ...partial, deploymentId: EXPECTED.deploymentId,
    integrationSha: EXPECTED.integrationSha, productionUnchanged: true };
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
module.exports = { EXPECTED, projectIsExpected, assertOwnerEvent, verifyEnvironment, verifyDeployment,
  verifyProduction, verifyCi, verifyRuntimeReceipt, signRuntimeChallenge, safeUrl, verifyPlan, prepare, verify, client };
