'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  authHarnessState,
  dashboardSuppressor,
  dashboardSuppressorActiveCount,
  dashboardSuppressorOwner
} = require('../e2e/helpers/uat-auth');
const { getRoleApiMatrix } = require('../e2e/helpers/uat-v3-role-matrix');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

class FakeRoutePage extends EventEmitter {
  constructor() {
    super();
    this.routes = [];
  }
  async route(pattern, handler) { this.routes.push({ pattern, handler }); }
  async unroute(pattern, handler) {
    this.routes = this.routes.filter((entry) => entry.pattern !== pattern || entry.handler !== handler);
  }
}

test('V3.1 Dashboard suppressor has bounded owner and active counter returns to zero', async () => {
  const page = new FakeRoutePage();
  const suppressor = dashboardSuppressor(page);
  assert.equal(dashboardSuppressorActiveCount(page), 0);
  await suppressor.install();
  assert.equal(dashboardSuppressorActiveCount(page), 1);
  assert.equal(authHarnessState(page).dashboardSuppressorActive, 1);
  assert.equal(page.routes.length, 1);
  await suppressor.remove();
  assert.equal(dashboardSuppressorActiveCount(page), 0);
  assert.equal(page.routes.length, 0);
  await suppressor.remove();
  assert.equal(dashboardSuppressorActiveCount(page), 0);
  assert.equal(dashboardSuppressorOwner(page), 'NONE');
});

test('V3.1 explicit real-login path uses real login submit, no cached fake refresh, and owns Dashboard completion', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const start = auth.indexOf('async function loginViaUi');
  const end = auth.indexOf('async function getAuditEventsStatus', start);
  const block = auth.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /page\.getByRole\('button', \{ name: 'เข้าสู่ระบบ', exact: true \}\)\.click\(\)/);
  assert.match(block, /waitForRequest[\s\S]*\/api\/v1\/auth\/login/);
  assert.match(block, /waitForResponse[\s\S]*\/api\/v1\/auth\/login/);
  assert.match(block, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.match(block, /scrubLoginCredentialDom\(page\)/);
  assert.doesNotMatch(block, /installCachedRefreshRoute\(/);
  assert.doesNotMatch(block, /dashboardSuppressor\(page\)/);
  assert.match(block, /cachedRefreshUsed:\s*false/);
  assert.match(block, /dashboardSuppressorActiveAtHelperReturn:\s*dashboardSuppressorActiveCount\(page\)/);
});

test('V3.1 real-login capability remains isolated while V3.2 role identity is target-aware', () => {
  const source = read('e2e/smoke/authenticated-v3.spec.js');
  assert.match(source, /for \(const role of \['ADMIN', 'MANAGER', 'VIEWER'\]\)/);
  const loginStart = source.indexOf('login and role identity');
  const loginEnd = source.indexOf('read-only API authorization and scope', loginStart);
  const loginBlock = source.slice(loginStart, loginEnd);
  assert.match(loginBlock, /authenticateRoleIdentity\(page, role\)/);
  assert.match(loginBlock, /v31-auth-contract\.json/);
  assert.doesNotMatch(loginBlock, /loginAs\(page, role\)/);
  assert.doesNotMatch(loginBlock, /bootstrapAs\(page, role\)/);
  assert.doesNotMatch(loginBlock, /loginViaUi\(page, role\)/);
  const auth = read('e2e/helpers/uat-auth.js');
  const identityBlock = auth.slice(auth.indexOf('async function authenticateRoleIdentity'), auth.indexOf('async function getAuditEventsStatus'));
  assert.match(identityBlock, /targetClass === 'CANONICAL'\) return loginViaUi\(page, role\)/);
  assert.match(identityBlock, /targetClass === 'IMMUTABLE'\) return bootstrapAsNonDashboard\(page, role\)/);
});

