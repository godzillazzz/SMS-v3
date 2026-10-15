'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { roles, PROJECT_ID, TEAM_ID, readConfig, previewUrl, validateApprovedTarget } = require('../e2e/uat-v3/config');
const { RoleSessions, preflightAccounts, readRoleApi, installReadonlyBrowser } = require('../e2e/uat-v3/auth');
const { getRoleApiMatrix, getRoleActionMatrix, getRoleNavigationContract } = require('../e2e/uat-v3/role-matrix');
const { authorize } = require('../src/middlewares/authenticate');
const { scanArtifact, sensitiveUatValues, rolePreflightSummary } = require('../e2e/uat-v3/security');
const { normalizeDeploymentIdentity } = require('../e2e/uat-v3/vercel-identity');
const { validateApplicationSourceContract } = require('../e2e/uat-v3/application-source-contract');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preview = 'https://sms-v3-staging-uatfixture-godzillazz.vercel.app';
function env() { return Object.fromEntries([['UAT_BASE_URL', preview], ...roles.flatMap((role) => [[`UAT_${role}_EMAIL`, `${role.toLowerCase()}@example.test`], [`UAT_${role}_PASSWORD`, `${role.toLowerCase()}-synthetic-only`]])]); }
function payload(role) { return { user: { id: `synthetic-${role}`, role }, accessToken: `synthetic-session-${role}` }; }
test('four distinct roles require all eight credentials without leaking values', () => {
  assert.deepEqual(roles, ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
  assert.equal(Object.keys(readConfig(env()).accounts).length, 4);
  for (const role of roles) {
    const missing = env(); delete missing[`UAT_${role}_PASSWORD`];
    assert.throws(() => readConfig(missing), { code: 'UAT_CREDENTIALS_REQUIRED' });
  }
  const duplicate = env(); duplicate.UAT_SUPERVISOR_EMAIL = duplicate.UAT_ADMIN_EMAIL.toUpperCase();
  assert.throws(() => readConfig(duplicate), { code: 'UAT_ROLE_ACCOUNTS_NOT_DISTINCT' });
});
test('hosted targets reject Production, aliases, credentials, query and external hosts', () => {
  for (const url of ['https://sms-v3-staging-ten.vercel.app', 'https://sms-v3-staging-godzillazzz.vercel.app', 'https://evil.test', preview + '?token=fake', preview + '/api', preview.replace('https://', 'https://user:pass@'), 'http://127.0.0.1:4179']) assert.throws(() => previewUrl(url));
  assert.equal(previewUrl(preview), preview);
  assert.equal(previewUrl('http://127.0.0.1:4179', true), 'http://127.0.0.1:4179');
});
test('approved target rejects missing isolation, literal strings and identity mismatch', () => {
  const expected = { source_sha: 'a'.repeat(40), source_branch: 'fix/serverless-database-reliability', deployment_id: 'dpl_Fixture123', url: preview };
  const target = { production_database_identity_evidence: 'https://github.com/godzillazzz/SMS-v3/actions/runs/123', production_database_target_fingerprint: 'c'.repeat(64), preview_database_cluster_fingerprint_sha256: 'a'.repeat(64), production_database_cluster_fingerprint_sha256: 'b'.repeat(64), preview_runtime_principal: 'postgres', runtime_guard_file_sha256: Object.fromEntries(['src/app.js', 'src/config/prisma.js', 'src/services/runtime-database-target-guard.service.js', 'src/utils/database-target-identity.js', 'src/services/runtime-isolation-probe.service.js', 'src/routes/runtime-isolation-probe.routes.js', 'frontend/src/main.tsx', 'frontend/src/theme.ts'].map(path => [path, 'd'.repeat(64)])), ...expected, authorized: true, database_isolation_verified: true, database_isolation_evidence: 'https://github.com/godzillazzz/SMS-v3/actions/runs/123', database_target_fingerprint: 'b'.repeat(64), project_id: PROJECT_ID, team_id: TEAM_ID, target_mode: 'preview' };
  assert.equal(validateApprovedTarget(target, expected), true);
  for (const path of ['frontend/src/main.tsx', 'frontend/src/theme.ts']) {
    const pins = { ...target.runtime_guard_file_sha256 }; delete pins[path];
    assert.throws(() => validateApprovedTarget({ ...target, runtime_guard_file_sha256: pins }, expected));
  }
  for (const change of [{ authorized: 'true' }, { database_isolation_verified: false }, { database_isolation_evidence: '' }, { database_target_fingerprint: '' }, { project_id: 'other' }, { team_id: 'other' }, { source_sha: 'c'.repeat(40) }, { target_mode: 'production' }]) assert.throws(() => validateApprovedTarget({ ...target, ...change }, expected));
});
test('role sessions reject swapped identities, reused subjects and reused tokens', () => {
  const sessions = new RoleSessions(); sessions.put('ADMIN', payload('ADMIN'));
  assert.throws(() => sessions.put('MANAGER', payload('ADMIN')), { code: 'UAT_ROLE_IDENTITY_MISMATCH' });
  assert.throws(() => sessions.put('MANAGER', { ...payload('MANAGER'), accessToken: payload('ADMIN').accessToken }), { code: 'UAT_ROLE_SESSION_NOT_ISOLATED' });
  assert.throws(() => sessions.put('MANAGER', { ...payload('MANAGER'), user: { ...payload('MANAGER').user, id: payload('ADMIN').user.id } }), { code: 'UAT_ROLE_SESSION_NOT_ISOLATED' });
  for (const role of roles.slice(1)) sessions.put(role, payload(role));
  assert.ok(sessions.summary().every((item) => item.status === 'READY'));
  sessions.clear(); assert.throws(() => sessions.get('ADMIN'), { code: 'UAT_ROLE_SESSION_REQUIRED' });
});
test('account preflight uses four independent contexts and disposes on failure', async () => {
  let creates = 0, disposes = 0, requests = 0;
  const factory = async () => { creates++; return { post: async (_url, options) => { const role = roles[requests++]; assert.equal(options.maxRedirects, 0); return { status: () => 200, json: async () => payload(role) }; }, dispose: async () => disposes++ }; };
  const sessions = await preflightAccounts(factory, readConfig(env()));
  assert.equal(creates, 4); assert.equal(disposes, 4); assert.equal(sessions.summary().length, 4);
  let closed = false;
  await assert.rejects(() => preflightAccounts(async () => ({ post: async () => { throw new Error('raw-secret-example'); }, dispose: async () => { closed = true; } }), readConfig(env())), { code: 'UAT_ACCOUNT_PREFLIGHT_FAILED' });
  assert.equal(closed, true);
});
test('read API rejects cross-role sessions, absolute URLs and non-allowlisted paths', async () => {
  const context = { get: async (_path, options) => { assert.equal(options.maxRedirects, 0); return { status: () => 200 }; } };
  await assert.rejects(() => readRoleApi(context, 'VIEWER', payload('ADMIN'), '/api/v1/dashboard'), { code: 'UAT_ROLE_IDENTITY_MISMATCH' });
  for (const path of ['/api/v1/unknown', 'https://evil.test/api/v1/dashboard']) await assert.rejects(() => readRoleApi(context, 'ADMIN', payload('ADMIN'), path), { code: 'UAT_READ_PATH_NOT_ALLOWLISTED' });
  assert.equal((await readRoleApi(context, 'ADMIN', payload('ADMIN'), '/api/v1/dashboard')).status(), 200);
});
test('browser guard blocks writes and cross-origin credentials while bootstrapping in memory', async () => {
  let handler; const page = { route: async (_pattern, fn) => { handler = fn; } };
  const attempts = await installReadonlyBrowser(page, payload('VIEWER'), preview);
  const invoke = async (method, path, headers = {}) => {
    let outcome;
    await handler({ request: () => ({ method: () => method, url: () => path.startsWith('https:') ? path : preview + path, allHeaders: async () => headers }), abort: async () => { outcome = 'blocked'; }, fetch: async (options) => { assert.equal(options.maxRedirects, 0); return { status: () => 200 }; }, fulfill: async (options) => { outcome = options.response ? 'allowed' : 'memory-only'; } }); return outcome;
  };
  assert.equal(await invoke('POST', '/api/v1/licenses'), 'blocked');
  assert.equal(await invoke('DELETE', '/api/v1/shifts/fixture'), 'blocked');
  assert.equal(await invoke('GET', 'https://evil.test/data', { authorization: 'Bearer synthetic-token' }), 'blocked');
  for (const headers of [{ cookie: 'synthetic_session=fixture-only' }, { 'proxy-authorization': 'Basic synthetic-only' }, { 'x-vercel-protection-bypass': 'fixture-only' }]) assert.equal(await invoke('GET', 'https://evil.test/data', headers), 'blocked');
  assert.equal(await invoke('POST', '/api/v1/auth/refresh'), 'memory-only');
  assert.equal(await invoke('GET', '/api/v1/employees'), 'allowed');
  assert.equal(await invoke('GET', '/api/v1/employees', { cookie: 'synthetic_session=fixture-only' }), 'allowed');
  assert.equal(attempts.length, 6);
});
test('application source contract rejects missing or drifted guards and navigation', () => {
  assert.throws(() => validateApplicationSourceContract('/nonexistent/application'), { code: 'UAT_APPLICATION_SOURCE_REQUIRED' });
  if (process.env.UAT_APPLICATION_ROOT) {
    assert.doesNotThrow(() => validateApplicationSourceContract(process.env.UAT_APPLICATION_ROOT));
    const matrix = require('../e2e/uat-v3/role-matrix');
    const driftedMatrix = {
      getRoleActionMatrix: (role) => matrix.getRoleActionMatrix(role).map((action) => role === 'SUPERVISOR' && action.path === '/api/v1/schedule/approve-month' ? { ...action, guard: 'authorize ADMIN', expectedStatus: 403 } : action),
      getRoleNavigationContract: matrix.getRoleNavigationContract
    };
    assert.throws(() => validateApplicationSourceContract(process.env.UAT_APPLICATION_ROOT, driftedMatrix), { code: 'UAT_APPLICATION_SOURCE_CONTRACT_INVALID' });
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'uat-source-contract-'));
    fs.cpSync(process.env.UAT_APPLICATION_ROOT, fixture, { recursive: true });
    const route = path.join(fixture, 'src/routes/schedules.routes.js');
    fs.writeFileSync(route, fs.readFileSync(route, 'utf8').replace("authorize('ADMIN', 'SUPERVISOR')", "authorize('ADMIN')"));
    assert.throws(() => validateApplicationSourceContract(fixture), { code: 'UAT_APPLICATION_SOURCE_CONTRACT_INVALID' });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
test('four-role approval contracts match actual authorization middleware', () => {
  const approvalRoles = ['ADMIN', 'MANAGER', 'SUPERVISOR'];
  for (const role of roles) {
    let error;
    authorize(...approvalRoles)({ user: { role } }, {}, (value) => { error = value; });
    assert.equal(error?.statusCode || 200, role === 'VIEWER' ? 403 : 200);
    assert.equal(getRoleApiMatrix(role).find((route) => route.label === 'Approval Center').expectedStatus, role === 'VIEWER' ? 403 : 200);
    const nav = getRoleNavigationContract(role);
    assert.equal(nav.required.some((item) => item.id === 'approvals'), ['ADMIN', 'SUPERVISOR'].includes(role));
    assert.ok(getRoleApiMatrix(role).every((route) => route.readOnly === true));
    if (role !== 'ADMIN') assert.ok(getRoleApiMatrix(role).some((route) => route.expectedStatus === 403));
  }
});
test('SUPERVISOR matrix is explicit and preserves role-specific approval boundaries', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../e2e/uat-v3/role-matrix.js'), 'utf8');
  assert.equal(source.includes('roleApiMatrix.SUPERVISOR = roleApiMatrix.MANAGER.map'), false);
  assert.equal(source.includes('...roleNavigation.MANAGER'), false);
  assert.equal(source.includes('...rolePageChecks.MANAGER'), false);
  const supervisor = getRoleApiMatrix('SUPERVISOR');
  assert.equal(supervisor.find((route) => route.label === 'Data Quality').expectedStatus, 403);
  assert.equal(supervisor.find((route) => route.label === 'Audit').expectedStatus, 403);
  assert.equal(supervisor.find((route) => route.label === 'System Health').expectedStatus, 403);
  assert.equal(supervisor.find((route) => route.label === 'Security Sites').expectedStatus, 403);
  assert.equal(supervisor.find((route) => route.label === 'System settings').expectedStatus, 403);
  assert.equal(supervisor.find((route) => route.label === 'Attendance report'), undefined);
  assert.equal(getRoleNavigationContract('SUPERVISOR').required.some((item) => item.id === 'approvals'), true);
  assert.equal(getRoleNavigationContract('SUPERVISOR').forbidden.some((item) => item.id === 'attendanceReport'), true);
  assert.equal(getRoleNavigationContract('MANAGER').required.some((item) => item.id === 'approvals'), false);
  assert.equal(getRoleActionMatrix('MANAGER').length, 0);
  assert.deepEqual(getRoleActionMatrix('VIEWER'), []);
  assert.deepEqual(getRoleActionMatrix('SUPERVISOR').map(({ method, path }) => [method, path]), [
    ['POST', '/api/v1/schedule/approve-month'],
    ['PUT', '/api/v1/schedule-approvals/:id'],
    ['POST', '/api/v1/schedules/approve']
  ]);
  assert.match(getRoleActionMatrix('SUPERVISOR')[1].guard, /status APPROVED only/);
});
test('scanner preserves secret patterns and includes SUPERVISOR credential values', () => {
  const synthetic = env();
  const secrets = sensitiveUatValues(synthetic);
  assert.ok(secrets.includes(synthetic.UAT_SUPERVISOR_PASSWORD));
  assert.equal(scanArtifact('summary.json', Buffer.from(synthetic.UAT_SUPERVISOR_PASSWORD), { secretValues: secrets }).safe, false);
  for (const value of ['{"accessToken":"abcdefghijklmnopqrstuvwxyz0123456789"}', '{"password":"synthetic-only-value"}', '{"Authorization":"Bearer abcdefghijklmnopqrstuvwxyz012345"}']) assert.equal(scanArtifact('summary.json', value).safe, false);
  assert.equal(scanArtifact('.auth/state.json', '{}').safe, false);
  assert.equal(scanArtifact('summary.json', '{"role":"SUPERVISOR","status":"PASS"}').safe, true);
  assert.equal(rolePreflightSummary([{ role: 'SUPERVISOR', ready: true }]).SUPERVISOR, 'READY');
});
test('Vercel identity sanitizer omits raw environment and secrets', () => {
  const sanitized = normalizeDeploymentIdentity({ id: 'dpl_Fixture', projectId: PROJECT_ID, meta: { githubCommitSha: 'a'.repeat(40) }, env: { password: 'synthetic-only' }, secret: 'synthetic-only', target: 'preview' });
  assert.equal(sanitized.projectId, PROJECT_ID); assert.equal(JSON.stringify(sanitized).includes('synthetic-only'), false);
});
test('browser refuses redirects before credentials can reach a second origin', async () => {
  let handler, aborted = false;
  const page = { route: async (_pattern, fn) => { handler = fn; } };
  const attempts = await installReadonlyBrowser(page, payload('ADMIN'), preview);
  await handler({ request: () => ({ method: () => 'GET', url: () => preview + '/api/v1/dashboard', allHeaders: async () => ({ authorization: 'Bearer synthetic-only' }) }), fetch: async (options) => { assert.equal(options.maxRedirects, 0); return { status: () => 302 }; }, abort: async () => { aborted = true; }, fulfill: async () => { throw new Error('Redirect should not be fulfilled'); } });
  assert.equal(aborted, true); assert.deepEqual(attempts, [{ method: 'GET', path: 'redirect-blocked' }]);
});
