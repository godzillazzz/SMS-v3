'use strict';

// Public, read-only production/preview readiness and CORS probe.
// Never follows arbitrary URLs, sends cookies/credentials, or emits response bodies.
const TARGETS = Object.freeze([
  ['PRODUCTION', 'https://sms-v3-staging-ten.vercel.app'],
  ['PREVIEW', 'https://sms-v3-staging-ntizvmjdo-godzillazz.vercel.app'],
]);
const TRUSTED_ORIGIN = 'https://sms-v3-staging-ten.vercel.app';
const UNTRUSTED_ORIGIN = 'https://r5b-untrusted.example.invalid';

function exactStatus(actual, expected, code) {
  if (actual !== expected) throw new Error(code);
}
async function req(origin, path, options={}) {
  if (!TARGETS.some(([,url]) => url === origin)) throw Error('R5B_UNAPPROVED_TARGET');
  const url = new URL(path, origin);
  if (url.origin !== origin || !['/api/v1/health','/api/v1/ready'].includes(url.pathname)) {
    throw Error('R5B_UNAPPROVED_PROBE_PATH');
  }
  const method = options.method || 'GET';
  if (method !== 'GET' && method !== 'OPTIONS') throw Error('R5B_READONLY_METHOD_REQUIRED');
  const response = await fetch(url, {
    redirect: 'error',
    method,
    headers: options.headers || {},
    signal: AbortSignal.timeout(15000),
  });
  return response;
}
async function proveTarget(kind, origin) {
  const health = await req(origin, '/api/v1/health');
  console.log('R5B_' + kind + '_HEALTH_HTTP=' + health.status);
  exactStatus(health.status, 200, 'HEALTH_HTTP_NOT_PROVEN');
  const healthJson = await health.json();
  if (healthJson?.status !== 'ok') throw Error('HEALTH_BODY_NOT_PROVEN');
  console.log('R5B_' + kind + '_HEALTH=PASS');

  const ready = await req(origin, '/api/v1/ready');
  console.log('R5B_' + kind + '_READY_HTTP=' + ready.status);
  exactStatus(ready.status, 200, 'READINESS_HTTP_NOT_PROVEN');
  const readiness = await ready.json();
  if (readiness?.status !== 'ready' || readiness.database !== 'ok') {
    throw Error('READINESS_BODY_NOT_PROVEN');
  }
  console.log('R5B_' + kind + '_DATABASE_READINESS=PASS');

  const headersFor = (testOrigin) => ({
    Origin: testOrigin,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,content-type',
  });
  const trusted = await req(origin, '/api/v1/health', {
    method: 'OPTIONS',headers:headersFor(TRUSTED_ORIGIN)
  });
  exactStatus(trusted.status, 204, 'TRUSTED_CORS_HTTP_NOT_PROVEN');
  if (trusted.headers.get('access-control-allow-origin') !== TRUSTED_ORIGIN ||
      trusted.headers.get('access-control-allow-credentials') !== 'true') {
    throw Error('TRUSTED_CORS_HEADERS_NOT_PROVEN');
  }
  console.log('R5B_' + kind + '_TRUSTED_CORS=PASS');

  const untrusted = await req(origin, '/api/v1/health', {
    method: 'OPTIONS',headers:headersFor(UNTRUSTED_ORIGIN)
  });
  exactStatus(untrusted.status, 403, 'UNTRUSTED_CORS_REJECTION_NOT_PROVEN');
  if (untrusted.headers.get('access-control-allow-origin') === UNTRUSTED_ORIGIN) {
    throw Error('UNTRUSTED_CORS_HEADER_VIOLATION');
  }
  console.log('R5B_' + kind + '_UNTRUSTED_CORS=PASS');
}
async function run() {
  if (process.env.R5B_PROBE_READONLY_APPROVED !== 'YES' ||
      process.env.VERCEL_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.CRON_SECRET || process.env.DATABASE_URL) {
    throw Error('R5B_READONLY_PROBE_SCOPE_INVALID');
  }
  for (const [kind,url] of TARGETS) await proveTarget(kind,url);
  console.log('R5B_READONLY_PROBE=PASS');
  console.log('R5B_RAW_RESPONSE_BODY_EMITTED=false');
  console.log('R5B_PRODUCTION_DEPLOYMENT=NOT_ATTEMPTED');
}
if (require.main === module) {
  run().catch((error) => {
    // Stable error classes only; never echo network error, URL or response payload.
    const known = new Set(['HEALTH_HTTP_NOT_PROVEN','HEALTH_BODY_NOT_PROVEN',
      'READINESS_HTTP_NOT_PROVEN','READINESS_BODY_NOT_PROVEN',
      'TRUSTED_CORS_HTTP_NOT_PROVEN','TRUSTED_CORS_HEADERS_NOT_PROVEN',
      'UNTRUSTED_CORS_REJECTION_NOT_PROVEN','UNTRUSTED_CORS_HEADER_VIOLATION']);
    console.error('R5B_READONLY_BLOCKER=' + (known.has(error.message) ? error.message : 'REMOTE_ACCESS_NOT_VERIFIED'));
    console.error('R5B_READONLY_PROBE=FAIL_CLOSED');
    process.exitCode=1;
  });
}
module.exports={TARGETS,TRUSTED_ORIGIN,UNTRUSTED_ORIGIN,exactStatus,req,proveTarget,run};
