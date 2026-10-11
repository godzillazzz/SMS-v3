'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const operator = require('../scripts/ci/cloud-preview-operations.cjs');

const APP = 'a'.repeat(40);
const CONTROL = 'b'.repeat(40);
const ORIGIN = 'https://sms-v3-staging-abcdef123-godzillazz.vercel.app';
const ID = 'dpl_DisposablePreviewFixture';
function event() {
  const owner = { login: 'godzillazzz', id: 279642101, type: 'User' };
  return { action: 'created', issue: { number: 551, state: 'open' }, sender: owner,
    comment: { id: 12, user: owner, author_association: 'OWNER', body: '/sms-v3-preview-check' } };
}
function env() {
  return { GITHUB_REPOSITORY: 'godzillazzz/SMS-v3', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '22', GITHUB_SHA: CONTROL, GH_TOKEN: 'fixture-github-secret-value',
    VERCEL_TOKEN: 'fixture-vercel-secret-value', VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-protection-secret-value' };
}
function environment() {
  return { name: 'Hosted UAT', can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers',
    reviewers: [{ type: 'User', reviewer: { login: 'godzillazzz', id: 279642101 } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
}
function policies() { return { total_count: 1, branch_policies: [{ type: 'branch', name: 'main' }] }; }
function ci(sha, branch) {
  return { workflow_runs: [{ id: sha === APP ? 31 : 32, name: 'CI', path: '.github/workflows/ci.yml',
    head_sha: sha, head_branch: branch, event: 'push', status: 'completed', conclusion: 'success' }] };
}
function plan() {
  return { version: 1, application_sha: APP, control_sha: CONTROL, application_ci: 31,
    control_ci: 32, comment_id: 12, run_id: 22, deployment_id: 33, origin: ORIGIN };
}
function native() {
  return { id: ID, url: new URL(ORIGIN).hostname, name: 'sms-v3-staging', project: { id: operator.PROJECT },
    readyState: 'READY', target: null, meta: { githubCommitSha: APP, githubCommitRef: operator.BRANCH,
      githubOrg: 'godzillazzz', githubRepo: 'SMS-v3' } };
}
function fixture(change = () => {}) {
  const requests = [];
  const comments = [];
  const bot = { login: 'vercel[bot]', type: 'Bot' };
  async function fetchImpl(raw, options) {
    const url = new URL(raw);
    requests.push({ url: raw, options });
    let value;
    let status = 200;
    let headers = {};
    if (url.hostname === 'api.github.com') {
      const path = decodeURIComponent(url.pathname).replace('/repos/godzillazzz/SMS-v3/', '');
      if (path.endsWith('/deployment-branch-policies')) value = policies();
      else if (path === 'environments/Hosted UAT') value = environment();
      else if (path === 'branches/main') value = { protected: true };
      else if (path === 'git/ref/heads/main') value = { object: { sha: CONTROL } };
      else if (path === `git/ref/heads/${operator.BRANCH}`) value = { object: { sha: APP } };
      else if (path === 'actions/runs') value = ci(url.searchParams.get('head_sha'), url.searchParams.get('head_sha') === APP ? operator.BRANCH : 'main');
      else if (path === 'deployments') value = [{ id: 33, sha: APP, ref: operator.BRANCH,
        environment: 'Preview', production_environment: false, creator: bot }];
      else if (path === 'deployments/33/statuses') value = [{ state: 'success', environment: 'Preview',
        creator: bot, environment_url: ORIGIN, target_url: ORIGIN }];
      else if (path === 'issues/551/comments' && options.method === 'POST') {
        status = 201; value = { id: 44 }; comments.push(JSON.parse(options.body));
      } else if (path === 'issues/551/comments') value = [];
      else throw new Error(`Unexpected GitHub request ${path}`);
    } else if (url.hostname === 'api.vercel.com') {
      if (url.pathname.startsWith('/v13/deployments/')) value = native();
      else if (url.pathname.startsWith('/v4/aliases/')) value = { alias: url.pathname.split('/').at(-1), deploymentId: 'dpl_FrozenProductionFixture' };
      else throw new Error('Unexpected Vercel request');
    } else if (url.origin === ORIGIN) {
      if (options.method === 'OPTIONS') {
        const trusted = options.headers.Origin === ORIGIN;
        status = trusted ? 204 : 403;
        if (trusted) headers = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' };
      } else if (url.pathname === '/api/v1/health') value = { status: 'ok' };
      else if (url.pathname === '/api/v1/ready') value = { status: 'ready', database: 'ok' };
      else throw new Error('Business endpoint forbidden');
    } else throw new Error('Unapproved network target');
    const response = { status, value, headers };
    change(url, options, response, requests);
    return { status: response.status, headers: new Headers(response.headers), json: async () => response.value };
  }
  return { fetchImpl, requests, comments };
}

test('owner command has no technical inputs and rejects forged, PR, edited, fork and replay events', () => {
  assert.equal(operator.verifyEvent(event(), env()), 12);
  const cases = [e => { e.sender.id = 7; }, e => { e.sender.type = 'Bot'; },
    e => { e.comment.author_association = 'MEMBER'; }, e => { e.issue.pull_request = {}; },
    e => { e.action = 'edited'; }, e => { e.issue.number = 548; }, e => { e.issue.state = 'closed'; },
    e => { e.comment.body += ' ' + APP; }, e => { e.comment.body += '\n'; }, e => { e.comment.id = -1; }];
  for (const mutate of cases) { const e = structuredClone(event()); mutate(e); assert.throws(() => operator.verifyEvent(e, env())); }
  for (const patch of [{ GITHUB_REF: 'refs/heads/unreviewed' }, { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_REPOSITORY: 'attacker/SMS-v3' }, { GITHUB_EVENT_NAME: 'pull_request_target' }]) {
    assert.throws(() => operator.verifyEvent(event(), { ...env(), ...patch }));
  }
});
test('main-only environment and actual Owner reviewer are required; tags, globs, absent approval fail closed', () => {
  operator.verifyEnvironment(environment(), policies());
  for (const mutate of [e => { e.can_admins_bypass = true; }, e => { delete e.can_admins_bypass; }, e => { e.protection_rules = []; }, e => { e.name = 'production-sms-v3-staging'; },
    e => { e.protection_rules[0].reviewers[0].reviewer.id = 7; }, e => { e.deployment_branch_policy.custom_branch_policies = false; }]) {
    const e = environment(); mutate(e); assert.throws(() => operator.verifyEnvironment(e, policies()));
  }
  for (const patch of [{ name: '*' }, { name: 'main', type: 'tag' }, { name: 'fix/*' }]) {
    assert.throws(() => operator.verifyEnvironment(environment(), { total_count: 1, branch_policies: [patch] }));
  }
  assert.throws(() => operator.verifyEnvironment(environment(), { total_count: 2, branch_policies: policies().branch_policies }));
});
test('newest exact source CI, path and push event required; old green result cannot conceal failure', () => {
  assert.equal(operator.exactCi(ci(APP, operator.BRANCH), APP, operator.BRANCH, 'push'), 31);
  for (const patch of [{ head_sha: CONTROL }, { path: 'untrusted.yml' }, { event: 'pull_request' },
    { status: 'in_progress' }, { conclusion: 'skipped' }, { head_branch: 'unreviewed' }]) {
    const r = ci(APP, operator.BRANCH); Object.assign(r.workflow_runs[0], patch);
    assert.throws(() => operator.exactCi(r, APP, operator.BRANCH, 'push'));
  }
  const r = ci(APP, operator.BRANCH);
  r.workflow_runs.push({ ...r.workflow_runs[0], id: 100, conclusion: 'failure' });
  assert.throws(() => operator.exactCi(r, APP, operator.BRANCH, 'push'));
});
test('only immutable project Preview accepted; no canonical, branch alias, URL credentials, redirects or arbitrary origin', () => {
  assert.equal(operator.origin(ORIGIN), ORIGIN);
  for (const value of ['https://sms-v3-staging-ten.vercel.app', ORIGIN + '?token=x', ORIGIN + '/login',
    ORIGIN.replace('https://', 'https://user:password@'), 'https://attacker.invalid', ORIGIN.replace('abcdef123', 'git-fix')]) {
    assert.throws(() => operator.origin(value));
  }
  for (const patch of [{ target: 'production' }, { target: undefined }, { readyState: 'BUILDING' },
    { project: { id: 'prj_untrusted' } }, { meta: { ...native().meta, githubCommitSha: CONTROL } },
    { meta: { ...native().meta, githubCommitRef: 'unreviewed' } }, { url: 'attacker.invalid' }]) {
    assert.throws(() => operator.verifyDeployment({ ...native(), ...patch }, plan()));
  }
});
test('source resolution, exact CI, ready GitHub Preview and claim use cloud APIs without local executables', async () => {
  const f = fixture();
  const resolved = await operator.prepare(event(), env(), f.fetchImpl);
  assert.deepEqual(resolved, plan());
  assert.equal(f.comments.length, 1);
  assert.match(f.comments[0].body, /sms-v3-preview-claim:12/);
  assert.match(f.comments[0].body, /actions\/runs\/22/);
  assert.equal(f.requests.filter(r => r.options.method === 'POST').length, 1);
  assert.ok(f.requests.every(r => !r.url.includes('/dispatches') && r.options.redirect === 'manual'));
});
for (const [name, mutate] of [
  ['missing approval', (u, o, r) => { if (decodeURIComponent(u.pathname).endsWith('/environments/Hosted UAT')) r.value.protection_rules = []; }],
  ['unprotected main', (u, o, r) => { if (u.pathname.endsWith('/branches/main')) r.value.protected = false; }],
  ['unready Preview', (u, o, r) => { if (u.pathname.endsWith('/deployments/33/statuses')) r.value[0].state = 'failure'; }],
  ['forged Vercel actor', (u, o, r) => { if (u.pathname.endsWith('/deployments')) r.value[0].creator = { login: 'vercel[bot]', type: 'User' }; }],
  ['stale Integration SHA', (u, o, r, requests) => {
    if (u.pathname.includes('/git/ref/heads/fix/') && requests.filter(x => x.url.includes('/git/ref/heads/fix/')).length > 1) r.value.object.sha = CONTROL;
  }],
  ['replayed command marker', (u, o, r) => { if (u.pathname.endsWith('/issues/551/comments') && o.method === 'GET') r.value = [{ user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- sms-v3-preview-claim:12 --> claimed' }]; }],
  ['API redirect', (u, o, r) => { if (u.pathname.endsWith('/branches/main')) r.status = 302; }]
]) {
  test(`prepare fails closed before claiming: ${name}`, async () => {
    const f = fixture(mutate);
    await assert.rejects(operator.prepare(event(), env(), f.fetchImpl));
    assert.equal(f.comments.length, 0);
    assert.ok(f.requests.every(r => new URL(r.url).hostname === 'api.github.com'));
  });
}
test('read-only end-to-end fixture isolates credentials, has no DB/Production writes, sanitizes all evidence', async () => {
  const f = fixture();
  const evidence = await operator.verify(plan(), event(), env(), f.fetchImpl);
  assert.equal(evidence.vercel_deployment_id, ID);
  assert.equal(evidence.hosted_uat, 'DEFERRED');
  assert.equal(evidence.secret_leak_count, 0);
  assert.equal(evidence.canonical_unchanged, 'PASS');
  assert.ok(f.requests.every(r => ['GET', 'OPTIONS'].includes(r.options.method)));
  for (const { url, options } of f.requests) {
    const host = new URL(url).hostname;
    assert.equal(options.headers['x-vercel-protection-bypass'], host === new URL(ORIGIN).hostname ? env().VERCEL_AUTOMATION_BYPASS_SECRET : undefined);
    if (host === 'api.github.com') assert.equal(options.headers.Authorization, `Bearer ${env().GH_TOKEN}`);
    if (host === 'api.vercel.com') assert.equal(options.headers.Authorization, `Bearer ${env().VERCEL_TOKEN}`);
    if (host === new URL(ORIGIN).hostname) assert.equal(options.headers.Authorization, undefined);
  }
  for (const secret of [env().GH_TOKEN, env().VERCEL_TOKEN, env().VERCEL_AUTOMATION_BYPASS_SECRET]) assert.ok(!JSON.stringify(evidence).includes(secret));
});
for (const [name, mutate] of [
  ['Production target', (u, o, r) => { if (u.pathname.startsWith('/v13/deployments')) r.value.target = 'production'; }],
  ['wrong native SHA', (u, o, r) => { if (u.pathname.startsWith('/v13/deployments')) r.value.meta.githubCommitSha = CONTROL; }],
  ['native ID mismatch', (u, o, r) => { if (u.pathname.endsWith(ID)) r.value.id = 'dpl_AnotherPreview'; }],
  ['health redirect', (u, o, r) => { if (u.origin === ORIGIN && u.pathname.endsWith('/health') && o.method === 'GET') r.status = 307; }],
  ['database not ready', (u, o, r) => { if (u.origin === ORIGIN && u.pathname.endsWith('/ready')) r.value.database = 'error'; }],
  ['untrusted CORS credentials', (u, o, r) => { if (u.origin === ORIGIN && o.method === 'OPTIONS' && o.headers.Origin !== ORIGIN) r.headers['access-control-allow-origin'] = '*'; }],
  ['canonical changed', (u, o, r, requests) => {
    if (u.pathname.startsWith('/v4/aliases/') && requests.filter(x => x.url.includes('/v4/aliases/')).length > 2) r.value.deploymentId = 'dpl_UnexpectedProduction';
  }]
]) {
  test(`verify rejects ${name} without any corrective mutation`, async () => {
    const f = fixture(mutate);
    await assert.rejects(operator.verify(plan(), event(), env(), f.fetchImpl));
    assert.ok(f.requests.every(r => ['GET', 'OPTIONS'].includes(r.options.method)));
  });
}
test('missing protected credentials, injected DB secrets and plan replay never reach network', async () => {
  for (const patch of [{ VERCEL_TOKEN: '' }, { VERCEL_AUTOMATION_BYPASS_SECRET: '' },
    { DATABASE_URL: 'forbidden' }, { DIRECT_URL: 'forbidden' }, { CRON_SECRET: 'forbidden' }]) {
    const f = fixture();
    await assert.rejects(operator.verify(plan(), event(), { ...env(), ...patch }, f.fetchImpl));
    assert.equal(f.requests.length, 0);
  }
  for (const patch of [{ run_id: 999 }, { control_sha: APP }, { comment_id: 999 }]) {
    const f = fixture(); await assert.rejects(operator.verify({ ...plan(), ...patch }, event(), env(), f.fetchImpl));
    assert.equal(f.requests.length, 0);
  }
});
test('HTTP operator blocks Production dispatch and every Vercel mutation; no redirect following', async () => {
  const f = fixture(); const api = operator.client(env(), f.fetchImpl);
  await assert.rejects(api.github('actions/workflows/deploy-approved-production-v2.yml/dispatches', 'POST', { ref: 'main' }));
  await assert.rejects(api.request('https://api.vercel.com/v13/deployments', {}, 'POST', {}));
  await assert.rejects(api.request(`${ORIGIN}/api/v1/internal/license-reconciliation`, {}, 'DELETE'));
  assert.equal(f.requests.length, 0);
});
test('evidence and status cannot expose known secrets or raw database material', async () => {
  for (const value of [{ secret: env().VERCEL_TOKEN }, { url: 'postgresql://test:test@localhost/disposable' }, { header: 'Bearer test' }]) {
    assert.throws(() => operator.assertSanitized(value, [env().VERCEL_TOKEN]));
  }
  const f = fixture(); await operator.publish({ ...env(), CLOUD_PREVIEW_RESULT: 'failure' }, f.fetchImpl);
  assert.match(f.comments[0].body, /FAILURE/);
  assert.ok(!f.comments[0].body.includes(env().GH_TOKEN));
  await assert.rejects(operator.publish({ ...env(), CLOUD_PREVIEW_RESULT: env().GH_TOKEN }, f.fetchImpl));
});
test('workflow only runs trusted main, requires Hosted UAT, isolates secrets and offers no dispatch/bypass permission', () => {
  const w = fs.readFileSync('.github/workflows/cloud-preview-operations.yml', 'utf8');
  assert.match(w, /github\.ref == 'refs\/heads\/main'/);
  assert.match(w, /environment:\s+name: Hosted UAT/);
  assert.match(w, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(w, /persist-credentials: false/);
  assert.match(w, /actions\/checkout@[0-9a-f]{40}/);
  assert.doesNotMatch(w, /actions: write|deployments: write|pull_request_target|workflow_dispatch|production-sms-v3-staging|self-hosted/);
  const publish = w.slice(w.indexOf('\n  publish:'));
  assert.doesNotMatch(publish, /secrets\./);
  assert.equal((w.match(/secrets\./g) || []).length, 2);
});
test('CLI refuses malformed input and never prints exception bodies or credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/ci/cloud-preview-operations.cjs', 'verify'], {
    env: { ...process.env, GITHUB_EVENT_PATH: 'package.json', CLOUD_PREVIEW_PLAN: env().VERCEL_TOKEN }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL_CLOSED/);
  assert.ok(!result.stderr.includes(env().VERCEL_TOKEN));
});
