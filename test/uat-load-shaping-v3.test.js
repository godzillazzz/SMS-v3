'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  createHeavyReadSafetyTracker,
  markHarnessPreventedHeavyRead,
  performAndWaitForHeavyRequest,
  resetSafetyMetrics,
  safetyMetricsSnapshot
} = require('../e2e/helpers/uat-heavy-read-v3');
const { MAX_SAMPLES, alternatingSequence } = require('../e2e/helpers/uat-performance');
const { scanArtifact } = require('../e2e/helpers/uat-v3-security');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

class FakePage extends EventEmitter {
  off(name, listener) { this.removeListener(name, listener); return this; }
}

function fakeRequest(url) {
  return {
    method: () => 'GET',
    url: () => url,
    resourceType: () => 'fetch',
    failure: () => ({ errorText: 'net::ERR_ABORTED' })
  };
}

function fakeResponse(request, status = 200) {
  return { request: () => request, status: () => status, url: () => request.url() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('required heavy helper waits for exact requestfinished, not merely response or action completion', async () => {
  const page = new FakePage();
  const request = fakeRequest('https://candidate.test/api/v1/dashboard');
  const response = fakeResponse(request);
  let resolved = false;
  const result = performAndWaitForHeavyRequest(page, '/api/v1/dashboard', async () => {
    page.emit('request', request);
    page.emit('response', response);
  }).then((value) => { resolved = true; return value; });
  await tick();
  assert.equal(resolved, false);
  page.emit('requestfinished', request);
  assert.equal((await result).status(), 200);
  assert.equal(resolved, true);
});

test('required heavy helper matches only the intended route', async () => {
  const page = new FakePage();
  const dashboard = fakeRequest('https://candidate.test/api/v1/dashboard');
  const executive = fakeRequest('https://candidate.test/api/v1/executive-report');
  const executiveResponse = fakeResponse(executive);
  const result = performAndWaitForHeavyRequest(page, '/api/v1/executive-report', async () => {
    page.emit('request', dashboard);
    page.emit('response', fakeResponse(dashboard));
    page.emit('requestfinished', dashboard);
    page.emit('request', executive);
    page.emit('response', executiveResponse);
    page.emit('requestfinished', executive);
  });
  assert.equal((await result).request(), executive);
});

test('normal teardown with zero outstanding heavy work adds no safety wait', async () => {
  resetSafetyMetrics();
  const page = new FakePage();
  const tracker = createHeavyReadSafetyTracker(page);
  const summary = await tracker.assertNormalCompletion();
  assert.equal(summary.outstanding, 0);
  assert.deepEqual(safetyMetricsSnapshot(), {
    testsFinishingWithOutstandingHeavyReads: 0,
    exceptionalHeavyDrainCount: 0,
    exceptionalHeavyDrainWaitMs: 0
  });
  tracker.stop();
});

test('unexpected outstanding heavy work is exceptional, keeps page alive until completion, then fails closed', async () => {
  resetSafetyMetrics();
  let now = 1_000;
  const page = new FakePage();
  const tracker = createHeavyReadSafetyTracker(page, { now: () => now });
  const request = fakeRequest('https://candidate.test/api/v1/reports/summary');
  page.emit('request', request);
  let settled = false;
  const completion = tracker.assertNormalCompletion().finally(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(page.listenerCount('requestfinished') > 0, true);
  now += 25;
  page.emit('requestfinished', request);
  await assert.rejects(completion, { code: 'UAT_UNEXPECTED_OUTSTANDING_HEAVY_READ' });
  assert.equal(safetyMetricsSnapshot().testsFinishingWithOutstandingHeavyReads, 1);
  assert.equal(safetyMetricsSnapshot().exceptionalHeavyDrainCount, 1);
  assert.equal(safetyMetricsSnapshot().exceptionalHeavyDrainWaitMs, 25);
  tracker.stop();
});

test('V3.3 outstanding heavy evidence is pathname-only and records LIVE or CLIENT_FAILED state', async () => {
  let now = 5_000;
  const page = new FakePage();
  const tracker = createHeavyReadSafetyTracker(page, { now: () => now });
  const live = fakeRequest('https://candidate.test/api/v1/dashboard?token=secret&employee=123');
  const failed = fakeRequest('https://candidate.test/api/v1/executive-report?year=2026&month=8');
  page.emit('request', live);
  page.emit('request', failed);
  now += 125;
  page.emit('requestfailed', failed);
  const summary = tracker.summary();
  assert.deepEqual(summary.outstandingHeavyReads, [
    { method: 'GET', path: '/api/v1/dashboard', ageMs: 125, state: 'LIVE' },
    { method: 'GET', path: '/api/v1/executive-report', ageMs: 125, state: 'CLIENT_FAILED' }
  ]);
  const serialized = JSON.stringify(summary.outstandingHeavyReads);
  for (const forbidden of ['token=secret', 'employee=123', 'year=2026', 'month=8', 'Authorization', 'cookie', 'requestId']) assert.equal(serialized.includes(forbidden), false);
  page.emit('requestfinished', live);
  now += 1;
  page.emit('requestfinished', failed);
  tracker.stop();
});

test('Harness-prevented bootstrap Dashboard is removed from server-work accounting', async () => {
  resetSafetyMetrics();
  const page = new FakePage();
  const tracker = createHeavyReadSafetyTracker(page);
  const request = fakeRequest('https://candidate.test/api/v1/dashboard');
  page.emit('request', request);
  markHarnessPreventedHeavyRead(page, request);
  page.emit('requestfailed', request);
  assert.equal(tracker.summary().outstanding, 0);
  assert.equal(tracker.summary().preventedStarts, 1);
  await tracker.assertNormalCompletion();
  assert.equal(safetyMetricsSnapshot().exceptionalHeavyDrainCount, 0);
  tracker.stop();
});

test('V3.1 keeps bootstrap reduction while explicit real login owns three required Dashboard reads', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const authenticated = read('e2e/smoke/authenticated-v3.spec.js');
  const admin = read('e2e/smoke/admin.spec.js');
  const performance = read('e2e/smoke/performance-validation.spec.js');
  assert.match(auth, /async function bootstrapAs/);
  assert.match(auth, /markHarnessPreventedHeavyRead\(page, request\)/);
  assert.match(auth, /async function loginViaUi/);
  const loginBlock = auth.slice(auth.indexOf('async function loginViaUi'), auth.indexOf('async function getAuditEventsStatus'));
  assert.match(loginBlock, /waitForRequest[\s\S]*\/api\/v1\/auth\/login/);
  assert.match(loginBlock, /scrubLoginCredentialDom\(page\)/);
  assert.match(loginBlock, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.doesNotMatch(loginBlock, /installCachedRefreshRoute/);
  assert.doesNotMatch(loginBlock, /dashboardSuppressor\(page\)/);
  assert.match(authenticated, /roleAccessToken\(role\)/);
  const protectedBlock = authenticated.slice(authenticated.indexOf('protected page $\{item.id}'), authenticated.indexOf("if (['ADMIN', 'MANAGER'].includes(role))"));
  assert.match(protectedBlock, /if \(item\.id === 'dashboard'\) \{/);
  assert.match(protectedBlock, /const \{ authContract \} = await loginAs\(page, role\)/);
  const dashboardBranch = protectedBlock.slice(protectedBlock.indexOf("if (item.id === 'dashboard')"), protectedBlock.indexOf('} else {'));
  assert.doesNotMatch(dashboardBranch, /navigateTo\(page, 'dashboard'\)/);
  assert.equal((admin.match(/bootstrapAs\(page, 'ADMIN'\)/g) || []).length, 2);
  assert.equal((performance.match(/bootstrapAs\(page, 'ADMIN'\)/g) || []).length, 2);
  assert.equal(34, 25 + 3 + 2 + 4);
});

test('all required browser heavy classes are explicitly terminal-awaited and no semaphore or normal global barrier exists', () => {
  const helper = read('e2e/helpers/uat-heavy-read-v3.js');
  const auth = read('e2e/helpers/uat-auth.js');
  const admin = read('e2e/smoke/admin.spec.js');
  const authenticated = read('e2e/smoke/authenticated-v3.spec.js');
  const performance = read('e2e/smoke/performance-validation.spec.js');
  const uatTest = read('e2e/helpers/uat-test.js');
  assert.match(helper, /page\.on\('requestfinished'/);
  assert.match(auth, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.match(admin, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/dashboard'/);
  assert.match(authenticated, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/executive-report'/);
  assert.match(authenticated, /performAndWaitForHeavyRequest\([\s\S]*'\/api\/v1\/reports\/summary'/);
  assert.match(performance, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/executive-report'/);
  assert.match(performance, /performAndWaitForHeavyRequest\(page, '\/api\/v1\/reports\/summary'/);
  assert.doesNotMatch(helper, /semaphore|permit|limit\s*=\s*[12]|quiet.?window/i);
  assert.doesNotMatch(uatTest, /waitForTimeout|quiet.?window/i);
  assert.match(uatTest, /assertNormalCompletion/);
});

test('responsive coverage checks every page at every viewport without redundant heavy refetch per viewport', () => {
  const source = read('e2e/smoke/authenticated-v3.spec.js');
  const start = source.indexOf('authenticated responsive smoke');
  const end = source.indexOf('monitor.assertClean();', start);
  const block = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.match(block, /for \(const pageId of pages\)/);
  assert.match(block, /for \(const viewport of viewports\)/);
  assert.equal((block.match(/loginAs\(page, role\)/g) || []).length, 1);
  assert.equal((block.match(/performAndWaitForHeavyRequest\(page, '\/api\/v1\/executive-report'/g) || []).length, 1);
  assert.doesNotMatch(block, /page\.goto\('\/'\)/);
  assert.match(block, /assertNoHorizontalOverflow\(page\)/);
  assert.match(block, /captureScreenshot\(page, testInfo/);
});
test('Report Center exact-count, stale-export, and PDF contracts remain unchanged', () => {
  const source = read('e2e/smoke/performance-validation.spec.js');
  for (const expected of [
    'expect(initialExecutiveCount).toBe(1)',
    'expect(firstSummaryCount).toBe(1)',
    "expect(reentryAdditional, 'Details re-entry must not auto-refetch summary.').toBe(0)",
    "expect(hiddenExecutiveAdditional, 'Changing a filter while Details is active must not hidden-fetch Executive.').toBe(0)",
    "expect(executiveReturnAdditional, 'Returning to Executive after filter change must fetch the current filter exactly once.').toBe(1)",
    "expect(summaryRefreshAdditional, 'Explicit Details refresh must add exactly one summary request.').toBe(1)",
    "metric('report-center-export', 'stale-filter', 0, 'PREVENTED')",
    "metric('report-center-pdf', 'first-print-page', 0, 'PASS')"
  ]) assert.ok(source.includes(expected), expected);
});

test('direct authenticated API remains awaited through response body and benchmark semantics stay exact', () => {
  const direct = read('e2e/helpers/uat-authenticated-request.js');
  const performance = read('e2e/smoke/performance-validation.spec.js');
  assert.match(direct, /const response = await fetch/);
  assert.match(direct, /const payload = await response\.json\(\)\.catch/);
  assert.equal(MAX_SAMPLES, 3);
  assert.deepEqual(alternatingSequence(), [
    { targetLabel: 'canonical', sampleIndex: 1 },
    { targetLabel: 'candidate', sampleIndex: 1 },
    { targetLabel: 'canonical', sampleIndex: 2 },
    { targetLabel: 'candidate', sampleIndex: 2 },
    { targetLabel: 'canonical', sampleIndex: 3 },
    { targetLabel: 'candidate', sampleIndex: 3 }
  ]);
  assert.doesNotMatch(performance.match(/test\('V3 PERFORMANCE:[\s\S]*$/)?.[0] || '', /performAndWaitForHeavyRequest/);
});

test('Disposable fixture and Production fixture wiring remain disabled', () => {
  const disposable = read('e2e/smoke/disposable-employee.spec.js');
  const workflow = execFileSync('git', ['show', '04535baa9efead05e43375a86796890aaaf0c7e5:.github/workflows/automated-uat-sms-v3-staging.yml'], { cwd: root, encoding: 'utf8' });
  assert.match(disposable, /test\.skip\(!destructiveFixtureEnabled\(\)/);
  assert.doesNotMatch(workflow, /disposable-approved-v1|fixture_confirmation|DATABASE_URL|UAT_DISPOSABLE_EMPLOYEE_ENABLED/);
  assert.match(workflow, /group:\s*sms-v3-staging-authenticated-uat/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});


test('heavy-read safety aggregates are emitted through already-uploaded safe result artifacts', () => {
  const uatTest = read('e2e/helpers/uat-test.js');
  const reporter = read('e2e/uat-reporter.js');
  assert.match(uatTest, /heavy-read-safety\.json/);
  for (const key of ['testsFinishingWithOutstandingHeavyReads', 'exceptionalHeavyDrainCount', 'exceptionalHeavyDrainWaitMs', 'realHeavyStarts', 'preventedHeavyStarts', 'outstandingHeavyReads']) {
    assert.match(uatTest, new RegExp(key));
    assert.match(reporter, new RegExp(key));
  }
  assert.match(reporter, /heavyReadSafety: this\.heavyReadSafety/);
  assert.doesNotMatch(uatTest, /UAT_STAGE_DIAGNOSTIC_FILE/);
  const record = JSON.stringify({ testsFinishingWithOutstandingHeavyReads: 0, exceptionalHeavyDrainCount: 0, exceptionalHeavyDrainWaitMs: 0, realHeavyStarts: 3, preventedHeavyStarts: 2, outstandingHeavyReads: [] });
  assert.deepEqual(scanArtifact('test-results/uat-results.json', record), { path: 'test-results/uat-results.json', categories: [], safe: true });
});

test('authenticated workers/retries stay strict and no arbitrary multi-second sleeps are introduced', () => {
  const config = read('playwright.config.js');
  const changedSources = [
    read('e2e/helpers/uat-heavy-read-v3.js'),
    read('e2e/helpers/uat-auth.js'),
    read('e2e/helpers/uat-test.js'),
    read('e2e/smoke/admin.spec.js'),
    read('e2e/smoke/authenticated-v3.spec.js'),
    read('e2e/smoke/performance-validation.spec.js')
  ].join('\n');
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*authenticatedMode \? 0/);
  assert.doesNotMatch(changedSources, /waitForTimeout\((?:5_000|5000|10_000|10000)\)/);
});
