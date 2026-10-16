'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  EXPECTED,
  signChallenge
} = require('../src/services/runtime-isolation-probe.service');
const { createRuntimeIsolationRoutes } = require('../src/routes/runtime-isolation-probe.routes');

const SHA = 'a'.repeat(40);
const DEPLOYMENT_ID = 'dpl_RouteFixture123';
const HMAC_FIXTURE = 'TEST_ONLY_HMAC_KEY_MATERIAL_0123456789';
const NOW = Date.now();
const ISSUED_AT = String(Math.floor(NOW / 1000));
const URL = 'sms-v3-staging-preview-fixture-godzillazz.vercel.app';

function env(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: EXPECTED.projectId,
    VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
    VERCEL_URL: URL,
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_GIT_COMMIT_REF: EXPECTED.integrationRef,
    VERCEL_GIT_REPO_OWNER: 'godzillazzz',
    VERCEL_GIT_REPO_SLUG: 'SMS-v3',
    UAT_V3_RUNTIME_PROBE_HMAC_SECRET: HMAC_FIXTURE,
    ...overrides
  };
}

function appFor(runtime, counters) {
  const app = express();
  app.use('/api/v1/ops/preview-isolation-attestation',
    createRuntimeIsolationRoutes({
      environment: runtime,
      prisma: {
        async $transaction() {
          counters.database += 1;
          throw new Error('Database should not run in negative route cases.');
        }
      },
      fetchImpl: async () => {
        counters.storage += 1;
        throw new Error('Storage should not run in negative route cases.');
      },
      logger: { warn() {} }
    }));
  return app;
}

function challenge(runtime, overrides = {}) {
  const nonce = 'b'.repeat(32);
  const issuedAt = String(Math.floor(NOW / 1000));
  const fields = {
    host: runtime.VERCEL_URL,
    deploymentId: overrides.deploymentId || DEPLOYMENT_ID,
    sha: overrides.sha || SHA,
    nonce,
    issuedAt: Number(issuedAt)
  };
  const signature = signChallenge(runtime.UAT_V3_RUNTIME_PROBE_HMAC_SECRET, fields);
  return { nonce, issuedAt, signature };
}

test('unauthorized GET receives 401 before Database or Storage access', async () => {
  const runtime = env();
  const counters = { database: 0, storage: 0 };
  const app = appFor(runtime, counters);
  const response = await request(app)
    .get('/api/v1/ops/preview-isolation-attestation')
    .query({ nonce: 'b'.repeat(32), sha: SHA, deploymentId: DEPLOYMENT_ID, issuedAt: ISSUED_AT })
    .set('host', URL);
  assert.equal(response.status, 401);
  assert.equal(response.body.status, 'unverified');
  assert.deepEqual(counters, { database: 0, storage: 0 });
});

test('Production, HEAD and wrong SHA fail closed without touching providers', async () => {
  const runtime = env();
  const counters = { database: 0, storage: 0 };
  const app = appFor(runtime, counters);
  const proof = challenge(runtime);

  const head = await request(app)
    .head('/api/v1/ops/preview-isolation-attestation')
    .query({ nonce: proof.nonce, sha: SHA, deploymentId: DEPLOYMENT_ID, issuedAt: proof.issuedAt })
    .set('x-smsv3-probe-signature', proof.signature);
  assert.equal(head.status, 405);

  const wrongSha = await request(app)
    .get('/api/v1/ops/preview-isolation-attestation')
    .query({
      nonce: proof.nonce, sha: 'c'.repeat(40), deploymentId: DEPLOYMENT_ID,
      issuedAt: proof.issuedAt
    })
    .set('x-smsv3-probe-signature', proof.signature);
  assert.equal(wrongSha.status, 503);
  assert.deepEqual(counters, { database: 0, storage: 0 });
});

test('Production GET and HEAD hide the route before any Provider access', async () => {
  const runtime = env({ VERCEL_ENV: 'production' });
  const counters = { database: 0, storage: 0 };
  const app = appFor(runtime, counters);
  const getResponse = await request(app)
    .get('/api/v1/ops/preview-isolation-attestation')
    .query({ nonce: 'b'.repeat(32), sha: SHA, deploymentId: DEPLOYMENT_ID, issuedAt: ISSUED_AT })
    .set('x-smsv3-probe-signature', 'v1=' + '0'.repeat(64));
  const headResponse = await request(app)
    .head('/api/v1/ops/preview-isolation-attestation')
    .query({ nonce: 'b'.repeat(32), sha: SHA, deploymentId: DEPLOYMENT_ID, issuedAt: ISSUED_AT })
    .set('x-smsv3-probe-signature', 'v1=' + '0'.repeat(64));
  assert.equal(getResponse.status, 404);
  assert.equal(headResponse.status, 404);
  assert.deepEqual(counters, { database: 0, storage: 0 });
});
