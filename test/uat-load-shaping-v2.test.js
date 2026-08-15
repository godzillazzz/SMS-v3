'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_QUIET_WINDOW_MS,
  DEFAULT_RUNTIME_CEILING_MS,
  DEFAULT_SAFETY_MARGIN_MS,
  HeavyReadSettlementTracker,
  isHeavyReadRequest,
  preventHarnessBootstrapHeavyRead
} = require('../e2e/helpers/uat-heavy-read-settlement');
const {
  MAX_SAMPLES,
  alternatingSequence,
  runMatchedBenchmarkGroup
} = require('../e2e/helpers/uat-performance');

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

function request(method, url) {
  return { method: () => method, url: () => url };
}

class FakePage extends EventEmitter {
  off(event, listener) {
    return this.removeListener(event, listener);
  }
}

function createFakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + Math.max(0, delay), fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advanceTo(target) {
      await Promise.resolve();
      assert.ok(target >= now);
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
        if (!due.length) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    }
  };
}

function trackerWithClock(page, clock, overrides = {}) {
  return new HeavyReadSettlementTracker(page, {
    environment: { UAT_MODE: 'authenticated' },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides
  });
}

test('V2 classifies only authenticated heavy GET routes', () => {
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/dashboard?month=2026-08')), true);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/executive-report')), true);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/reports/summary')), true);
  assert.equal(isHeavyReadRequest(request('POST', 'https://example.test/api/v1/dashboard')), false);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/licenses')), false);
});

test('test A body may return before a 25-second heavy request, but settlement blocks test B until completion', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const heavy = request('GET', 'https://example.test/api/v1/dashboard');
  page.emit('request', heavy);

  let testBStarted = false;
  let drained = false;
  const barrier = tracker.drain().then(() => { drained = true; testBStarted = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(testBStarted, false);

  await clock.advanceTo(25_000);
  assert.equal(drained, false);
  page.emit('requestfinished', heavy);
  await Promise.resolve();
  assert.equal(testBStarted, false);

  await clock.advanceTo(25_000 + DEFAULT_QUIET_WINDOW_MS);
  await barrier;
  assert.equal(drained, true);
  assert.equal(testBStarted, true);
  tracker.stop();
});

test('several heavy requests inside one test overlap naturally and barrier waits for all', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const dashboard = request('GET', 'https://example.test/api/v1/dashboard');
  const executive = request('GET', 'https://example.test/api/v1/executive-report');
  const summary = request('GET', 'https://example.test/api/v1/reports/summary');
  page.emit('request', dashboard);
  page.emit('request', executive);
  page.emit('request', summary);
  assert.equal(tracker.summary().outstanding, 3);

  let drained = false;
  const barrier = tracker.drain().then(() => { drained = true; });
  page.emit('requestfinished', dashboard);
  page.emit('requestfinished', summary);
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(tracker.summary().outstanding, 1);
  page.emit('requestfinished', executive);
  await clock.advanceTo(DEFAULT_QUIET_WINDOW_MS);
  await barrier;
  assert.equal(drained, true);
  tracker.stop();
});

test('page close never releases an outstanding heavy request', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const heavy = request('GET', 'https://example.test/api/v1/dashboard');
  page.emit('request', heavy);
  page.emit('close');
  await assert.rejects(tracker.drain(), { code: 'UAT_HEAVY_READ_UNSETTLED_ON_PAGE_CLOSE' });
  assert.equal(tracker.summary().outstanding, 1);
  tracker.stop();
});

test('ambiguous requestfailed retains server accounting until runtime ceiling plus safety margin', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const heavy = request('GET', 'https://example.test/api/v1/executive-report');
  page.emit('request', heavy);
  await clock.advanceTo(1_000);
  page.emit('requestfailed', heavy);

  let drained = false;
  const barrier = tracker.drain().then(() => { drained = true; });
  await clock.advanceTo(DEFAULT_RUNTIME_CEILING_MS + DEFAULT_SAFETY_MARGIN_MS - 1);
  assert.equal(drained, false);
  assert.equal(tracker.summary().outstanding, 1);

  await clock.advanceTo(DEFAULT_RUNTIME_CEILING_MS + DEFAULT_SAFETY_MARGIN_MS);
  assert.equal(tracker.summary().ceilingSettlements, 1);
  await clock.advanceTo(DEFAULT_RUNTIME_CEILING_MS + DEFAULT_SAFETY_MARGIN_MS + DEFAULT_QUIET_WINDOW_MS);
  await barrier;
  assert.equal(drained, true);
  tracker.stop();
});

