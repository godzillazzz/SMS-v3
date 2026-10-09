'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED, verifyR5BPreviewCors } = require('../scripts/ci/r5b-preview-cors-check');

const env = () => ({
  PREVIEW_URL: EXPECTED.previewUrl,
  EXPECTED_DEPLOYMENT_ID: EXPECTED.deploymentId,
  CONTROL_SHA: EXPECTED.controlSha,
  SOURCE_BRANCH: EXPECTED.sourceBranch,
  FROZEN_APPLICATION_SHA: EXPECTED.frozenApplicationSha,
  VERCEL_TOKEN: 'synthetic-vercel-token',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-preview-bypass'
});

function response(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function successfulFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    calls.push({ url: url.toString(), method, headers: init.headers || {}, body: init.body });
    if (url.hostname === 'api.vercel.com' && url.pathname.startsWith('/v9/projects/')) {
      return response(200, overrides.project || {
        id: EXPECTED.projectId,
        accountId: EXPECTED.teamId,
        autoAssignCustomDomains: false
      });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname.startsWith('/v13/deployments/')) {
      return response(200, overrides.deployment || {
        id: EXPECTED.deploymentId,
        projectId: EXPECTED.projectId,
        ownerId: EXPECTED.teamId,
        url: new URL(EXPECTED.previewUrl).hostname,
        target: null,
        state: 'READY',
        readyState: 'READY',
        meta: {
          githubCommitSha: EXPECTED.controlSha,
          githubCommitRef: EXPECTED.sourceBranch,
          githubOrg: 'godzillazzz',
          githubRepo: 'SMS-v3'
        }
      });
    }
    if (url.origin === EXPECTED.previewUrl && url.pathname === '/api/v1/health' && method === 'GET') {
      return response(200, { status: 'ok' });
    }
    if (url.origin === EXPECTED.previewUrl && url.pathname === '/api/v1/ready' && method === 'GET') {
      return response(200, { status: 'ready', database: 'ok' });
    }
    if (url.origin === EXPECTED.previewUrl && url.pathname === '/api/v1/auth/login' && method === 'OPTIONS') {
      const origin = init.headers.Origin;
      if (origin === EXPECTED.previewUrl) {
        return response(204, null, {
          'access-control-allow-origin': EXPECTED.previewUrl,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
          'access-control-allow-headers': 'authorization,content-type'
        });
      }
      if (origin === EXPECTED.untrustedOrigin) return response(403, { message: 'Origin not allowed.' });
    }
    throw new Error('unexpected request');
  };
  return { calls, fetchImpl };
}

test('R5-B Preview check verifies identity, readiness and credentialed CORS using GET/OPTIONS only', async () => {
  const { calls, fetchImpl } = successfulFetch();
  const logs = [];
  const result = await verifyR5BPreviewCors({ env: env(), fetchImpl, log: (line) => logs.push(line) });
  assert.deepEqual(result, {
    identity: 'PASS',
    health: 'PASS',
    readinessDatabase: 'PASS',
    trustedCors: 'PASS',
    untrustedCors: 'PASS'
  });
  assert.deepEqual([...new Set(calls.map((call) => call.method))].sort(), ['GET', 'OPTIONS']);
  assert.ok(calls.every((call) => call.body === undefined));
  assert.ok(logs.some((line) => line.includes('TRUSTED_CORS=PASS')));
  assert.ok(logs.some((line) => line.includes('UNTRUSTED_CORS=PASS')));
  assert.ok(logs.every((line) => !line.includes('synthetic-vercel-token') && !line.includes('synthetic-preview-bypass')));
});

test('missing or changed immutable inputs fail before network access', async () => {
  const { fetchImpl, calls } = successfulFetch();
  const wrong = env();
  wrong.PREVIEW_URL += '/';
  await assert.rejects(() => verifyR5BPreviewCors({ env: wrong, fetchImpl, log: () => {} }), { code: 'PREVIEW_URL_MISMATCH' });
  assert.equal(calls.length, 0);
});

test('a missing Vercel configuration field does not count as false', async () => {
  const { fetchImpl, calls } = successfulFetch({ project: { id: EXPECTED.projectId, accountId: EXPECTED.teamId } });
  await assert.rejects(() => verifyR5BPreviewCors({ env: env(), fetchImpl, log: () => {} }), { code: 'AUTO_ASSIGN_CUSTOM_DOMAINS_NOT_VERIFIED_FALSE' });
  assert.equal(calls.length, 1);
});

test('deployment identity mismatch stops before runtime requests', async () => {
  const { fetchImpl, calls } = successfulFetch({
    deployment: {
      id: EXPECTED.deploymentId,
      projectId: EXPECTED.projectId,
      url: new URL(EXPECTED.previewUrl).hostname,
      target: null,
      readyState: 'READY',
      meta: {
        githubCommitSha: '0'.repeat(40),
        githubCommitRef: EXPECTED.sourceBranch,
        githubOrg: 'godzillazzz',
        githubRepo: 'SMS-v3'
      }
    }
  });
  await assert.rejects(() => verifyR5BPreviewCors({ env: env(), fetchImpl, log: () => {} }), { code: 'VERCEL_DEPLOYMENT_IDENTITY_MISMATCH' });
  assert.equal(calls.length, 2);
});

test('trusted CORS fails closed when credentials or requested method/header are not allowed', async () => {
  const { fetchImpl } = successfulFetch();
  const broken = async (input, init = {}) => {
    const responseValue = await fetchImpl(input, init);
    if (new URL(String(input)).pathname === '/api/v1/auth/login'
        && init.method === 'OPTIONS' && init.headers.Origin === EXPECTED.previewUrl) {
      return response(204, null, {
        'access-control-allow-origin': EXPECTED.previewUrl,
        'access-control-allow-credentials': 'false',
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'content-type'
      });
    }
    return responseValue;
  };
  await assert.rejects(() => verifyR5BPreviewCors({ env: env(), fetchImpl: broken, log: () => {} }), { code: 'PREVIEW_TRUSTED_CORS_FAILED' });
});

test('untrusted CORS fails if the origin is allowed', async () => {
  const { fetchImpl } = successfulFetch();
  const permissive = async (input, init = {}) => {
    if (new URL(String(input)).pathname === '/api/v1/auth/login'
        && init.method === 'OPTIONS' && init.headers.Origin === EXPECTED.untrustedOrigin) {
      return response(204, null, {
        'access-control-allow-origin': EXPECTED.untrustedOrigin,
        'access-control-allow-credentials': 'true'
      });
    }
    return fetchImpl(input, init);
  };
  await assert.rejects(() => verifyR5BPreviewCors({ env: env(), fetchImpl: permissive, log: () => {} }), { code: 'PREVIEW_UNTRUSTED_CORS_FAILED' });
});
