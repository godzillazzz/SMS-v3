const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertExpectedStatus,
  assertReadiness,
  extractViteAssets,
  getTraceMode,
  isVercelProtectionPage,
  shouldUseTrustedSource,
  trustedRequestOptions,
  trustedSourceHeaders
} = require('../e2e/helpers/technical-smoke');
const { sanitizeDiagnostic } = require('../e2e/helpers/uat-observe');

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

test('trusted OIDC header is absent without a token and present with a token', () => {
  const candidate = 'https://sms-v3-staging-candidate.vercel.app';
  assert.deepEqual(trustedSourceHeaders({}), {});
  assert.deepEqual(
    trustedRequestOptions({ headers: { 'x-test-header': 'preserved' } }, { VERCEL_TRUSTED_OIDC_TOKEN: 'synthetic-oidc-token' }, candidate),
    {
      headers: {
        'x-test-header': 'preserved',
        'x-vercel-trusted-oidc-idp-token': 'synthetic-oidc-token'
      }
    }
  );
});

test('Vercel protection HTML is classified before Next.js artifact detection', () => {
  const protectionHtml = '<html><head><title>Login – Vercel</title><script src="/_next/protection.js"></script></head></html>';
  assert.equal(isVercelProtectionPage(protectionHtml), true);
  assert.throws(() => extractViteAssets(protectionHtml), { code: 'PROTECTED_DEPLOYMENT_UNVERIFIED' });
});

test('genuine unexpected Next.js HTML remains rejected', () => {
  assert.throws(() => extractViteAssets('<html><head><title>SMS-v3</title><script src="/_next/app.js"></script></head></html>'), { code: 'UNEXPECTED_NEXT_ARTIFACT' });
});

test('public Vite smoke remains unchanged when OIDC is absent', () => {
  const html = '<html><head><link href="/assets/index-a.css"><script src="/assets/index-a.js"></script></head></html>';
  assert.deepEqual(trustedSourceHeaders({}), {});
  assert.deepEqual(extractViteAssets(html), ['/assets/index-a.css', '/assets/index-a.js']);
});

test('public canonical smoke never sends the trusted OIDC header', () => {
  const canonical = 'https://sms-v3-staging-ten.vercel.app';
  assert.equal(shouldUseTrustedSource(canonical), false);
  assert.deepEqual(trustedSourceHeaders({ VERCEL_TRUSTED_OIDC_TOKEN: 'synthetic-oidc-token' }, canonical), {});
  assert.equal(getTraceMode({ VERCEL_TRUSTED_OIDC_TOKEN: 'synthetic-oidc-token' }, canonical), 'retain-on-failure');
});

test('OIDC token is redacted from diagnostics and protected traces are disabled', () => {
  const token = 'synthetic-oidc-token';
  const candidate = 'https://sms-v3-staging-candidate.vercel.app';
  assert.doesNotMatch(sanitizeDiagnostic(`request header ${token}`, [token]), new RegExp(token));
  assert.equal(getTraceMode({ VERCEL_TRUSTED_OIDC_TOKEN: token }, candidate), 'off');
  assert.equal(getTraceMode({}), 'retain-on-failure');
});