test('live heavy request that exceeds runtime ceiling fails closed with drain timeout', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const heavy = request('GET', 'https://example.test/api/v1/dashboard');
  page.emit('request', heavy);
  const barrier = tracker.drain();
  await clock.advanceTo(DEFAULT_RUNTIME_CEILING_MS + DEFAULT_SAFETY_MARGIN_MS);
  await assert.rejects(barrier, { code: 'UAT_HEAVY_READ_DRAIN_TIMEOUT' });
  tracker.stop();
});

test('quiet window restarts if deferred heavy work appears after initial settlement', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const first = request('GET', 'https://example.test/api/v1/dashboard');
  const deferred = request('GET', 'https://example.test/api/v1/executive-report');
  page.emit('request', first);
  const barrier = tracker.drain();
  page.emit('requestfinished', first);
  await clock.advanceTo(150);
  page.emit('request', deferred);
  await clock.advanceTo(300);
  page.emit('requestfinished', deferred);
  await clock.advanceTo(599);
  let settled = false;
  barrier.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  await clock.advanceTo(600);
  await barrier;
  tracker.stop();
});

test('Harness-prevented bootstrap Dashboard is removed before network accounting and does not wait 63 seconds', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  const transient = request('GET', 'https://example.test/api/v1/dashboard');
  page.emit('request', transient);
  preventHarnessBootstrapHeavyRead(page, transient);
  page.emit('requestfailed', transient);
  const summary = await tracker.drain();
  assert.equal(summary.realHeavyStarts, 0);
  assert.equal(summary.preventedStarts, 1);
  assert.equal(summary.outstanding, 0);
  tracker.stop();
});

test('lightweight requests are ignored by settlement accounting', async () => {
  const page = new FakePage();
  const clock = createFakeClock();
  const tracker = trackerWithClock(page, clock);
  page.emit('request', request('GET', 'https://example.test/api/v1/licenses'));
  const summary = await tracker.drain();
  assert.equal(summary.realHeavyStarts, 0);
  assert.equal(summary.outstanding, 0);
  tracker.stop();
});

