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

test('S3 is fail-closed outside test and only selects injected wrapper in test', () => {
  assert.throws(() => selectStorage({ environment: { STORAGE_PROVIDER: 's3', NODE_ENV: 'production' }, supabaseFactory: () => ({}) }), /not wired/);
  const expected = Object.freeze({ provider: 's3-wrapper' });
  const selected = selectStorage({ environment: { STORAGE_PROVIDER: 's3', NODE_ENV: 'test' }, supabaseFactory: () => ({}), s3Factory: () => expected });
  assert.equal(selected, expected);
});

test('invalid provider fails closed without selecting either factory', () => {
  let calls = 0;
  assert.throws(() => selectStorage({ environment: { STORAGE_PROVIDER: 'invalid' }, supabaseFactory: () => { calls += 1; return {}; }, s3Factory: () => { calls += 1; return {}; } }), /provider/);
  assert.equal(calls, 0);
});