test('V3.1 VIEWER Dashboard contract is 200 and protected Dashboard avoids duplicate navigation', () => {
  const viewerDashboard = getRoleApiMatrix('VIEWER').find((entry) => entry.label === 'Dashboard');
  assert.ok(viewerDashboard);
  assert.equal(viewerDashboard.expectedStatus, 200);

  const source = read('e2e/smoke/authenticated-v3.spec.js');
  const protectedStart = source.indexOf('protected page ${item.id}');
  const protectedEnd = source.indexOf("if (['ADMIN', 'MANAGER'].includes(role))", protectedStart);
  const block = source.slice(protectedStart, protectedEnd);
  const dashStart = block.indexOf("if (item.id === 'dashboard')");
  const dashEnd = block.indexOf('} else {', dashStart);
  const dashboardBranch = block.slice(dashStart, dashEnd);
  assert.match(dashboardBranch, /loginAs\(page, role\)/);
  assert.match(dashboardBranch, /Executive Operations Dashboard/);
  assert.match(dashboardBranch, /v31-auth-contract\.json/);
  assert.doesNotMatch(dashboardBranch, /navigateTo\(page, 'dashboard'\)/);
});

test('V3.1 cached-session and real-login modes remain separated', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const bootstrap = auth.slice(auth.indexOf('async function bootstrapAs'), auth.indexOf('async function bootstrapAsNonDashboard'));
  const nonDashboardBootstrap = auth.slice(auth.indexOf('async function bootstrapAsNonDashboard'), auth.indexOf('async function loginAs'));
  const cachedLogin = auth.slice(auth.indexOf('async function loginAs'), auth.indexOf('async function loginViaUi'));
  const realLogin = auth.slice(auth.indexOf('async function loginViaUi'), auth.indexOf('async function getAuditEventsStatus'));
  assert.match(bootstrap, /installCachedRefreshRoute\(page, session\)/);
  assert.match(nonDashboardBootstrap, /installCachedRefreshRoute\(page, session\)/);
  assert.match(nonDashboardBootstrap, /PAGE_SCOPED_NON_DASHBOARD/);
  assert.doesNotMatch(nonDashboardBootstrap, /await suppressor\.remove\(\);/);
  assert.match(cachedLogin, /installCachedRefreshRoute\(page, session\)/);
  assert.doesNotMatch(realLogin, /installCachedRefreshRoute\(/);
  assert.match(bootstrap, /await suppressor\.remove\(\)/);
  assert.match(bootstrap, /UAT_DASHBOARD_SUPPRESSOR_LEAK/);
});

test('V3.1 remote-safe observability is embedded in already uploaded result and summary artifacts', () => {
  const reporter = read('e2e/uat-reporter.js');
  const fixture = read('e2e/helpers/uat-test.js');
  for (const key of [
    'testsFinishingWithOutstandingHeavyReads',
    'exceptionalHeavyDrainCount',
    'exceptionalHeavyDrainWaitMs',
    'realHeavyStarts',
    'preventedHeavyStarts'
  ]) {
    assert.match(reporter, new RegExp(key));
    assert.match(fixture, new RegExp(key));
  }
  assert.match(reporter, /heavyReadSafety: this\.heavyReadSafety/);
  assert.match(reporter, /v31-auth-contract\.json/);
  assert.match(reporter, /authContract/);
  assert.doesNotMatch(fixture, /UAT_STAGE_DIAGNOSTIC_FILE/);
});

test('V3.1 keeps proven V3 architecture and destructive fixture remains disabled', () => {
  const heavy = read('e2e/helpers/uat-heavy-read-v3.js');
  const fixture = read('e2e/helpers/uat-test.js');
  const disposable = read('e2e/smoke/disposable-employee.spec.js');
  assert.match(heavy, /requestfinished/);
  assert.doesNotMatch(heavy, /semaphore|permit|quiet.?window/i);
  assert.doesNotMatch(fixture, /waitForTimeout|quiet.?window/i);
  assert.match(fixture, /assertNormalCompletion/);
  assert.match(disposable, /test\.skip\(!destructiveFixtureEnabled\(\)/);
});