test('matched benchmark remains exact six-step alternating sequence with concurrency one', async () => {
  assert.equal(MAX_SAMPLES, 3);
  assert.deepEqual(alternatingSequence(), [
    { targetLabel: 'canonical', sampleIndex: 1 },
    { targetLabel: 'candidate', sampleIndex: 1 },
    { targetLabel: 'canonical', sampleIndex: 2 },
    { targetLabel: 'candidate', sampleIndex: 2 },
    { targetLabel: 'canonical', sampleIndex: 3 },
    { targetLabel: 'candidate', sampleIndex: 3 }
  ]);
  let active = 0;
  let peak = 0;
  const seen = [];
  const group = await runMatchedBenchmarkGroup({
    role: 'ADMIN',
    endpoint: '/api/v1/dashboard',
    sampleCount: 3,
    measure: async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      seen.push(`${input.targetLabel}${input.sampleIndex}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ...input, status: 200, durationMs: 1, requestId: 'safe-id' };
    }
  });
  assert.equal(peak, 1);
  assert.deepEqual(seen, ['canonical1', 'candidate1', 'canonical2', 'candidate2', 'canonical3', 'candidate3']);
  assert.equal(group.samples.length, 6);
});

test('V2 bootstrap removes transient Dashboard while explicit login and Dashboard coverage remain real', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const authenticated = read('e2e/smoke/authenticated-v3.spec.js');
  const admin = read('e2e/smoke/admin.spec.js');
  const responsive = read('e2e/smoke/responsive.spec.js');
  const roles = read('e2e/smoke/roles.spec.js');

  assert.match(auth, /preventHarnessBootstrapHeavyRead\(page, request\)/);
  assert.match(auth, /route\.abort\('aborted'\)/);
  assert.match(authenticated, /NAV01_LOGIN'[\s\S]*loginViaUi\(page, role\)/);
  assert.match(authenticated, /const accessToken = roleAccessToken\(role\)/);
  assert.match(authenticated, /if \(item\.id === 'dashboard'\) await loginAs\(page, role\);/);
  assert.match(admin, /dashboard is complete[\s\S]*loginAs\(page, 'ADMIN'\)/);
  assert.match(responsive, /loginAs\(page, 'ADMIN'\)/);
  assert.match(roles, /loginAs\(page, role\)/);
});

test('Report Center exact network semantics stay unchanged and V2 has no within-test gate', () => {
  const spec = read('e2e/smoke/performance-validation.spec.js');
  const uatTest = read('e2e/helpers/uat-test.js');
  assert.match(spec, /expect\(initialExecutiveCount\)\.toBe\(1\)/);
  assert.match(spec, /expect\(firstSummaryCount\)\.toBe\(1\)/);
  assert.match(spec, /reentryAdditional[\s\S]*\.toBe\(0\)/);
  assert.match(spec, /hiddenExecutiveAdditional[\s\S]*\.toBe\(0\)/);
  assert.match(spec, /executiveReturnAdditional[\s\S]*\.toBe\(1\)/);
  assert.match(spec, /summaryRefreshAdditional[\s\S]*\.toBe\(1\)/);
  assert.match(spec, /executive-report-print-page/);
  assert.doesNotMatch(spec, /semaphore|acquire|permit|heavy-read-gate|waitForTimeout\((?:5000|10000)\)/);
  assert.match(uatTest, /heavyReadSettlement:[\s\S]*await tracker\.drain\(\)/);
});

test('direct functional heavy API helper is awaited and benchmark helper is not routed through settlement', () => {
  const direct = read('e2e/helpers/uat-authenticated-request.js');
  const performance = read('e2e/helpers/uat-performance.js');
  assert.match(direct, /const response = await fetch\(url/);
  assert.match(direct, /const payload = await response\.json\(\)/);
  assert.doesNotMatch(performance, /uat-heavy-read-settlement|HeavyReadSettlementTracker|semaphore|permit/);
});

test('Disposable fixture stays disabled and no destructive Production fixture wiring exists in harness snapshot', () => {
  const fixture = read('e2e/smoke/disposable-employee.spec.js');
  const workflow = read('.github/workflows/automated-uat-sms-v3-staging.yml');
  assert.match(fixture, /test\.skip\(!destructiveFixtureEnabled\(\)/);
  assert.doesNotMatch(workflow, /disposable-approved-v1|fixture_confirmation|DATABASE_URL|UAT_DISPOSABLE_EMPLOYEE_ENABLED/);
});

test('workers remain one, retries stay zero in authenticated mode, and no arbitrary multi-second sleeps are introduced', () => {
  const config = read('playwright.config.js');
  const changedHarness = [
    read('e2e/helpers/uat-heavy-read-settlement.js'),
    read('e2e/helpers/uat-auth.js'),
    read('e2e/helpers/uat-test.js')
  ].join('\n');
  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*authenticatedMode\s*\?\s*0/);
  assert.doesNotMatch(changedHarness, /waitForTimeout\((?:5000|10000)\)|sleep\((?:5000|10000)\)/);
  assert.equal(DEFAULT_RUNTIME_CEILING_MS, 60_000);
  assert.equal(DEFAULT_SAFETY_MARGIN_MS, 3_000);
  assert.equal(DEFAULT_QUIET_WINDOW_MS, 300);
});

test('Playwright discovery surface remains nine spec files', () => {
  const specs = fs.readdirSync(path.resolve('e2e/smoke')).filter((name) => name.endsWith('.spec.js')).sort();
  assert.equal(specs.length, 9);
});
