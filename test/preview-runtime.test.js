'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UNTRUSTED_ORIGIN, verifyPreviewRuntime } = require('../scripts/ci/verify-preview-runtime');

const previewOrigin = 'https://sms-v3-staging-git-codex-t29-printing-a4-20261007-godzillazz.vercel.app';
const previewEnv = { VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-preview-bypass-secret' };

function jsonResponse(status, body, headers = {}) {
  return { status, headers: new Headers(headers), json: async () => body };
}

test('Preview runtime gate checks health, database readiness, and trusted/untrusted CORS', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/health') && options.method !== 'OPTIONS') return jsonResponse(200, { status: 'ok' });
    if (url.endsWith('/api/v1/ready')) return jsonResponse(200, { status: 'ready', database: 'ok' });
    if (options.headers.Origin === UNTRUSTED_ORIGIN) return jsonResponse(403, { error: 'Origin not allowed.' });
    return jsonResponse(204, null, {
      'access-control-allow-origin': previewOrigin,
      'access-control-allow-credentials': 'true'
    });
  };

  const result = await verifyPreviewRuntime({ baseUrl: previewOrigin, env: previewEnv, fetchImpl, log: () => undefined });
  assert.deepEqual(result, {
    origin: previewOrigin,
    health: 'ok',
    database: 'ok',
    trustedCors: true,
    untrustedCorsRejected: true
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ options }) => options.redirect === 'manual'));
  assert.equal(calls[2].options.method, 'OPTIONS');
  assert.equal(calls[2].options.headers.Origin, previewOrigin);
  assert.equal(calls[3].options.headers.Origin, UNTRUSTED_ORIGIN);
  assert.ok(calls.every(({ options }) => options.headers['x-vercel-protection-bypass'] === previewEnv.VERCEL_AUTOMATION_BYPASS_SECRET));
});

test('Preview runtime gate rejects unready database and untrusted CORS allow responses', async () => {
  await assert.rejects(() => verifyPreviewRuntime({
    baseUrl: previewOrigin,
    env: previewEnv,
    fetchImpl: async (url) => url.endsWith('/api/v1/health')
      ? jsonResponse(200, { status: 'ok' })
      : jsonResponse(503, { status: 'not_ready', database: 'unavailable' }),
    log: () => undefined
  }), /PREVIEW_READY_HTTP_503/);

  const calls = [];
  await assert.rejects(() => verifyPreviewRuntime({
    baseUrl: previewOrigin,
    env: previewEnv,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/v1/health') && options.method !== 'OPTIONS') return jsonResponse(200, { status: 'ok' });
      if (url.endsWith('/api/v1/ready')) return jsonResponse(200, { status: 'ready', database: 'ok' });
      if (options.headers.Origin === UNTRUSTED_ORIGIN) return jsonResponse(204, null, { 'access-control-allow-origin': UNTRUSTED_ORIGIN });
      return jsonResponse(204, null, {
        'access-control-allow-origin': previewOrigin,
        'access-control-allow-credentials': 'true'
      });
    },
    log: () => undefined
  }), /PREVIEW_UNTRUSTED_CORS_FAILED/);
});

test('Preview runtime gate fails closed when the protected Preview bypass is unavailable', async () => {
  await assert.rejects(() => verifyPreviewRuntime({
    baseUrl: previewOrigin,
    env: {},
    fetchImpl: async () => { throw new Error('must not fetch'); },
    log: () => undefined
  }), /VERCEL_AUTOMATION_BYPASS_SECRET_MISSING/);
});

test('Preview runtime gate accepts only the SMS-v3 Vercel branch alias', async () => {
  await assert.rejects(() => verifyPreviewRuntime({ baseUrl: 'https://sms-v3-staging-ten.vercel.app', fetchImpl: async () => { throw new Error('must not fetch'); } }), /PREVIEW_URL_NOT_ALLOWED/);
  await assert.rejects(() => verifyPreviewRuntime({ baseUrl: 'https://example.invalid', fetchImpl: async () => { throw new Error('must not fetch'); } }), /PREVIEW_URL_NOT_ALLOWED/);
});
