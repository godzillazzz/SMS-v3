'use strict';

const EXPECTED_HOST = 'sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app';
const POLICY_PATH = '/api/v1/attendance/time-policies';

function approvedPreviewOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== EXPECTED_HOST || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Preview origin did not match the pinned source alias');
  }
  return url.origin;
}

async function request(url, options = {}, fetchImpl = fetch) {
  return fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
}

async function safeJson(response) {
  try { return await response.json(); } catch { return null; }
}

function safeCode(body) {
  const code = body?.error?.code ?? body?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'NOT_EXPOSED';
}

function summarizePolicyBody(body) {
  const data = body?.data;
  const sites = Array.isArray(data?.sites) ? data.sites.length : null;
  const shiftTypes = Array.isArray(data?.shiftTypes) ? data.shiftTypes.length : null;
  const companyLoaded = Boolean(data?.defaultPolicy && typeof data.defaultPolicy === 'object');
  return { companyLoaded, sites, shiftTypes };
}

async function verifyReadonlyRuntime({ env = process.env, fetchImpl = fetch, log = console.log, outputPath = process.env.GITHUB_OUTPUT } = {}) {
  const origin = approvedPreviewOrigin(env.PREVIEW_ORIGIN);
  let healthy = false;
  let ready = false;
  let trustedCors = false;
  let deniedCors = false;
  let policyGetResult = 'NOT_RUN';
  let companyLoaded = 'UNKNOWN';
  let siteCount = 'UNKNOWN';
  let shiftTypeCount = 'UNKNOWN';
  let policyFailure = false;

  const healthResponse = await request(`${origin}/api/v1/health`, {}, fetchImpl);
  const healthBody = await safeJson(healthResponse);
  healthy = healthResponse.status === 200 && healthBody?.status === 'ok';
  log(`PREVIEW_HEALTH_HTTP=${healthResponse.status}`);
  log(`PREVIEW_HEALTH=${healthy ? 'PASS' : 'FAIL'}`);

  const readyResponse = await request(`${origin}/api/v1/ready`, {}, fetchImpl);
  const readyBody = await safeJson(readyResponse);
  ready = readyResponse.status === 200 && readyBody?.status === 'ready' && readyBody?.database === 'ok';
  log(`PREVIEW_READY_HTTP=${readyResponse.status}`);
  log(`PREVIEW_DATABASE_READY=${readyBody?.database === 'ok' ? 'PASS' : 'FAIL'}`);

  const allowedOptions = await request(`${origin}${POLICY_PATH}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }, fetchImpl);
  trustedCors = allowedOptions.status === 204 && allowedOptions.headers.get('access-control-allow-origin') === origin;
  log(`TRUSTED_PREVIEW_CORS_HTTP=${allowedOptions.status}`);
  log(`TRUSTED_PREVIEW_CORS=${trustedCors ? 'PASS' : 'FAIL'}`);

  const deniedOptions = await request(`${origin}${POLICY_PATH}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.invalid',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }, fetchImpl);
  deniedCors = deniedOptions.status === 403 && !deniedOptions.headers.get('access-control-allow-origin');
  log(`UNTRUSTED_CORS_HTTP=${deniedOptions.status}`);
  log(`UNTRUSTED_CORS=${deniedCors ? 'PASS' : 'FAIL'}`);

  const policyResponse = await request(`${origin}${POLICY_PATH}`, { headers: { Accept: 'application/json' } }, fetchImpl);
  const policyBody = await safeJson(policyResponse);
  if (policyResponse.status === 200) {
    const summary = summarizePolicyBody(policyBody);
    companyLoaded = summary.companyLoaded ? 'YES' : 'NO';
    siteCount = summary.sites === null ? 'UNKNOWN' : String(summary.sites);
    shiftTypeCount = summary.shiftTypes === null ? 'UNKNOWN' : String(summary.shiftTypes);
    policyGetResult = `HTTP_200_UNAUTHENTICATED; COMPANY_POLICY_${companyLoaded}; SITES_${siteCount}; SHIFT_TYPES_${shiftTypeCount}`;
    policyFailure = !summary.companyLoaded || summary.sites === null || summary.shiftTypes === null;
  } else if (policyResponse.status === 401 || policyResponse.status === 403) {
    policyGetResult = `HTTP_${policyResponse.status}_AUTH_REQUIRED; CODE_${safeCode(policyBody)}`;
  } else {
    policyGetResult = `HTTP_${policyResponse.status}; CODE_${safeCode(policyBody)}`;
    policyFailure = true;
  }
  log(`TIME_POLICY_GET_HTTP=${policyResponse.status}`);
  log(`TIME_POLICY_GET_RESULT=${policyGetResult}`);
  log(`COMPANY_POLICY_LOADED=${companyLoaded}`);
  log(`SITE_COUNT=${siteCount}`);
  log(`SHIFT_TYPE_COUNT=${shiftTypeCount}`);
  log('RAW_RESPONSE_BODY_EMITTED=false');

  const runtimeChecks = healthy && ready && trustedCors && deniedCors ? 'PASS' : 'FAIL';
  const outputs = [
    `runtime_checks=${runtimeChecks}`,
    `policy_get_result=${policyGetResult}`,
    `company_policy_loaded=${companyLoaded}`,
    `site_count=${siteCount}`,
    `shift_type_count=${shiftTypeCount}`,
  ];
  if (outputPath) require('node:fs').appendFileSync(outputPath, `${outputs.join('\n')}\n`, 'utf8');
  return { healthy, ready, trustedCors, deniedCors, policyGetResult, companyLoaded, siteCount, shiftTypeCount, runtimeChecks, failed: runtimeChecks !== 'PASS' || policyFailure };
}

async function main() {
  try {
    const result = await verifyReadonlyRuntime();
    return result.failed ? 1 : 0;
  } catch {
    console.error('Preview read-only runtime verification failed closed; raw response body was not emitted');
    if (process.env.GITHUB_OUTPUT) {
      require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, [
        'runtime_checks=FAIL',
        'policy_get_result=NETWORK_OR_RESPONSE_ERROR',
        'company_policy_loaded=UNKNOWN',
        'site_count=UNKNOWN',
        'shift_type_count=UNKNOWN',
      ].join('\n') + '\n', 'utf8');
    }
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { EXPECTED_HOST, POLICY_PATH, approvedPreviewOrigin, safeCode, summarizePolicyBody, verifyReadonlyRuntime };
