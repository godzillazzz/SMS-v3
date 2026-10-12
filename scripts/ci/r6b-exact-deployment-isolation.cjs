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
  integrationSha: 'eeeb7cea92357c7d34500fbc74c8e3087e9849c5',
  ciRunId: 38190536543,
  deploymentId: 'dpl_yhs6Z4CUHingjrDh1tM8d7wWpNRz',
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
    && event.comment.body === EXPECTED.command
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
function verifyRuntimeReceipt(receipt, nonce, provenance) {
  // This data MUST originate at the exact deployment host from a reviewed runtime probe.
  // No endpoint on the pinned legacy deployment => fail closed; never synthesize a PASS.
  ensure(provenance?.deploymentVerified === true, 'DEPLOYMENT_PROVENANCE_REQUIRED');
  ensure(receipt?.contract === 'sms-v3-preview-isolation/v1'
    && typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce)
    && receipt.nonce === nonce
    && receipt.applicationSha === EXPECTED.integrationSha,
  'RUNTIME_PROBE_MISSING_OR_UNTRUSTED');
  const db = receipt.database;
  ensure(db?.readOnlyQuerySucceeded === true
    && db.connectionProjectRef === EXPECTED.previewRef
    && db.directProjectRef === EXPECTED.previewRef
    && db.connectedProjectRef === EXPECTED.previewRef,
  'RUNTIME_DATABASE_IDENTITY_UNVERIFIED');
  const storage = receipt.storage;
  ensure(storage?.projectRef === EXPECTED.previewRef
    && storage.credentialProjectRef === EXPECTED.previewRef
    && storage.bucket === EXPECTED.previewBucket
    && storage.privateBucketReadSucceeded === true,
  'RUNTIME_STORAGE_IDENTITY_UNVERIFIED');
  // Production project refs must come from independently approved, non-secret provider evidence,
  // not from the preview response. Equality with Preview fails closed.
  const approvedDb = provenance.approvedProductionDatabaseRef;
  const approvedStorage = provenance.approvedProductionStorageRef;
  ensure(REF.test(approvedDb || '') && REF.test(approvedStorage || '')
    && approvedDb !== EXPECTED.previewRef && approvedStorage !== EXPECTED.previewRef,
  'PRODUCTION_SEPARATION_UNVERIFIED');
  return { database: 'PASS', storage: 'PASS', productionSeparation: 'PASS' };
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
  return { version: 1, commentId, mainSha: env.GITHUB_SHA, integrationSha: EXPECTED.integrationSha,
    deploymentId: EXPECTED.deploymentId };
}
function verifyPlan(plan, event, env) {
  const id = assertOwnerEvent(event, env);
  ensure(plan?.version === 1 && plan.commentId === id
    && plan.mainSha === env.GITHUB_SHA
    && plan.integrationSha === EXPECTED.integrationSha
    && plan.deploymentId === EXPECTED.deploymentId, 'PLAN_TAMPERED');
}
async function verify(plan, event, env, fetcher) {
  verifyPlan(plan, event, env);
  ensure(env.VERCEL_TOKEN && env.VERCEL_AUTOMATION_BYPASS_SECRET, 'PROTECTED_READONLY_ACCESS_REQUIRED');
  // The protected verifier never receives direct database, storage, migration or UAT credentials.
  for (const k of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET', 'SMTP_PASSWORD', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_PASSWORD']) {
    ensure(!env[k], 'UNEXPECTED_DATA_CREDENTIAL');
  }
  const api = client(env, fetcher);
  await guardGovernance(api, env);
  await guardIntegration(api);
  const [byId, production] = await Promise.all([
    api.vercel('v13/deployments/' + EXPECTED.deploymentId),
    api.vercel('v13/deployments/' + EXPECTED.productionDeploymentId)
  ]);
  const host = byId?.url;
  ensure(typeof host === 'string' && /^sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/.test(host),
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
  // A nonce binds any future reviewed runtime evidence to this verification request.
  const nonce = crypto.randomBytes(16).toString('hex');
  const receiptResponse = await api.request(previewUrl + EXPECTED.probePath + '?nonce=' + nonce, bypass);
  ensure(receiptResponse.status === 200, 'RUNTIME_ATTESTATION_ENDPOINT_UNAVAILABLE');
  let receipt;
  try { receipt = await receiptResponse.json(); } catch { fail('RUNTIME_PROBE_RESPONSE_INVALID'); }
  const results = verifyRuntimeReceipt(receipt, nonce, {
    deploymentVerified: true,
    approvedProductionDatabaseRef: env.APPROVED_PRODUCTION_DB_REF,
    approvedProductionStorageRef: env.APPROVED_PRODUCTION_STORAGE_REF
  });
  // PASS requires a separately approved source-reviewed probe deployed at this exact immutable SHA.
  ensure(env.RUNTIME_PROBE_SOURCE_REVIEW_APPROVED === EXPECTED.integrationSha,
    'PROBE_SOURCE_REVIEW_REQUIRED');
  return { result: 'PASS', ...results, deploymentId: EXPECTED.deploymentId,
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
      console.log('DATABASE_ISOLATION=PASS');
      console.log('STORAGE_ISOLATION=PASS');
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
  verifyProduction, verifyCi, verifyRuntimeReceipt, safeUrl, verifyPlan, prepare, verify, client };
