'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
  authHarnessState,
  dashboardSuppressor,
  dashboardSuppressorActiveCount,
  dashboardSuppressorOwner
} = require('../e2e/helpers/uat-auth');
const {
  createHeavyReadSafetyTracker,
  isPageScopedDashboardSuppressed,
  performAndWaitForHeavyRequest,
  resetSafetyMetrics,
  safetyMetricsSnapshot
} = require('../e2e/helpers/uat-heavy-read-v3');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function fakeRequest(url, method = 'GET') {
  return {
    method: () => method,
    url: () => url,
    resourceType: () => 'fetch',
    failure: () => ({ errorText: 'net::ERR_ABORTED' })
  };
}

class FakeRoutePage extends EventEmitter {
  constructor() {
    super();
    this.routes = [];
    this.closed = false;
  }
  off(name, listener) { this.removeListener(name, listener); return this; }
  async route(pattern, handler) { this.routes.push({ pattern, handler }); }
  async unroute(pattern, handler) {
    this.routes = this.routes.filter((entry) => entry.pattern !== pattern || entry.handler !== handler);
  }
  isClosed() { return this.closed; }
  async dispatch(request) {
    this.emit('request', request);
    const entry = this.routes[this.routes.length - 1];
    if (!entry) {
      this.emit('requestfinished', request);
      return { aborted: false, continued: true };
    }
    let aborted = false;
    let continued = false;
    await entry.handler({
      request: () => request,
      abort: async () => {
        aborted = true;
        this.emit('requestfailed', request);
      },
      continue: async () => {
        continued = true;
        this.emit('requestfinished', request);
      }
    });
    return { aborted, continued };
  }
  closePage() {
    this.closed = true;
    this.emit('close');
  }
}

test('V3.3 nav shell visibility does not end page-scoped non-Dashboard suppression', async () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const start = auth.indexOf('async function bootstrapAsNonDashboard');
  const end = auth.indexOf('async function loginAs', start);
  const block = auth.slice(start, end);
  assert.match(block, /PAGE_SCOPED_NON_DASHBOARD/);
  assert.match(block, /Authenticated navigation shell must render/);
  assert.doesNotMatch(block, /finally\s*\{\s*await suppressor\.remove\(\)/);
  assert.match(block, /suppressor\.activeCount\(\) !== 1/);
});

test('V3.3 delayed Dashboard at logical 100ms and 500ms remains prevented without a quiet window', async () => {
  resetSafetyMetrics();
  let now = 0;
  const page = new FakeRoutePage();
  const tracker = createHeavyReadSafetyTracker(page, { now: () => now });
  const suppressor = dashboardSuppressor(page, { owner: 'PAGE_SCOPED_NON_DASHBOARD' });
  await suppressor.install();
  assert.equal(dashboardSuppressorActiveCount(page), 1);
  assert.equal(dashboardSuppressorOwner(page), 'PAGE_SCOPED_NON_DASHBOARD');
  assert.equal(isPageScopedDashboardSuppressed(page), true);

  now = 100;
  const first = await page.dispatch(fakeRequest('https://candidate.test/api/v1/dashboard?late=100'));
  now = 500;
  const second = await page.dispatch(fakeRequest('https://candidate.test/api/v1/dashboard?late=500'));
  assert.equal(first.aborted, true);
  assert.equal(second.aborted, true);
  assert.deepEqual(tracker.summary().outstandingHeavyReads, []);
  assert.equal(tracker.summary().preventedStarts, 2);
  assert.equal(tracker.summary().realHeavyStarts, 0);
  await tracker.assertNormalCompletion();
  assert.deepEqual(safetyMetricsSnapshot(), {
    testsFinishingWithOutstandingHeavyReads: 0,
    exceptionalHeavyDrainCount: 0,
    exceptionalHeavyDrainWaitMs: 0
  });
  tracker.stop();
  page.closePage();
});

