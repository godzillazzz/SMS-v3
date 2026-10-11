'use strict';

// Operational GET/OPTIONS checks only. Never loads application/PR code or a DB client.
const fs = require('node:fs');
const REPO = 'godzillazzz/SMS-v3';
const OWNER = { login: 'godzillazzz', id: 279642101 };
const ISSUE = 551;
const BRANCH = 'fix/serverless-database-reliability';
const ENVIRONMENT = 'Hosted UAT';
const PROJECT = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const TEAM = 'team_nemCExHbZ8EAhSgsvefHPAEz';
const WORKFLOW = '.github/workflows/cloud-preview-operations.yml';
const SHA = /^[0-9a-f]{40}$/;
const HOST = /^sms-v3-staging-[a-z0-9]{9}-godzillazz\.vercel\.app$/;
const CANONICALS = ['sms-v3-staging-ten.vercel.app', 'sms-v3-staging-godzillazzz.vercel.app'];

const SAFE_ERRORS = new Set();
function failure(code) { SAFE_ERRORS.add(code); return new Error(code); }
function guard(ok, code) { if (!ok) throw failure(code); }
function number(value) { return Number.isSafeInteger(value) && value > 0; }
function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('PREVIEW_URL_INVALID'); }
  guard(url.protocol === 'https:' && HOST.test(url.hostname) && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash, 'PREVIEW_URL_INVALID');
  return url.origin;
}
function verifyEvent(event, env) {
  guard(env.GITHUB_REPOSITORY === REPO && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_EVENT_NAME === 'issue_comment' && env.GITHUB_RUN_ATTEMPT === '1'
    && SHA.test(env.GITHUB_SHA || '') && number(Number(env.GITHUB_RUN_ID)), 'TRUSTED_MAIN_EVENT_REQUIRED');
  guard(event?.action === 'created' && event.issue?.number === ISSUE && event.issue.state === 'open'
    && !event.issue.pull_request && number(event.comment?.id), 'OWNER_MAILBOX_EVENT_REQUIRED');
  for (const actor of [event.sender, event.comment.user]) {
    guard(actor?.login === OWNER.login && actor.id === OWNER.id && actor.type === 'User', 'OWNER_IDENTITY_REQUIRED');
  }
  guard(event.comment.author_association === 'OWNER'
    && event.comment.body === '/sms-v3-preview-check', 'EXACT_OWNER_COMMAND_REQUIRED');
  return event.comment.id;
}
function verifyEnvironment(environment, policies) {
  guard(environment?.name === ENVIRONMENT, 'ENVIRONMENT_IDENTITY_MISMATCH');
  guard(environment.can_admins_bypass === false, 'ENVIRONMENT_BYPASS_FORBIDDEN');
  const review = environment.protection_rules?.find(rule => rule.type === 'required_reviewers');
  guard(review?.reviewers?.some(item => item.type === 'User'
    && item.reviewer?.login === OWNER.login && item.reviewer.id === OWNER.id), 'HUMAN_OWNER_REVIEW_REQUIRED');
  guard(environment.deployment_branch_policy?.protected_branches === false
    && environment.deployment_branch_policy.custom_branch_policies === true, 'MAIN_ONLY_ENVIRONMENT_REQUIRED');
  guard(policies?.total_count === 1 && policies.branch_policies?.length === 1
    && policies.branch_policies[0].name === 'main' && policies.branch_policies[0].type === 'branch',
  'MAIN_ONLY_ENVIRONMENT_REQUIRED');
}
function exactCi(response, sha, branch, event) {
  guard(Array.isArray(response?.workflow_runs), 'CI_RESPONSE_INVALID');
  const runs = response.workflow_runs.filter(run => run.name === 'CI' && run.path === '.github/workflows/ci.yml'
    && run.head_sha === sha && run.head_branch === branch && run.event === event && number(run.id));
  runs.sort((a, b) => b.id - a.id);
  guard(runs[0]?.status === 'completed' && runs[0].conclusion === 'success', 'LATEST_EXACT_SHA_CI_REQUIRED');
  return runs[0].id;
}
function verifyPlan(plan, env) {
  guard(plan?.version === 1 && SHA.test(plan.application_sha || '') && plan.control_sha === env.GITHUB_SHA
    && SHA.test(plan.control_sha) && plan.run_id === Number(env.GITHUB_RUN_ID)
    && number(plan.comment_id) && number(plan.deployment_id) && number(plan.application_ci)
    && number(plan.control_ci), 'PLAN_IDENTITY_INVALID');
  guard(origin(plan.origin) === plan.origin, 'PLAN_IDENTITY_INVALID');
  return plan;
}
function verifyDeployment(record, plan, expectedId) {
  guard(record?.id && /^dpl_[A-Za-z0-9]+$/.test(record.id)
    && (!expectedId || record.id === expectedId) && record.url === new URL(plan.origin).hostname
    && record.project?.id === PROJECT && record.name === 'sms-v3-staging'
    && record.readyState === 'READY' && (record.target === null || record.target === 'preview')
    && record.meta?.githubCommitSha === plan.application_sha && record.meta.githubCommitRef === BRANCH
    && record.meta.githubOrg === 'godzillazzz' && record.meta.githubRepo === 'SMS-v3', 'NATIVE_PREVIEW_IDENTITY_MISMATCH');
  return record.id;
}
function assertSanitized(value, secrets) {
  const text = JSON.stringify(value);
  guard(!secrets.filter(Boolean).some(secret => text.includes(secret)), 'SECRET_LEAK_REJECTED');
  guard(!/Bearer\s|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY|x-vercel-protection-bypass/i.test(text), 'UNSAFE_EVIDENCE_REJECTED');
  return value;
}

