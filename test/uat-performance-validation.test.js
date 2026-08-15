'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CANDIDATE_BASE_URL,
  alternatingSequence,
  assertApprovedBenchmarkTargets,
  median,
  medianDeltaPercent,
  runMatchedBenchmarkGroup,
  sanitizePerformanceValidation,
  shouldRunPerformanceValidation,
  summarizeSamples
} = require('../e2e/helpers/uat-performance');
const { createBoundedNetworkObserver, normalizeNetworkPath } = require('../e2e/helpers/uat-network');
const { scanArtifact } = require('../e2e/helpers/uat-v3-security');

function sample(targetLabel, sampleIndex, status = 200, durationMs = 100) {
  return {
    targetLabel,
    role: 'ADMIN',
    endpoint: '/api/v1/dashboard?department=DO-NOT-PERSIST',
    filterCategory: 'default-current-period',
    sampleIndex,
    status,
    durationMs,
    requestId: `safe-request-${targetLabel}-${sampleIndex}`
  };
}

test('performance stats median of three is correct', () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(summarizeSamples([{ durationMs: 30 }, { durationMs: 10 }, { durationMs: 20 }]).medianMs, 20);
});

test('performance median delta percent is correct', () => {
  assert.equal(medianDeltaPercent(200, 150), -25);
  assert.equal(medianDeltaPercent(200, 250), 25);
});

test('n=3 summary never generates p90 or p95', () => {
  const stats = summarizeSamples([{ durationMs: 10 }, { durationMs: 20 }, { durationMs: 30 }]);
  assert.deepEqual(Object.keys(stats).sort(), ['count', 'maxMs', 'medianMs', 'minMs']);
  assert.equal('p90' in stats, false);
  assert.equal('p95' in stats, false);
});

test('matched benchmark sequence alternates canonical and candidate', () => {
  assert.deepEqual(alternatingSequence(3), [
    { targetLabel: 'canonical', sampleIndex: 1 },
    { targetLabel: 'candidate', sampleIndex: 1 },
    { targetLabel: 'canonical', sampleIndex: 2 },
    { targetLabel: 'candidate', sampleIndex: 2 },
    { targetLabel: 'canonical', sampleIndex: 3 },
    { targetLabel: 'candidate', sampleIndex: 3 }
  ]);
});

test('maximum sample count is enforced', () => {
  assert.throws(() => alternatingSequence(4), /UAT_BENCHMARK_SAMPLE_BUDGET_INVALID/);
  assert.throws(() => alternatingSequence(0), /UAT_BENCHMARK_SAMPLE_BUDGET_INVALID/);
});

test('5xx stops only the current matched endpoint group', async () => {
  const calls = [];
  const result = await runMatchedBenchmarkGroup({
    role: 'ADMIN',
    endpoint: '/api/v1/dashboard',
    sampleCount: 3,
    measure: async ({ targetLabel, sampleIndex }) => {
      calls.push(`${targetLabel}${sampleIndex}`);
      return sample(targetLabel, sampleIndex, targetLabel === 'candidate' ? 503 : 200);
    }
  });
  assert.deepEqual(calls, ['canonical1', 'candidate1']);
  assert.equal(result.samples.length, 2);
  assert.equal(result.classification, 'PERFORMANCE_REGRESSED');
});

