'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
  CANONICAL_HOST,
  TARGET_CLASSES,
  classifyUatTarget
} = require('../e2e/helpers/uat-target-contract');
const {
  normalizeAllowedApiResponseRule,
  startPageMonitor
} = require('../e2e/helpers/uat-observe');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

class FakePage extends EventEmitter {}

function fakeResponse(url, status = 403, method = 'GET') {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ method: () => method })
  };
}

test('V3.2 target classification distinguishes exact canonical from approved immutable deployment', () => {
  assert.equal(CANONICAL_HOST, 'sms-v3-staging-ten.vercel.app');
  assert.deepEqual(classifyUatTarget('https://sms-v3-staging-ten.vercel.app'), {
    targetClass: TARGET_CLASSES.CANONICAL,
    host: 'sms-v3-staging-ten.vercel.app',
    url: 'https://sms-v3-staging-ten.vercel.app'
  });
  assert.deepEqual(classifyUatTarget('https://sms-v3-staging-cjbcsf5qw-godzillazz.vercel.app'), {
    targetClass: TARGET_CLASSES.IMMUTABLE,
    host: 'sms-v3-staging-cjbcsf5qw-godzillazz.vercel.app',
    url: 'https://sms-v3-staging-cjbcsf5qw-godzillazz.vercel.app'
  });
});

test('V3.2 arbitrary Vercel host is never classified as canonical or immutable', () => {
  for (const value of [
    'https://example.vercel.app',
    'https://sms-v3.vercel.app',
    'https://sms-v3-staging-ten.evil.example',
    'https://other-project-abc-godzillazz.vercel.app'
  ]) {
    assert.throws(() => classifyUatTarget(value), { code: 'UAT_TARGET_HOST_NOT_APPROVED' });
  }
});

test('V3.2 immutable role identity uses cached preflight session while canonical capability uses real UI login', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const identityBlock = auth.slice(auth.indexOf('async function authenticateRoleIdentity'), auth.indexOf('async function getAuditEventsStatus'));
  assert.match(identityBlock, /targetClass === 'CANONICAL'\) return loginViaUi\(page, role\)/);
  assert.match(identityBlock, /targetClass === 'IMMUTABLE'\) return bootstrapAs\(page, role\)/);
  const bootstrapBlock = auth.slice(auth.indexOf('async function bootstrapAs'), auth.indexOf('async function loginAs'));
  assert.match(bootstrapBlock, /identityMode: 'CACHED_PREFLIGHT_SESSION'/);
  assert.match(bootstrapBlock, /dashboardSuppressor/);
  assert.doesNotMatch(bootstrapBlock, /performAndWaitForHeavyRequest/);
});

test('V3.2 real browser login is canonical-only, real POST login, and never spoofs Origin', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const block = auth.slice(auth.indexOf('async function loginViaUi'), auth.indexOf('async function authenticateRoleIdentity'));
  assert.match(block, /targetClass !== 'CANONICAL'/);
  assert.match(block, /UAT_REAL_LOGIN_ORIGIN_NOT_CANONICAL/);
  assert.match(block, /pathname === '\/api\/v1\/auth\/login' && request\.method\(\) === 'POST'/);
  assert.match(block, /getByRole\('button', \{ name: 'เข้าสู่ระบบ', exact: true \}\)\.click\(\)/);
  assert.match(block, /scrubLoginCredentialDom\(page\)/);
  assert.doesNotMatch(block, /installCachedRefreshRoute/);
  assert.doesNotMatch(block, /route\.fulfill/);
  assert.doesNotMatch(block, /\bOrigin\b|setExtraHTTPHeaders|setHTTPHeaders/i);
});

test('V3.2 harness does not modify application CORS or Production environment contract', () => {
  const changed = [
    read('e2e/helpers/uat-auth.js'),
    read('e2e/helpers/uat-target-contract.js'),
    read('e2e/smoke/authenticated-v3.spec.js'),
    read('playwright.config.js')
  ].join('\n');
  assert.doesNotMatch(changed, /CORS_ORIGIN\s*=|corsOrigins\s*=|process\.env\.CORS_ORIGIN/);
  assert.doesNotMatch(changed, /DATABASE_URL|DIRECT_URL|UAT_DISPOSABLE_EMPLOYEE_ENABLED/);
});

test('V3.2 login-role test reports target-aware identity mode instead of claiming immutable real UI login', () => {
  const source = read('e2e/smoke/authenticated-v3.spec.js');
  const block = source.slice(source.indexOf('login and role identity'), source.indexOf('read-only API authorization and scope'));
  assert.match(block, /authenticateRoleIdentity\(page, role\)/);
  assert.match(block, /v31-auth-contract\.json/);
  assert.match(block, /v32-page-monitor\.json/);
  assert.doesNotMatch(block, /loginViaUi\(page, role\)/);
});

test('V3.2 safe monitor emits only path method status classification and strips query material', () => {
  const page = new FakePage();
  const monitor = startPageMonitor(page);
  page.emit('response', fakeResponse('https://candidate.test/api/v1/leave-requests?Authorization=Bearer-secret&token=secret', 403, 'GET'));
  const evidence = monitor.safeEvidence();
  assert.deepEqual(evidence.secondaryApiFailures, [{
    path: '/api/v1/leave-requests',
    method: 'GET',
    status: 403,
    classification: 'UNEXPECTED_API_RESPONSE'
  }]);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('Bearer-secret'), false);
  assert.equal(serialized.includes('token=secret'), false);
  assert.equal(serialized.includes('cookie'), false);
  assert.equal(serialized.includes('body'), false);
  assert.equal(serialized.includes('requestId'), false);
});

