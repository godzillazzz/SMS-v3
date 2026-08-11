const test = require('node:test');
const assert = require('node:assert/strict');
const { assertExpectedStatus, assertReadiness, extractViteAssets } = require('../e2e/helpers/technical-smoke');

const validHtml = '<html><head><link href="/assets/index-a.css"><script src="/assets/index-a.js"></script></head></html>';

test('technical smoke accepts a valid Vite document and ready database contract', () => {
  assert.deepEqual(extractViteAssets(validHtml), ['/assets/index-a.css', '/assets/index-a.js']);
  assert.doesNotThrow(() => assertReadiness({ status: 'ready', database: 'ok' }));
  assert.doesNotThrow(() => assertExpectedStatus(401, 401, 'AUTH_FAILED'));
});

test('technical smoke rejects synthetic HTTP, readiness, artifact, and authorization failures', () => {
  assert.throws(() => assertExpectedStatus(500, 200, 'ROOT_HTTP_FAILED'), { code: 'ROOT_HTTP_FAILED' });
  assert.throws(() => assertReadiness({ status: 'pending', database: 'ok' }), { code: 'READINESS_STATUS_INVALID' });
  assert.throws(() => assertReadiness({ status: 'ready', database: 'degraded' }), { code: 'READINESS_DATABASE_NOT_OK' });
  assert.throws(() => extractViteAssets('<html><script src="/_next/app.js"></script></html>'), { code: 'UNEXPECTED_NEXT_ARTIFACT' });
  assert.throws(() => extractViteAssets('<html><script src="/assets/index-a.js"></script></html>'), { code: 'VITE_ASSETS_MISSING' });
  assert.throws(() => assertExpectedStatus(200, 401, 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED'), { code: 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED' });
});
