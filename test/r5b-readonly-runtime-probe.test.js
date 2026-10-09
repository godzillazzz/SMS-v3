'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TARGETS, TRUSTED_ORIGIN, UNTRUSTED_ORIGIN, exactStatus, req, proveTarget } =
  require('../scripts/ci/r5b-readonly-runtime-probe.cjs');

test('R5-B read-only probe is restricted to exact public Production and frozen Preview targets', async () => {
  assert.deepEqual(TARGETS, [
    ['PRODUCTION', 'https://sms-v3-staging-ten.vercel.app'],
    ['PREVIEW', 'https://sms-v3-staging-ntizvmjdo-godzillazz.vercel.app'],
  ]);
  await assert.rejects(req('https://example.invalid','/api/v1/health'), /R5B_UNAPPROVED_TARGET/);
  await assert.rejects(req(TARGETS[0][1],'/api/v1/auth/login'), /R5B_UNAPPROVED_PROBE_PATH/);
  await assert.rejects(req(TARGETS[0][1],'https://other.invalid/api/v1/health'), /R5B_UNAPPROVED_PROBE_PATH/);
  await assert.rejects(req(TARGETS[0][1],'/api/v1/ready', {method:'POST'}), /R5B_READONLY_METHOD_REQUIRED/);
  await assert.rejects(req(TARGETS[0][1],'/api/v1/ready', {method:'DELETE'}), /R5B_READONLY_METHOD_REQUIRED/);
  assert.throws(() => exactStatus(403,200,'BLOCKED'), /BLOCKED/);
});

test('R5-B probe only passes exact health, ready, trusted and untrusted CORS response contracts', async () => {
  const previous = global.fetch;
  const methods=[];
  global.fetch = async (url, options) => {
    methods.push(options.method);
    assert.equal(options.redirect,'error');
    assert.equal(options.signal.aborted,false);
    const pathname = new URL(url).pathname;
    const origin = options.headers?.Origin;
    if(options.method==='GET' && pathname==='/api/v1/health') {
      return {status:200,json:async()=>({status:'ok'})};
    }
    if(options.method==='GET' && pathname==='/api/v1/ready') {
      return {status:200,json:async()=>({status:'ready',database:'ok'})};
    }
    if(options.method==='OPTIONS' && origin===TRUSTED_ORIGIN) {
      return {status:204,headers:new Headers({
        'access-control-allow-origin':TRUSTED_ORIGIN,
        'access-control-allow-credentials':'true'
      })};
    }
    if(options.method==='OPTIONS' && origin===UNTRUSTED_ORIGIN) {
      return {status:403,headers:new Headers()};
    }
    throw Error('UNEXPECTED_TEST_REQUEST');
  };
  try {
    await proveTarget('TEST_ONLY',TARGETS[0][1]);
    assert.deepEqual(methods,['GET','GET','OPTIONS','OPTIONS']);
  } finally {
    global.fetch=previous;
  }
});
