'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loginPreflightRequestOptions } = require('../e2e/uat-v3/auth');

test('UAT login preflight POST uses only the Vercel bypass header without requesting a cookie redirect', () => {
  const baseURL = 'https://sms-v3-staging-preview-123.vercel.app';
  const options = loginPreflightRequestOptions(
    { VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass-secret' },
    baseURL
  );

  assert.equal(options.baseURL, baseURL);
  assert.deepEqual(options.extraHTTPHeaders, {
    'x-vercel-protection-bypass': 'synthetic-bypass-secret'
  });
  assert.equal(Object.hasOwn(options.extraHTTPHeaders, 'x-vercel-set-bypass-cookie'), false);
});
