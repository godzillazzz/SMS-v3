const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertResponsiveLayoutMetrics,
  dashboardWarningVisible,
  sourceRegressionContracts
} = require('../e2e/helpers/regression-contracts');
const {
  assertExpectedStatus,
  assertReadiness,
  classifyOriginBehavior,
  extractViteAssets
} = require('../e2e/helpers/technical-smoke');

test('UAT V2 source contracts cover the documented responsive and warning incidents', () => {
  assert.deepEqual(sourceRegressionContracts(), {
    dataQuality: true,
    audit: true,
    dashboardWarning: true,
    executiveReport: true
  });
});

test('UAT V2 Dashboard warning contract distinguishes healthy and partial payloads', () => {
  assert.equal(dashboardWarningVisible({ error: undefined, partialErrors: [] }), false);
  assert.equal(dashboardWarningVisible({ error: undefined, partialErrors: ['licenseOverview'] }), true);
  assert.equal(dashboardWarningVisible({ error: 'request failed', partialErrors: ['licenseOverview'] }), false);
});

test('UAT V2 negative layout contracts catch collapse, wrapping, leaks, and giant rows', () => {
  assert.throws(() => assertResponsiveLayoutMetrics({
    renderer: 'desktop',
    desktopVisible: true,
    mobileVisible: true,
    buttonWidth: 148,
    buttonClientWidth: 148,
    buttonScrollWidth: 148,
    rowHeight: 60,
    pageOverflow: false
  }), { code: 'RENDERER_MODE_LEAK' });
  assert.throws(() => assertResponsiveLayoutMetrics({
    renderer: 'desktop',
    desktopVisible: true,
    mobileVisible: false,
    buttonWidth: 1,
    buttonClientWidth: 1,
    buttonScrollWidth: 1,
    rowHeight: 60,
    pageOverflow: false
  }), { code: 'ACTION_BUTTON_COLLAPSED' });
  assert.throws(() => assertResponsiveLayoutMetrics({
    renderer: 'desktop',
    desktopVisible: true,
    mobileVisible: false,
    buttonWidth: 148,
    buttonClientWidth: 148,
    buttonScrollWidth: 150,
    rowHeight: 60,
    pageOverflow: false
  }), { code: 'ACTION_BUTTON_WRAP' });
  assert.throws(() => assertResponsiveLayoutMetrics({
    renderer: 'desktop',
    desktopVisible: true,
    mobileVisible: false,
    buttonWidth: 148,
    buttonClientWidth: 148,
    buttonScrollWidth: 148,
    rowHeight: 401,
    pageOverflow: false
  }), { code: 'ROW_HEIGHT_ABNORMAL' });
  assert.throws(() => assertResponsiveLayoutMetrics({
    renderer: 'desktop',
    desktopVisible: true,
    mobileVisible: false,
    buttonWidth: 148,
    buttonClientWidth: 148,
    buttonScrollWidth: 148,
    rowHeight: 60,
    pageOverflow: true
  }), { code: 'PAGE_HORIZONTAL_OVERFLOW' });
});

test('UAT V2 negative technical contracts classify readiness, artifact, auth, and CORS failures', () => {
  assert.throws(() => assertReadiness({ status: 'pending', database: 'ok' }), { code: 'READINESS_STATUS_INVALID' });
  assert.throws(() => assertReadiness({ status: 'ready', database: 'degraded' }), { code: 'READINESS_DATABASE_NOT_OK' });
  assert.throws(() => extractViteAssets('<html><script src="/_next/app.js"></script></html>'), { code: 'UNEXPECTED_NEXT_ARTIFACT' });
  assert.throws(() => extractViteAssets('<html><script src="/assets/index-a.js"></script></html>'), { code: 'VITE_ASSETS_MISSING' });
  assert.throws(() => assertExpectedStatus(200, 401, 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED'), { code: 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED' });
  assert.equal(classifyOriginBehavior({
    targetUrl: 'https://sms-v3-staging-ten.vercel.app',
    status: 401,
    body: 'Unauthorized'
  }), 'CANONICAL_COMPATIBLE');
  assert.equal(classifyOriginBehavior({
    targetUrl: 'https://sms-v3-staging-candidate.vercel.app',
    status: 403,
    body: 'Origin not allowed'
  }), 'CORS_ORIGIN_RESTRICTED');
});
