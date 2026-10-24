process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectStorage, providerName } = require('../src/services/storage-provider-factory');

test('provider selector defaults to the existing Supabase factory', () => {
  const expected = Object.freeze({ provider: 'supabase-existing' });
  assert.equal(providerName({}), 'supabase');
  assert.equal(selectStorage({ environment: {}, supabaseFactory: () => expected }), expected);
  assert.equal(selectStorage({ environment: { STORAGE_PROVIDER: 'supabase' }, supabaseFactory: () => expected }), expected);
});

test('S3 selects the injected provider factory in every explicitly configured environment', () => {
  const expected = Object.freeze({ provider: 's3-wrapper' });
  assert.equal(selectStorage({ environment: { STORAGE_PROVIDER: 's3', NODE_ENV: 'production' }, supabaseFactory: () => ({}), s3Factory: () => expected }), expected);
  assert.equal(selectStorage({ environment: { STORAGE_PROVIDER: 's3', NODE_ENV: 'test' }, supabaseFactory: () => ({}), s3Factory: () => expected }), expected);
});

test('invalid provider fails closed without selecting either factory', () => {
  let calls = 0;
  assert.throws(() => selectStorage({ environment: { STORAGE_PROVIDER: 'invalid' }, supabaseFactory: () => { calls += 1; return {}; }, s3Factory: () => { calls += 1; return {}; } }), /provider/);
  assert.equal(calls, 0);
});