test('performance serializer excludes bodies headers credentials emails passwords and URL query values', () => {
  const unsafe = {
    networkContracts: {
      license: [{
        targetLabel: 'candidate', role: 'ADMIN', endpoint: '/api/v1/licenses?employee=SECRET', filterCategory: 'initial-collection', count: 1, status: 200, classification: 'PASS',
        body: { employeeName: 'SECRET PERSON' }, headers: { Authorization: 'Bearer SECRET_TOKEN' }, token: 'SECRET_TOKEN', cookie: 'SECRET_COOKIE', email: 'uat@example.test', password: 'SECRET_PASSWORD'
      }]
    },
    benchmark: {
      groups: [{
        role: 'ADMIN', endpoint: '/api/v1/dashboard?department=SECRET_DEPARTMENT', filterCategory: 'default-current-period', classification: 'PERFORMANCE_NEUTRAL',
        samples: [sample('canonical', 1), sample('candidate', 1)]
      }],
      classification: 'PERFORMANCE_NEUTRAL'
    }
  };
  const serialized = JSON.stringify(sanitizePerformanceValidation(unsafe));
  for (const forbidden of ['SECRET PERSON', 'SECRET_TOKEN', 'SECRET_COOKIE', 'uat@example.test', 'SECRET_PASSWORD', 'SECRET_DEPARTMENT', 'employee=SECRET']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(serialized.includes('/api/v1/dashboard'), true);
  assert.equal(serialized.includes('/api/v1/licenses'), true);
});

test('license fan-out observer ignores legitimate collection preloads and detects document-history requests', () => {
  const page = new EventEmitter();
  const observer = createBoundedNetworkObserver(page, { trackedPaths: ['/api/v1/licenses/{licenseId}/documents'] });
  const request = (url) => ({ url: () => url, method: () => 'GET' });
  try {
    page.emit('request', request('https://sms-v3-staging.example/api/v1/licenses?page=1'));
    page.emit('request', request('https://sms-v3-staging.example/api/v1/licenses?page=1'));
    assert.equal(observer.requestCount('/api/v1/licenses/{licenseId}/documents'), 0);

    page.emit('request', request('https://sms-v3-staging.example/api/v1/licenses/123e4567-e89b-12d3-a456-426614174000/documents?source=SECRET'));
    assert.equal(observer.requestCount('/api/v1/licenses/{licenseId}/documents'), 1);
  } finally {
    observer.stop();
  }
});

test('network normalizer never persists a dynamic license ID or query values', () => {
  const normalized = normalizeNetworkPath('https://sms-v3-staging.example/api/v1/licenses/123e4567-e89b-12d3-a456-426614174000/documents?employee=SECRET');
  assert.equal(normalized, '/api/v1/licenses/{licenseId}/documents');
  assert.equal(normalized.includes('123e4567'), false);
  assert.equal(normalized.includes('SECRET'), false);
});

test('technical mode skips authenticated performance validation', () => {
  assert.equal(shouldRunPerformanceValidation({ UAT_MODE: 'technical' }), false);
  assert.equal(shouldRunPerformanceValidation({ UAT_MODE: 'authenticated' }), true);
});

test('benchmark host validation rejects any unauthorized candidate host', () => {
  assert.deepEqual(assertApprovedBenchmarkTargets(CANDIDATE_BASE_URL), {
    canonical: 'https://sms-v3-staging-ten.vercel.app',
    candidate: CANDIDATE_BASE_URL
  });
  assert.throws(() => assertApprovedBenchmarkTargets('https://example.com'), /UAT_BENCHMARK_TARGET_REJECTED/);
  assert.throws(() => assertApprovedBenchmarkTargets('https://sms-v3-staging-other-godzillazz.vercel.app'), /UAT_BENCHMARK_TARGET_REJECTED/);
});


test('sanitized performance validation passes the existing artifact security scanner', () => {
  const safe = sanitizePerformanceValidation({
    benchmark: {
      groups: [{ role: 'ADMIN', endpoint: '/api/v1/dashboard', filterCategory: 'default-current-period', samples: [sample('canonical', 1), sample('candidate', 1)] }],
      classification: 'PERFORMANCE_NEUTRAL'
    }
  });
  const content = Buffer.from(JSON.stringify({ performanceValidation: safe }));
  const result = scanArtifact('test-results/uat-results.json', content, {
    secretValues: ['DO_NOT_APPEAR_SECRET'],
    passwordValues: ['DO_NOT_APPEAR_PASSWORD'],
    emailValues: ['do-not-appear@example.test']
  });
  assert.equal(result.safe, true);
  assert.deepEqual(result.categories, []);
});