test('V3.2 Viewer denial allowance requires exact path method and status', () => {
  assert.deepEqual(
    normalizeAllowedApiResponseRule({ path: '/api/v1/leave-requests', method: 'GET', status: 403 }),
    { path: '/api/v1/leave-requests', method: 'GET', status: 403 }
  );
  assert.throws(() => normalizeAllowedApiResponseRule({ path: '/api/v1/leave-requests', status: 403 }), /UAT_ALLOWED_API_RULE_METHOD_REQUIRED/);
  assert.throws(() => normalizeAllowedApiResponseRule({ path: '/api/v1/leave-requests', method: 'GET' }), /UAT_ALLOWED_API_RULE_STATUS_REQUIRED/);
  assert.throws(() => normalizeAllowedApiResponseRule({ path: '/api/v1/*', method: 'GET', status: 403 }), /UAT_ALLOWED_API_RULE_PATH_INVALID/);
  assert.throws(() => normalizeAllowedApiResponseRule({ path: /\/api\/v1\/.*/, method: 'GET', status: 403 }), /UAT_ALLOWED_API_RULE_PATH_INVALID/);
});

test('V3.2 exact allowed response suppresses only that precise response', () => {
  const page = new FakePage();
  const monitor = startPageMonitor(page, { allowedApiResponses: [{ path: '/api/v1/leave-requests', method: 'GET', status: 403 }] });
  page.emit('response', fakeResponse('https://candidate.test/api/v1/leave-requests?page=1', 403, 'GET'));
  page.emit('response', fakeResponse('https://candidate.test/api/v1/leave-requests?page=1', 401, 'GET'));
  page.emit('response', fakeResponse('https://candidate.test/api/v1/leave-requests?page=1', 403, 'POST'));
  assert.deepEqual(monitor.safeUnexpectedApiResponses(), [
    { path: '/api/v1/leave-requests', method: 'GET', status: 401, classification: 'UNEXPECTED_API_RESPONSE' },
    { path: '/api/v1/leave-requests', method: 'POST', status: 403, classification: 'UNEXPECTED_API_RESPONSE' }
  ]);
});

test('V3.2 Viewer license denial is a narrow known Production background denial', () => {
  const source = read('e2e/smoke/authenticated-v3.spec.js');
  const matrix = read('e2e/helpers/uat-v3-role-matrix.js');
  const routes = read('src/routes/operations.routes.js');
  assert.match(source, /VIEWER_LICENSE_BACKGROUND_DENIAL = Object\.freeze\(\{ path: '\/api\/v1\/licenses', method: 'GET', status: 403 \}\)/);
  assert.match(source, /viewerBackgroundAllowances = \(role\) => role === 'VIEWER'/);
  assert.match(source, /item\.id === 'dashboard' \? viewerBackgroundAllowances\(role\) : \[\]/);
  assert.doesNotMatch(source, /status:\s*403[^\n]*path:\s*['"]\/api\/v1\/\*|allow.*403.*global/i);
  const viewer = matrix.slice(matrix.indexOf('VIEWER: ['), matrix.indexOf('const navigationCatalog'));
  assert.match(viewer, /\['License', '\/api\/v1\/licenses\?page=1&pageSize=20', 403/);
  assert.match(routes, /router\.get\('\/licenses', authorize\('ADMIN', 'MANAGER'\)/);
});

test('V3.2 reporter persists only sanitized auth and secondary-response observability', () => {
  const reporter = read('e2e/uat-reporter.js');
  assert.match(reporter, /identityMode/);
  assert.match(reporter, /targetClass/);
  assert.match(reporter, /v32-page-monitor\.json/);
  assert.match(reporter, /secondaryApiFailures/);
  assert.match(reporter, /pageErrorCount/);
  assert.doesNotMatch(reporter, /responseBody|requestHeaders|Authorization.*pageMonitor|requestId.*pageMonitor/);
});

test('V3.2 final Harness restores full Playwright discovery with no diagnostic filter', () => {
  const config = read('playwright.config.js');
  assert.doesNotMatch(config, /grep:\s*diagnosticGrep/);
  assert.doesNotMatch(config, /diagnosticGrep|targetClass === 'CANONICAL'|classifyUatTarget\(baseURL\)/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*authenticatedMode \? 0/);
});

test('V3.2 retains suppressor cleanup, duplicate Dashboard removal, no semaphore, no normal global barrier, and disabled disposable fixture', () => {
  const auth = read('e2e/helpers/uat-auth.js');
  const source = read('e2e/smoke/authenticated-v3.spec.js');
  const heavy = read('e2e/helpers/uat-heavy-read-v3.js');
  const disposable = read('e2e/smoke/disposable-employee.spec.js');
  assert.match(auth, /await suppressor\.remove\(\)/);
  assert.match(auth, /dashboardSuppressorActiveAtHelperReturn/);
  const protectedBlock = source.slice(source.indexOf("if (item.id === 'dashboard')"), source.indexOf('} else {', source.indexOf("if (item.id === 'dashboard')")));
  assert.doesNotMatch(protectedBlock, /navigateTo\(page, 'dashboard'\)/);
  assert.doesNotMatch(heavy, /semaphore|permit|quiet.?window/i);
  assert.match(heavy, /assertNormalCompletion/);
  assert.match(disposable, /test\.skip\(!destructiveFixtureEnabled\(\)/);
});
