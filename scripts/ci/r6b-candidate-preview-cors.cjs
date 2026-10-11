'use strict';

const fs = require('node:fs');

const EXPECTED = Object.freeze({
  repository: 'godzillazzz/SMS-v3',
  owner: 'godzillazzz',
  ownerId: 279642101,
  prNumber: 611,
  candidateBranch: 'codex/r6b-selective-from-r5b-20261011',
  candidateSha: 'cda7ace863b39eb9419603441f4b5a37048eb288',
  candidateCiRun: 38125602289,
  deploymentId: 'dpl_9v5f7umGcZ4AwTjn1NWuhd24BHoo',
  previewUrl: 'https://sms-v3-staging-3mc9t05ln-godzillazz.vercel.app',
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  teamId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  frozenProductionSha: '77641a2657aa4fd05276afe645dd32648f5cc56b',
  productionDeploymentId: 'dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP',
  canonicalAliases: ['sms-v3-staging-ten.vercel.app', 'sms-v3-staging-godzillazzz.vercel.app'],
  trustedOrigin: 'https://sms-v3-staging-ten.vercel.app',
  untrustedOrigin: 'https://r6b-untrusted.invalid',
  environment: 'Hosted UAT',
  issueComment: '/sms-v3-r6b-preview-cors-20261011'
});
const SHA = /^[0-9a-f]{40}$/;
const SAFE_METHODS = new Set(['GET', 'OPTIONS']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function guard(condition, code) {
  if (!condition) fail(code);
}
function safeMethod(method) {
  guard(SAFE_METHODS.has(method), 'UNSAFE_METHOD_REJECTED');
}
function origin(value) {
  let url;
  try { url = new URL(value); } catch { fail('ORIGIN_INVALID'); }
  guard(url.protocol === 'https:' && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash, 'ORIGIN_INVALID');
  return url.origin;
}
function verifyEvent(event, env) {
  guard(env.GITHUB_REPOSITORY === EXPECTED.repository
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_EVENT_NAME === 'issue_comment'
    && env.GITHUB_RUN_ATTEMPT === '1'
    && SHA.test(env.GITHUB_SHA || '')
    && Number.isSafeInteger(Number(env.GITHUB_RUN_ID))
    && Number(env.GITHUB_RUN_ID) > 0, 'TRUSTED_MAIN_EVENT_REQUIRED');
  guard(event && event.action === 'created'
    && event.issue && event.issue.number === EXPECTED.prNumber
    && event.issue.state === 'open'
    && event.issue.pull_request
    && event.comment && Number.isSafeInteger(event.comment.id)
    && event.comment.id > 0, 'OWNER_PR_COMMENT_REQUIRED');
  for (const actor of [event.sender, event.comment.user]) {
    guard(actor && actor.login === EXPECTED.owner && actor.id === EXPECTED.ownerId
      && actor.type === 'User', 'OWNER_IDENTITY_REQUIRED');
  }
  guard(event.comment.author_association === 'OWNER'
    && event.comment.body === EXPECTED.issueComment, 'EXACT_OWNER_COMMAND_REQUIRED');
  return event.comment.id;
}
function verifyEnvironment(environment, policies) {
  guard(environment && environment.name === EXPECTED.environment
    && environment.can_admins_bypass === false, 'ENVIRONMENT_IDENTITY_OR_BYPASS_INVALID');
  const reviewers = environment.protection_rules && environment.protection_rules
    .find((rule) => rule.type === 'required_reviewers');
  guard(reviewers && Array.isArray(reviewers.reviewers)
    && reviewers.reviewers.some((item) => item.type === 'User'
      && item.reviewer && item.reviewer.login === EXPECTED.owner
      && item.reviewer.id === EXPECTED.ownerId), 'HUMAN_OWNER_REVIEW_REQUIRED');
  const policy = environment.deployment_branch_policy;
  guard(policy && policy.protected_branches === false
    && policy.custom_branch_policies === true
    && policies && policies.total_count === 1
    && Array.isArray(policies.branch_policies)
    && policies.branch_policies.length === 1
    && policies.branch_policies[0].name === 'main'
    && policies.branch_policies[0].type === 'branch', 'MAIN_ONLY_ENVIRONMENT_REQUIRED');
}
function exactCi(response, sha, branch, event, expectedId) {
  guard(response && Array.isArray(response.workflow_runs), 'CI_RESPONSE_INVALID');
  const match = response.workflow_runs.find((run) => run.id === expectedId
    && run.name === 'CI' && run.path === '.github/workflows/ci.yml'
    && run.head_sha === sha && run.head_branch === branch && run.event === event
    && run.status === 'completed' && run.conclusion === 'success');
  guard(match, 'EXACT_HEAD_CI_REQUIRED');
  return match.id;
}
function verifyPr(pr, branchSha, mainSha) {
  guard(pr && pr.number === EXPECTED.prNumber && pr.state === 'open' && pr.draft === true
    && pr.head && pr.head.ref === EXPECTED.candidateBranch
    && pr.head.sha === EXPECTED.candidateSha
    && pr.base && pr.base.ref === 'codex/r6b-review-base-r5b-20261011'
    && pr.base.sha === EXPECTED.frozenProductionSha
    && branchSha === EXPECTED.candidateSha
    && SHA.test(mainSha), 'CANDIDATE_PR_IDENTITY_MISMATCH');
}
function verifyDeployment(record, byHost) {
  const host = new URL(EXPECTED.previewUrl).hostname;
  const matches = (item) => item && item.id === EXPECTED.deploymentId
    && item.name === 'sms-v3-staging'
    && (item.projectId === EXPECTED.projectId || item.project && item.project.id === EXPECTED.projectId)
    && item.url === host
    && (item.readyState || item.state) === 'READY'
    && (item.target === null || item.target === 'preview')
    && item.meta && item.meta.githubCommitSha === EXPECTED.candidateSha
    && item.meta.githubCommitRef === EXPECTED.candidateBranch
    && item.meta.githubOrg === 'godzillazzz'
    && item.meta.githubRepo === 'SMS-v3';
  guard(matches(record) && matches(byHost), 'NATIVE_PREVIEW_IDENTITY_MISMATCH');
  return { deploymentId: record.id, projectId: EXPECTED.projectId, target: 'preview', sha: EXPECTED.candidateSha };
}
function header(headers, name) {
  if (headers && typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? entry[1] : null;
}
function listHeader(headers, name) {
  return String(header(headers, name) || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}
function verifyCors(trusted, untrusted) {
  guard(trusted && trusted.status === 204
    && header(trusted.headers, 'access-control-allow-origin') === EXPECTED.trustedOrigin
    && header(trusted.headers, 'access-control-allow-credentials') === 'true'
    && listHeader(trusted.headers, 'access-control-allow-methods').includes('get')
    && listHeader(trusted.headers, 'access-control-allow-headers').includes('authorization')
    && listHeader(trusted.headers, 'access-control-allow-headers').includes('content-type'),
  'TRUSTED_CORS_FAILED');
  guard(untrusted && untrusted.status === 403
    && header(untrusted.headers, 'access-control-allow-origin') === null
    && header(untrusted.headers, 'access-control-allow-credentials') !== 'true',
  'UNTRUSTED_CORS_FAILED');
}
function verifyReadiness(health, healthBody, ready, readyBody) {
  guard(health && health.status === 200 && healthBody && healthBody.status === 'ok', 'PREVIEW_HEALTH_FAILED');
  guard(ready && ready.status === 200 && readyBody
    && readyBody.status === 'ready' && readyBody.database === 'ok', 'PREVIEW_READINESS_FAILED');
}
function assertSanitized(value, secrets) {
  const output = JSON.stringify(value);
  guard(!(secrets || []).filter(Boolean).some((secret) => output.includes(secret)), 'SECRET_LEAK_REJECTED');
  guard(!/Bearer\s|postgres(?:ql)?:\/\/|x-vercel-protection-bypass|-----BEGIN .*PRIVATE KEY/i.test(output),
    'UNSAFE_EVIDENCE_REJECTED');
  return value;
}

function createClient(env, fetchImpl = globalThis.fetch) {
  async function request(url, method, headers) {
    safeMethod(method);
    let parsed;
    try { parsed = new URL(url); } catch { fail('REQUEST_URL_INVALID'); }
    guard(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'REQUEST_URL_INVALID');
    try {
      const response = await fetchImpl(parsed, {
        method, headers: headers || {}, redirect: 'manual', signal: AbortSignal.timeout(15000)
      });
      guard(response.status < 300 || response.status >= 400, 'REDIRECT_REJECTED');
      return response;
    } catch (error) {
      if (error && error.code) throw error;
      fail(parsed.hostname === 'api.vercel.com' ? 'VERCEL_API_GET_FAILED' : 'PREVIEW_REQUEST_FAILED');
    }
  }
  async function json(url, token, failureCode) {
    const response = await request(url, 'GET', {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    });
    guard(response.status === 200, failureCode);
    try { return await response.json(); } catch { fail(failureCode); }
  }
  async function github(path) {
    guard(Boolean(env.GH_TOKEN), 'GITHUB_TOKEN_REQUIRED');
    return json('https://api.github.com/repos/' + EXPECTED.repository + '/' + path,
      env.GH_TOKEN, 'GITHUB_API_FAILED_CLOSED');
  }
  async function vercel(path) {
    guard(Boolean(env.VERCEL_TOKEN), 'VERCEL_TOKEN_REQUIRED');
    const url = new URL('https://api.vercel.com/' + path);
    url.searchParams.set('teamId', EXPECTED.teamId);
    return json(url.toString(), env.VERCEL_TOKEN, 'VERCEL_API_FAILED_CLOSED');
  }
  return { request, github, vercel };
}

async function verifyGovernance(api) {
  const environmentPath = 'environments/' + encodeURIComponent(EXPECTED.environment);
  const values = await Promise.all([
    api.github(environmentPath),
    api.github(environmentPath + '/deployment-branch-policies?per_page=100'),
    api.github('branches/main')
  ]);
  verifyEnvironment(values[0], values[1]);
  guard(values[2] && values[2].protected === true, 'PROTECTED_MAIN_REQUIRED');
}
async function verifySourceAndCi(api, env) {
  const refs = await Promise.all([
    api.github('git/ref/heads/' + EXPECTED.candidateBranch),
    api.github('git/ref/heads/main')
  ]);
  const branchSha = refs[0] && refs[0].object && refs[0].object.sha;
  const mainSha = refs[1] && refs[1].object && refs[1].object.sha;
  guard(SHA.test(branchSha || '') && mainSha === env.GITHUB_SHA, 'TRUSTED_MAIN_OR_CANDIDATE_MOVED');
  const pr = await api.github('pulls/' + EXPECTED.prNumber);
  verifyPr(pr, branchSha, mainSha);
  const runs = await Promise.all([
    api.github('actions/runs?head_sha=' + EXPECTED.candidateSha + '&per_page=100'),
    api.github('actions/runs?head_sha=' + mainSha + '&per_page=100')
  ]);
  const applicationCi = exactCi(runs[0], EXPECTED.candidateSha, EXPECTED.candidateBranch,
    'workflow_dispatch', EXPECTED.candidateCiRun);
  const controlRun = (runs[1].workflow_runs || [])
    .filter((run) => run.name === 'CI' && run.path === '.github/workflows/ci.yml'
      && run.head_sha === mainSha && run.head_branch === 'main' && run.event === 'push'
      && run.status === 'completed' && run.conclusion === 'success')
    .sort((a, b) => b.id - a.id)[0];
  guard(controlRun && Number.isSafeInteger(controlRun.id) && controlRun.id > 0,
    'TRUSTED_MAIN_EXACT_CI_REQUIRED');
  return { candidateSha: branchSha, controlSha: mainSha, applicationCi, controlCi: controlRun.id };
}
async function prepare(event, env, fetchImpl) {
  const commentId = verifyEvent(event, env);
  const api = createClient(env, fetchImpl);
  await verifyGovernance(api);
  const identities = await verifySourceAndCi(api, env);
  const plan = {
    version: 1, ...identities, commentId, runId: Number(env.GITHUB_RUN_ID),
    deploymentId: EXPECTED.deploymentId, previewUrl: EXPECTED.previewUrl,
    trustedOrigin: EXPECTED.trustedOrigin
  };
  assertSanitized(plan, [env.GH_TOKEN]);
  return plan;
}
function verifyPlan(plan, event, env) {
  const commentId = verifyEvent(event, env);
  guard(plan && plan.version === 1 && plan.commentId === commentId
    && plan.runId === Number(env.GITHUB_RUN_ID)
    && plan.controlSha === env.GITHUB_SHA
    && plan.candidateSha === EXPECTED.candidateSha
    && plan.applicationCi === EXPECTED.candidateCiRun
    && plan.deploymentId === EXPECTED.deploymentId
    && plan.previewUrl === EXPECTED.previewUrl
    && origin(plan.trustedOrigin) === EXPECTED.trustedOrigin,
  'PLAN_IDENTITY_INVALID');
  return plan;
}
function verifyDeploymentRecord(record, expectedId) {
  const host = new URL(EXPECTED.previewUrl).hostname;
  guard(record && record.id === expectedId && record.name === 'sms-v3-staging'
    && (record.projectId === EXPECTED.projectId || record.project && record.project.id === EXPECTED.projectId)
    && record.url === host && (record.readyState || record.state) === 'READY'
    && (record.target === null || record.target === 'preview')
    && record.meta && record.meta.githubCommitSha === EXPECTED.candidateSha
    && record.meta.githubCommitRef === EXPECTED.candidateBranch
    && record.meta.githubOrg === 'godzillazzz' && record.meta.githubRepo === 'SMS-v3',
  'NATIVE_PREVIEW_IDENTITY_MISMATCH');
}
function verifyProduction(record) {
  guard(record && record.id === EXPECTED.productionDeploymentId
    && record.target === 'production' && (record.readyState || record.state) === 'READY'
    && (record.projectId === EXPECTED.projectId || record.project && record.project.id === EXPECTED.projectId) && record.meta
    && record.meta.githubCommitSha === EXPECTED.frozenProductionSha,
  'FROZEN_PRODUCTION_IDENTITY_MISMATCH');
}
async function jsonRequest(client, url, method, headers, failureCode) {
  const response = await client.request(url, method, headers);
  guard(response.status === 200, failureCode);
  try { return { response, body: await response.json() }; } catch { fail(failureCode); }
}
async function canonicalSnapshot(api) {
  const snapshots = await Promise.all(EXPECTED.canonicalAliases.map(async (alias) => {
    const record = await api.vercel('v4/aliases/' + encodeURIComponent(alias));
    guard(record && record.alias === alias && record.deploymentId === EXPECTED.productionDeploymentId,
      'CANONICAL_IDENTITY_UNVERIFIED');
    return { alias, deploymentId: record.deploymentId };
  }));
  return snapshots;
}
async function verify(plan, event, env, fetchImpl = globalThis.fetch) {
  verifyPlan(plan, event, env);
  guard(env.VERCEL_TOKEN && env.VERCEL_AUTOMATION_BYPASS_SECRET,
    'PROTECTED_PREVIEW_CREDENTIALS_MISSING');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET', 'SMTP_PASSWORD', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_PASSWORD', 'UAT_SUPERVISOR_PASSWORD',
    'UAT_VIEWER_PASSWORD']) {
    guard(!env[key], 'UNEXPECTED_DATA_OR_UAT_CREDENTIAL');
  }
  const api = createClient(env, fetchImpl);
  await verifyGovernance(api);
  await verifySourceAndCi(api, env);

  const deploymentHost = new URL(EXPECTED.previewUrl).hostname;
  const [byId, byHost, production, domain] = await Promise.all([
    api.vercel('v13/deployments/' + EXPECTED.deploymentId),
    api.vercel('v13/deployments/' + deploymentHost),
    api.vercel('v13/deployments/' + EXPECTED.productionDeploymentId),
    api.vercel('v9/projects/' + EXPECTED.projectId + '/domains/' + EXPECTED.trustedOrigin.replace('https://', ''))
  ]);
  verifyDeployment(byId, byHost);
  verifyDeploymentRecord(byId, EXPECTED.deploymentId);
  verifyDeploymentRecord(byHost, EXPECTED.deploymentId);
  verifyProduction(production);
  guard(domain && domain.name === EXPECTED.trustedOrigin.replace('https://', '')
    && domain.verified === true && domain.gitBranch === null, 'TRUSTED_ORIGIN_CONFIGURATION_UNVERIFIED');

  const aliasesBefore = await canonicalSnapshot(api);
  const bypass = { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET };
  const health = await jsonRequest(api, EXPECTED.previewUrl + '/api/v1/health', 'GET', bypass,
    'PREVIEW_HEALTH_FAILED');
  const ready = await jsonRequest(api, EXPECTED.previewUrl + '/api/v1/ready', 'GET', bypass,
    'PREVIEW_READINESS_FAILED');
  verifyReadiness(health.response, health.body, ready.response, ready.body);

  const corsHeaders = {
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,content-type'
  };
  const trusted = await api.request(EXPECTED.previewUrl + '/api/v1/health', 'OPTIONS', {
    ...bypass, Origin: EXPECTED.trustedOrigin, ...corsHeaders
  });
  const untrusted = await api.request(EXPECTED.previewUrl + '/api/v1/health', 'OPTIONS', {
    ...bypass, Origin: EXPECTED.untrustedOrigin, ...corsHeaders
  });
  verifyCors(trusted, untrusted);

  const aliasesAfter = await canonicalSnapshot(api);
  guard(JSON.stringify(aliasesBefore) === JSON.stringify(aliasesAfter), 'CANONICAL_CHANGED_STOP');
  const evidence = {
    candidate_sha: EXPECTED.candidateSha,
    candidate_preview_deployment: EXPECTED.deploymentId,
    project_id: EXPECTED.projectId,
    target: 'preview',
    health: 'PASS',
    readiness_database: 'PASS',
    trusted_origin: EXPECTED.trustedOrigin,
    trusted_origin_source: 'verified Vercel project domain metadata',
    trusted_cors: 'PASS',
    credentials_policy: 'PASS',
    untrusted_origin: EXPECTED.untrustedOrigin,
    untrusted_cors: 'PASS',
    canonical_aliases_unchanged: 'PASS',
    methods_executed: ['GET', 'OPTIONS'],
    production_deployment_or_mutation: 'NOT_EXECUTED',
    hosted_uat: 'DEFERRED'
  };
  assertSanitized(evidence, [env.GH_TOKEN, env.VERCEL_TOKEN, env.VERCEL_AUTOMATION_BYPASS_SECRET]);
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
      '### R6-B Candidate Preview CORS — read-only\n\n'
      + '\`\`\`json\n' + JSON.stringify(evidence, null, 2) + '\n\`\`\`\n');
  }
  return evidence;
}
async function main(args, env = process.env) {
  try {
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    if (args[0] === 'prepare') {
      const plan = await prepare(event, env);
      guard(env.GITHUB_OUTPUT && env.GITHUB_STEP_SUMMARY, 'GITHUB_OUTPUT_REQUIRED');
      fs.appendFileSync(env.GITHUB_OUTPUT, 'plan=' + JSON.stringify(plan) + '\n');
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
        '### R6-B Candidate Preview plan\n\n'
        + 'Candidate SHA: ' + plan.candidateSha + '\n\n'
        + 'Candidate Preview: ' + plan.deploymentId + '\n\n'
        + 'Trusted main SHA: ' + plan.controlSha + '\n\n'
        + 'Exact CI: ' + plan.applicationCi + '\n\n'
        + 'The next job uses the Hosted UAT Environment; Owner approval is required before Vercel credentials are exposed. No database credentials or business writes are used.\n');
    } else if (args[0] === 'verify') {
      const plan = JSON.parse(env.R6B_CORS_PLAN || '');
      await verify(plan, event, env);
    } else {
      fail('MODE_INVALID');
    }
    return 0;
  } catch (error) {
    const code = error && error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'FAIL_CLOSED';
    console.error('R6B_CANDIDATE_PREVIEW_CORS=' + code);
    process.exitCode = 1;
    return 1;
  }
}
if (require.main === module) main(process.argv.slice(2)).then((status) => { process.exitCode = status; });
module.exports = {
  EXPECTED, safeMethod, origin, verifyEvent, verifyEnvironment, exactCi, verifyPr,
  verifyDeployment, verifyCors, verifyReadiness, assertSanitized, verifyDeploymentRecord,
  verifyProduction, verifyPlan
};