test('V3.3 non-Dashboard navigation proceeds while only exact Dashboard GET is suppressed', async () => {
  const page = new FakeRoutePage();
  const suppressor = dashboardSuppressor(page, { owner: 'PAGE_SCOPED_NON_DASHBOARD' });
  await suppressor.install();
  const license = await page.dispatch(fakeRequest('https://candidate.test/api/v1/licenses?page=1'));
  const dashboardPost = await page.dispatch(fakeRequest('https://candidate.test/api/v1/dashboard', 'POST'));
  assert.deepEqual(license, { aborted: false, continued: true });
  assert.deepEqual(dashboardPost, { aborted: false, continued: true });
  await suppressor.remove();
});

test('V3.3 required Dashboard coverage fails immediately while page-scoped suppression is active', async () => {
  const page = new FakeRoutePage();
  const suppressor = dashboardSuppressor(page, { owner: 'PAGE_SCOPED_NON_DASHBOARD' });
  await suppressor.install();
  let actionCalled = false;
  await assert.rejects(
    performAndWaitForHeavyRequest(page, '/api/v1/dashboard', async () => { actionCalled = true; }),
    { code: 'UAT_REQUIRED_DASHBOARD_WHILE_SUPPRESSED' }
  );
  assert.equal(actionCalled, false);
  await suppressor.remove();
});

test('V3.3 page-scoped suppressor ownership clears on page close and never leaks to another page', async () => {
  const pageA = new FakeRoutePage();
  const suppressor = dashboardSuppressor(pageA, { owner: 'PAGE_SCOPED_NON_DASHBOARD' });
  await suppressor.install();
  assert.equal(authHarnessState(pageA).dashboardSuppressorOwner, 'PAGE_SCOPED_NON_DASHBOARD');
  pageA.closePage();
  assert.equal(dashboardSuppressorActiveCount(pageA), 0);
  assert.equal(dashboardSuppressorOwner(pageA), 'NONE');
  assert.equal(isPageScopedDashboardSuppressed(pageA), false);

  const pageB = new FakeRoutePage();
  assert.equal(dashboardSuppressorActiveCount(pageB), 0);
  assert.equal(dashboardSuppressorOwner(pageB), 'NONE');
  assert.equal(isPageScopedDashboardSuppressed(pageB), false);
});

test('V3.3 protected licenses and pure non-Dashboard callers use page-scoped bootstrap while Dashboard owners remain explicit', () => {
  const authenticated = read('e2e/smoke/authenticated-v3.spec.js');
  const admin = read('e2e/smoke/admin.spec.js');
  const performance = read('e2e/smoke/performance-validation.spec.js');
  const auth = read('e2e/helpers/uat-auth.js');
  const protectedStart = authenticated.indexOf('protected page ${item.id}');
  const protectedEnd = authenticated.indexOf("if (['ADMIN', 'MANAGER'].includes(role))", protectedStart);
  const protectedBlock = authenticated.slice(protectedStart, protectedEnd);
  assert.match(protectedBlock, /bootstrapAsNonDashboard\(page, role\)/);
  assert.match(protectedBlock, /loginAs\(page, role\)/);
  assert.equal((admin.match(/bootstrapAsNonDashboard\(page, 'ADMIN'\)/g) || []).length, 2);
  assert.equal((performance.match(/bootstrapAsNonDashboard\(page, 'ADMIN'\)/g) || []).length, 2);
  assert.match(auth, /targetClass === 'IMMUTABLE'\) return bootstrapAsNonDashboard\(page, role\)/);
  const loginAsBlock = auth.slice(auth.indexOf('async function loginAs'), auth.indexOf('async function loginViaUi'));
  assert.match(loginAsBlock, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.doesNotMatch(loginAsBlock, /PAGE_SCOPED_NON_DASHBOARD/);
  const realLoginBlock = auth.slice(auth.indexOf('async function loginViaUi'), auth.indexOf('async function authenticateRoleIdentity'));
  assert.match(realLoginBlock, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.doesNotMatch(realLoginBlock, /PAGE_SCOPED_NON_DASHBOARD/);
});
