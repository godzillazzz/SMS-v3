'use strict';

const PREVIEW_HOST = /^sms-v3-staging-git-[a-z0-9-]+-godzillazz\.vercel\.app$/i;
const UNTRUSTED_ORIGIN = 'https://example.invalid';
const { automationRequestOptions } = require('../../e2e/helpers/technical-smoke');

function normalizedPreviewOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !PREVIEW_HOST.test(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PREVIEW_URL_NOT_ALLOWED');
  }
  return url.origin;
}

async function verifyPreviewRuntime({ baseUrl, fetchImpl = globalThis.fetch, env = process.env, log = console.log } = {}) {
  const origin = normalizedPreviewOrigin(baseUrl || '');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
  if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET_MISSING');
  const withPreviewBypass = (options) => automationRequestOptions(options, env, origin, origin);

  const health = await fetchImpl(`${origin}/api/v1/health`, withPreviewBypass({
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  }));
  if (health.status !== 200) throw new Error(`PREVIEW_HEALTH_HTTP_${health.status}`);
  const healthBody = await health.json();
  if (healthBody.status !== 'ok') throw new Error('PREVIEW_HEALTH_INVALID');
  log('PREVIEW_HEALTH=PASS');

  const ready = await fetchImpl(`${origin}/api/v1/ready`, withPreviewBypass({
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  }));
  if (ready.status !== 200) throw new Error(`PREVIEW_READY_HTTP_${ready.status}`);
  const readyBody = await ready.json();
  if (readyBody.status !== 'ready' || readyBody.database !== 'ok') throw new Error('PREVIEW_DATABASE_READINESS_FAILED');
  log('PREVIEW_READY_DATABASE=PASS');

  const preflightHeaders = {
    Origin: origin,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,content-type'
  };
  const trusted = await fetchImpl(`${origin}/api/v1/health`, withPreviewBypass({
    method: 'OPTIONS',
    headers: preflightHeaders,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  }));
  if (trusted.status !== 204 || trusted.headers.get('access-control-allow-origin') !== origin || trusted.headers.get('access-control-allow-credentials') !== 'true') {
    throw new Error('PREVIEW_TRUSTED_CORS_FAILED');
  }
  log('PREVIEW_TRUSTED_CORS=PASS');

  const untrusted = await fetchImpl(`${origin}/api/v1/health`, withPreviewBypass({
    method: 'OPTIONS',
    headers: { ...preflightHeaders, Origin: UNTRUSTED_ORIGIN },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  }));
  if (untrusted.status !== 403 || untrusted.headers.get('access-control-allow-origin') !== null) {
    throw new Error('PREVIEW_UNTRUSTED_CORS_FAILED');
  }
  log('PREVIEW_UNTRUSTED_CORS=PASS');
  return { origin, health: 'ok', database: 'ok', trustedCors: true, untrustedCorsRejected: true };
}

async function main({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, error = console.error } = {}) {
  try {
    await verifyPreviewRuntime({ baseUrl: env.PREVIEW_BASE_URL, fetchImpl, log });
    return 0;
  } catch (reason) {
    error(`PREVIEW_RUNTIME_FAILED=${reason.message}`);
    return 1;
  }
}

if (require.main === module) main().then((status) => { process.exitCode = status; });

module.exports = { PREVIEW_HOST, UNTRUSTED_ORIGIN, normalizedPreviewOrigin, verifyPreviewRuntime, main };
