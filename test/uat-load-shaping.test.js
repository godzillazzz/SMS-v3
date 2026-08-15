'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const {
  AUTHENTICATED_BROWSER_HEAVY_LIMIT,
  HEAVY_READ_PATHS,
  authenticatedMode,
  continueWithAuthenticatedHeavyReadGate,
  createHeavyReadController,
  isHeavyReadRequest
} = require('../e2e/helpers/uat-heavy-read-gate');
const {
  MAX_SAMPLES,
  alternatingSequence,
  runMatchedBenchmarkGroup
} = require('../e2e/helpers/uat-performance');

function request(method, url) {
  return { method: () => method, url: () => url };
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('authenticated browser heavy-read gate classifies only approved expensive GET paths', () => {
  assert.equal(AUTHENTICATED_BROWSER_HEAVY_LIMIT, 2);
  assert.deepEqual([...HEAVY_READ_PATHS].sort(), [
    '/api/v1/dashboard',
    '/api/v1/executive-report',
    '/api/v1/reports/summary'
  ]);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/dashboard?x=1')), true);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/executive-report?month=8')), true);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/reports/summary')), true);
  assert.equal(isHeavyReadRequest(request('POST', 'https://example.test/api/v1/dashboard')), false);
  assert.equal(isHeavyReadRequest(request('GET', 'https://example.test/api/v1/licenses')), false);
  assert.equal(authenticatedMode({ UAT_MODE: 'authenticated' }), true);
  assert.equal(authenticatedMode({ UAT_MODE: 'technical' }), false);
});

test('heavy-read controller never allows more than two concurrent heavy tasks', async () => {
  const controller = createHeavyReadController({ limit: 2 });
  let active = 0;
  let observedPeak = 0;
  const tasks = Array.from({ length: 12 }, (_, index) => controller.run(async () => {
    active += 1;
    observedPeak = Math.max(observedPeak, active);
    await new Promise((resolve) => setTimeout(resolve, 8 + (index % 3)));
    active -= 1;
  }));
  await Promise.all(tasks);
  assert.equal(observedPeak, 2);
  assert.deepEqual(controller.snapshot(), { active: 0, waiting: 0, peak: 2, limit: 2 });
});

test('route-level authenticated gate holds permits until each heavy response settles', async () => {
  const page = new EventEmitter();
  let active = 0;
  let peak = 0;
  const heavyRequests = Array.from({ length: 8 }, (_, index) => request('GET', `https://example.test/api/v1/${index % 2 ? 'executive-report' : 'dashboard'}`));

  await Promise.all(heavyRequests.map((heavyRequest, index) => continueWithAuthenticatedHeavyReadGate({
    page,
    request: heavyRequest,
    environment: { UAT_MODE: 'authenticated' },
    continueRequest: async () => {
      active += 1;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active -= 1;
        page.emit('response', { request: () => heavyRequest });
      }, 6 + (index % 3));
    }
  })));

  assert.equal(peak, 2);
  assert.equal(active, 0);
});
test('lightweight requests remain outside the heavy-read gate classification', () => {
  for (const url of [
    'https://example.test/api/v1/health',
    'https://example.test/api/v1/licenses?page=1&pageSize=20',
    'https://example.test/api/v1/employees?page=1&pageSize=20',
    'https://example.test/api/v1/schedule-calendar?month=2026-08'
  ]) {
    assert.equal(isHeavyReadRequest(request('GET', url)), false);
  }
});

test('matched benchmark remains strictly sequential with unchanged C1/Candidate1 ordering and sample budget', async () => {
  assert.equal(MAX_SAMPLES, 3);
  assert.deepEqual(alternatingSequence(3), [
    { targetLabel: 'canonical', sampleIndex: 1 },
    { targetLabel: 'candidate', sampleIndex: 1 },
    { targetLabel: 'canonical', sampleIndex: 2 },
    { targetLabel: 'candidate', sampleIndex: 2 },
    { targetLabel: 'canonical', sampleIndex: 3 },
    { targetLabel: 'candidate', sampleIndex: 3 }
  ]);

  let active = 0;
  let peak = 0;
  const calls = [];
  const group = await runMatchedBenchmarkGroup({
    role: 'ADMIN',
    endpoint: '/api/v1/dashboard',
    sampleCount: 3,
    measure: async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      calls.push(`${input.targetLabel}:${input.sampleIndex}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ...input, status: 200, durationMs: 10, requestId: 'safe-id' };
    }
  });
  assert.equal(peak, 1);
  assert.deepEqual(calls, ['canonical:1', 'candidate:1', 'canonical:2', 'candidate:2', 'canonical:3', 'candidate:3']);
  assert.equal(group.samples.length, 6);
});

test('load shaping does not change global worker/retry policy and fixture remains disabled by default', () => {
  const config = read('playwright.config.js');
  const fixtureSpec = read('e2e/smoke/disposable-employee.spec.js');
  const uatTest = read('e2e/helpers/uat-test.js');
  const performance = read('e2e/helpers/uat-performance.js');

  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*authenticatedMode\s*\?\s*0/);
  assert.match(fixtureSpec, /test\.skip\(!destructiveFixtureEnabled\(\)/);
  assert.match(uatTest, /continueWithAuthenticatedHeavyReadGate/);
  assert.doesNotMatch(performance, /uat-heavy-read-gate|continueWithAuthenticatedHeavyReadGate/);
});

test('Playwright discovery surface remains nine spec files', () => {
  const specFiles = fs.readdirSync(path.resolve('e2e/smoke')).filter((name) => name.endsWith('.spec.js')).sort();
  assert.equal(specFiles.length, 9);
  assert.deepEqual(specFiles, [
    'admin.spec.js',
    'auth-boundary-v3.spec.js',
    'authenticated-v3.spec.js',
    'disposable-employee.spec.js',
    'performance-validation.spec.js',
    'regression.spec.js',
    'responsive.spec.js',
    'roles.spec.js',
    'technical.spec.js'
  ]);
});
