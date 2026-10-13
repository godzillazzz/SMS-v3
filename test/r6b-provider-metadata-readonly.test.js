'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectProviderMetadata } = require('../scripts/ci/r6b-provider-metadata-readonly.cjs');

const refs = {
  ezxanpfagitckpfsnflp: 'license-documents-g05-preview',
  jkexwnlxnxbemwavsebv: 'sms-v3-license-documents'
};
function fakeFetch({ alteredRef = null, publicBucket = false, responseError = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).origin, 'https://api.supabase.com');
    assert.match(options.headers.authorization, /^Bearer /);
    if (responseError) throw Error('token-must-not-appear');
    const match = url.match(/^https:\/\/api\.supabase\.com\/v1\/projects\/([a-z0-9]+)(\/storage\/buckets)?$/);
    assert.ok(match, 'only fixed project management API routes');
    const [, ref, buckets] = match;
    const body = buckets
      ? { buckets: [{ id: refs[ref], name: refs[ref], public: publicBucket }] }
      : { id: alteredRef || ref, region: 'ap-northeast-1', status: 'ACTIVE_HEALTHY' };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, requests };
}

test('reads only known project metadata and never emits release PASS or secrets', async () => {
  const { fetchImpl, requests } = fakeFetch();
  const evidence = await collectProviderMetadata({
    previewCredential: 'preview-token-mock-not-real',
    productionCredential: 'production-token-mock-not-real',
    fetchImpl
  });
  assert.equal(requests.length, 4);
  assert.equal(evidence.preview.bucketPrivate, true);
  assert.equal(evidence.production.bucketPrivate, true);
  assert.equal(evidence.databaseIsolation, 'UNVERIFIED');
  assert.equal(evidence.storageIsolation, 'UNVERIFIED');
  assert.equal(evidence.productionSeparation, 'UNVERIFIED');
  assert.equal(evidence.rlsSecurity, 'HOLD');
  assert.equal(evidence.r6bRelease, 'HOLD');
  assert.doesNotMatch(JSON.stringify(evidence), /token-mock/);
});

test('rejects a public bucket or a project collision', async () => {
  await assert.rejects(collectProviderMetadata({
    previewCredential: 'preview-token-mock-not-real',
    productionCredential: 'production-token-mock-not-real',
    fetchImpl: fakeFetch({ publicBucket: true }).fetchImpl
  }), /PROVIDER_PRIVATE_BUCKET_UNVERIFIED/);
  await assert.rejects(collectProviderMetadata({
    previewCredential: 'preview-token-mock-not-real',
    productionCredential: 'production-token-mock-not-real',
    fetchImpl: fakeFetch({ alteredRef: 'incorrect-project' }).fetchImpl
  }), /PROVIDER_PROJECT_IDENTITY_UNVERIFIED/);
});

test('fails closed on missing or shared credentials without any request', async () => {
  const mock = fakeFetch();
  await assert.rejects(collectProviderMetadata({
    previewCredential: 'same-token-mock-not-real',
    productionCredential: 'same-token-mock-not-real',
    fetchImpl: mock.fetchImpl
  }), /DISTINCT_PROVIDER_SCOPES_REQUIRED/);
  assert.equal(mock.requests.length, 0);
});

test('does not reveal errors or provider responses containing credentials', async () => {
  await assert.rejects(collectProviderMetadata({
    previewCredential: 'preview-token-mock-not-real',
    productionCredential: 'production-token-mock-not-real',
    fetchImpl: fakeFetch({ responseError: true }).fetchImpl
  }), error => error.message === 'PROVIDER_READ_UNAVAILABLE');
});