function client(env, fetchImpl = globalThis.fetch) {
  async function request(url, headers, method = 'GET', body) {
    // The sole mutation allowed by this operator is a fixed GitHub mailbox comment.
    guard(['GET', 'OPTIONS'].includes(method)
      || (method === 'POST' && url === `https://api.github.com/repos/${REPO}/issues/${ISSUE}/comments`),
    'UNSAFE_REQUEST_REJECTED');
    return fetchImpl(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  }
  async function github(path, method = 'GET', body) {
    guard(Boolean(env.GH_TOKEN), 'GITHUB_TOKEN_REQUIRED');
    const response = await request(`https://api.github.com/repos/${REPO}/${path}`, {
      Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {})
    }, method, body);
    guard(response.status === (method === 'POST' ? 201 : 200), 'GITHUB_API_FAILED_CLOSED');
    return response.json();
  }
  async function vercel(path) {
    const response = await request(`https://api.vercel.com/${path}?teamId=${TEAM}&withGitRepoInfo=true`,
      { Authorization: `Bearer ${env.VERCEL_TOKEN}` });
    guard(response.status === 200, 'VERCEL_API_FAILED_CLOSED');
    return response.json();
  }
  return { github, vercel, request };
}
async function governance(api) {
  const name = encodeURIComponent(ENVIRONMENT);
  const [environment, policies, main] = await Promise.all([
    api.github(`environments/${name}`), api.github(`environments/${name}/deployment-branch-policies?per_page=100`),
    api.github('branches/main')
  ]);
  verifyEnvironment(environment, policies);
  guard(main.protected === true, 'PROTECTED_MAIN_REQUIRED');
}
async function source(api, env) {
  const [application, control] = await Promise.all([
    api.github(`git/ref/heads/${BRANCH}`), api.github('git/ref/heads/main')
  ]);
  const sha = application.object?.sha;
  guard(SHA.test(sha || '') && control.object?.sha === env.GITHUB_SHA, 'SOURCE_HEAD_MOVED');
  return sha;
}
async function prepare(event, env, fetchImpl) {
  const commentId = verifyEvent(event, env);
  const api = client(env, fetchImpl);
  await governance(api);
  const sha = await source(api, env);
  const [appCi, controlCi, deployments] = await Promise.all([
    api.github(`actions/runs?head_sha=${sha}&per_page=100`),
    api.github(`actions/runs?head_sha=${env.GITHUB_SHA}&per_page=100`),
    api.github(`deployments?sha=${sha}&environment=Preview&per_page=100`)
  ]);
  const applicationCi = exactCi(appCi, sha, BRANCH, 'push');
  const controlCiId = exactCi(controlCi, env.GITHUB_SHA, 'main', 'push');
  guard(Array.isArray(deployments), 'PREVIEW_DEPLOYMENTS_INVALID');
  let preview;
  const bot = actor => actor?.login === 'vercel[bot]' && actor.type === 'Bot';
  for (const deployment of deployments) {
    if (deployment.sha !== sha || ![sha, BRANCH].includes(deployment.ref) || !number(deployment.id)
      || deployment.environment !== 'Preview' || deployment.production_environment !== false || !bot(deployment.creator)) continue;
    const statuses = await api.github(`deployments/${deployment.id}/statuses?per_page=1`);
    const status = Array.isArray(statuses) ? statuses[0] : null;
    if (status?.state !== 'success' || status.environment !== 'Preview' || !bot(status.creator)) continue;
    const url = origin(status.environment_url);
    guard(!status.target_url || origin(status.target_url) === url, 'PREVIEW_STATUS_URL_MISMATCH');
    preview = { deployment_id: deployment.id, origin: url };
    break;
  }
  guard(preview, 'EXACT_SHA_PREVIEW_NOT_READY');
  const marker = `<!-- sms-v3-preview-claim:${commentId} -->`;
  let exhausted = false;
  for (let page = 1; page <= 20; page++) {
    const comments = await api.github(`issues/${ISSUE}/comments?per_page=100&page=${page}`);
    guard(Array.isArray(comments), 'CLAIM_HISTORY_INVALID');
    guard(!comments.some(comment => comment.user?.login === 'github-actions[bot]'
      && comment.user.type === 'Bot' && comment.body?.startsWith(marker)), 'OWNER_COMMAND_ALREADY_CLAIMED');
    if (comments.length < 100) { exhausted = true; break; }
  }
  guard(exhausted, 'CLAIM_HISTORY_LIMIT');
  guard(await source(api, env) === sha, 'SOURCE_HEAD_MOVED');
  const plan = { version: 1, application_sha: sha, control_sha: env.GITHUB_SHA,
    application_ci: applicationCi, control_ci: controlCiId, comment_id: commentId,
    run_id: Number(env.GITHUB_RUN_ID), ...preview };
  assertSanitized(plan, [env.GH_TOKEN]);
  await api.github(`issues/${ISSUE}/comments`, 'POST', {
    body: `${marker}\nRead-only Preview request claimed. Application ${sha}; trusted main ${env.GITHUB_SHA}.\nRun: https://github.com/${REPO}/actions/runs/${plan.run_id}\nNext gate: Hosted UAT human Environment approval. Final Hosted UAT and Production are NOT requested.`
  });
  return plan;
}
async function verify(plan, event, env, fetchImpl) {
  const commentId = verifyEvent(event, env);
  verifyPlan(plan, env);
  guard(plan.comment_id === commentId, 'PLAN_EVENT_MISMATCH');
  guard(env.VERCEL_TOKEN && env.VERCEL_AUTOMATION_BYPASS_SECRET, 'PROTECTED_PREVIEW_CREDENTIALS_MISSING');
  guard(!env.DATABASE_URL && !env.DIRECT_URL && !env.SUPABASE_SERVICE_ROLE_KEY && !env.CRON_SECRET,
    'DATABASE_CREDENTIALS_FORBIDDEN');
  const api = client(env, fetchImpl);
  await governance(api);
  guard(await source(api, env) === plan.application_sha, 'SOURCE_HEAD_MOVED_AFTER_APPROVAL');
  const [appCi, controlCi] = await Promise.all([
    api.github(`actions/runs?head_sha=${plan.application_sha}&per_page=100`),
    api.github(`actions/runs?head_sha=${plan.control_sha}&per_page=100`)
  ]);
  exactCi(appCi, plan.application_sha, BRANCH, 'push');
  exactCi(controlCi, plan.control_sha, 'main', 'push');
  const host = new URL(plan.origin).hostname;
  const id = verifyDeployment(await api.vercel(`v13/deployments/${host}`), plan);
  verifyDeployment(await api.vercel(`v13/deployments/${id}`), plan, id);
  const aliases = async () => Promise.all(CANONICALS.map(async alias => {
    const data = await api.vercel(`v4/aliases/${alias}`);
    guard(data.alias === alias && /^dpl_[A-Za-z0-9]+$/.test(data.deploymentId || ''), 'CANONICAL_IDENTITY_UNVERIFIED');
    return data.deploymentId;
  }));
  const before = await aliases();
  guard(before.every(deployment => deployment !== id), 'PREVIEW_IS_CANONICAL');
  const bypass = { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET };
  async function check(path, method = 'GET', headers = {}) {
    return api.request(`${plan.origin}${path}`, { ...bypass, ...headers }, method);
  }
  const health = await check('/api/v1/health');
  guard(health.status === 200 && (await health.json()).status === 'ok', 'PREVIEW_HEALTH_FAILED');
  const ready = await check('/api/v1/ready');
  guard(ready.status === 200, 'PREVIEW_READINESS_FAILED');
  const readiness = await ready.json();
  guard(readiness.status === 'ready' && readiness.database === 'ok', 'PREVIEW_READINESS_FAILED');
  const corsHeaders = { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type' };
  const trusted = await check('/api/v1/health', 'OPTIONS', { ...corsHeaders, Origin: plan.origin });
  guard(trusted.status === 204 && trusted.headers.get('access-control-allow-origin') === plan.origin
    && trusted.headers.get('access-control-allow-credentials') === 'true', 'TRUSTED_CORS_FAILED');
  const untrusted = await check('/api/v1/health', 'OPTIONS', { ...corsHeaders, Origin: 'https://example.invalid' });
  guard(untrusted.status === 403 && !untrusted.headers.get('access-control-allow-origin'), 'UNTRUSTED_CORS_FAILED');
  verifyDeployment(await api.vercel(`v13/deployments/${host}`), plan, id);
  guard(JSON.stringify(before) === JSON.stringify(await aliases()), 'CANONICAL_CHANGED_STOP');
  guard(await source(api, env) === plan.application_sha, 'SOURCE_HEAD_MOVED_DURING_CHECK');
  const evidence = { ...plan, vercel_deployment_id: id, health: 'PASS', database_readiness: 'PASS',
    trusted_cors: 'PASS', untrusted_cors: 'PASS', canonical_unchanged: 'PASS',
    production_deploy: 'NOT_EXECUTED', hosted_uat: 'DEFERRED', secret_leak_count: 0 };
  return assertSanitized(evidence, [env.GH_TOKEN, env.VERCEL_TOKEN, env.VERCEL_AUTOMATION_BYPASS_SECRET]);
}
async function publish(env, fetchImpl) {
  guard(env.GITHUB_REPOSITORY === REPO && env.GITHUB_REF === 'refs/heads/main'
    && SHA.test(env.GITHUB_SHA || '') && number(Number(env.GITHUB_RUN_ID)), 'TRUSTED_MAIN_EVENT_REQUIRED');
  guard(['success', 'failure', 'cancelled', 'skipped'].includes(env.CLOUD_PREVIEW_RESULT), 'RESULT_INVALID');
  const body = `Cloud-only read-only Preview operation: **${env.CLOUD_PREVIEW_RESULT.toUpperCase()}**.\nRun: https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}\nProtected Environment review remains mandatory. See run summary for exact source evidence. No Production dispatch, DB mutation or Final Hosted UAT.`;
  assertSanitized(body, [env.GH_TOKEN]);
  await client(env, fetchImpl).github(`issues/${ISSUE}/comments`, 'POST', { body });
}
async function main(args, env = process.env) {
  try {
    if (args[0] === 'publish') { await publish(env); return 0; }
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    if (args[0] === 'prepare') {
      const plan = await prepare(event, env);
      fs.appendFileSync(env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Read-only Preview plan\n\nApplication: ${plan.application_sha}\n\nTrusted main: ${plan.control_sha}\n\nPreview: ${plan.origin}\n\nCI: ${plan.application_ci} / ${plan.control_ci}\n\nWAITING for Hosted UAT human approval; no UAT or Production dispatch.\n`);
    } else if (args[0] === 'verify') {
      const evidence = await verify(JSON.parse(env.CLOUD_PREVIEW_PLAN), event, env);
      // Only a validated, leak-scanned allowlist is published; raw responses never leave this process.
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Read-only Preview result\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`);
    } else { throw failure('MODE_INVALID'); }
    return 0;
  } catch (error) {
    const code = SAFE_ERRORS.has(error.message) ? error.message : 'FAIL_CLOSED';
    console.error(`CLOUD_PREVIEW_OPERATIONS=${code}`);
    return 1;
  }
}
if (require.main === module) main(process.argv.slice(2)).then(status => { process.exitCode = status; });
module.exports = { REPO, ISSUE, BRANCH, ENVIRONMENT, PROJECT, TEAM, WORKFLOW, origin, verifyEvent,
  verifyEnvironment, exactCi, verifyPlan, verifyDeployment, assertSanitized, client, prepare, verify, publish, main };
