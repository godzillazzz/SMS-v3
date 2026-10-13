'use strict';

/**
 * Read-only provider-side metadata inventory; NOT an isolation attestation.
 * This module never reads keys, DB credentials, Storage objects, or data rows.
 * It requires independently supplied credentials and is not connected to CI.
 */
const EXPECTED = Object.freeze({
  preview: Object.freeze({ ref: 'ezxanpfagitckpfsnflp', bucket: 'license-documents-g05-preview' }),
  production: Object.freeze({ ref: 'jkexwnlxnxbemwavsebv', bucket: 'sms-v3-license-documents' })
});
const RELEASE_HOLD = Object.freeze({
  databaseIsolation: 'UNVERIFIED',
  storageIsolation: 'UNVERIFIED',
  productionSeparation: 'UNVERIFIED',
  rlsSecurity: 'HOLD',
  r6bRelease: 'HOLD'
});
const BASE = 'https://api.supabase.com';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function ensure(ok, code) { if (!ok) fail(code); }
function nonempty(value) { return typeof value === 'string' && value.length >= 16; }

async function providerGet({ ref, suffix, credential, fetchImpl }) {
  // Endpoint and project refs are frozen constants, not untrusted user input.
  const url = BASE + '/v1/projects/' + ref + suffix;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: 'Bearer ' + credential, accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    fail('PROVIDER_READ_UNAVAILABLE');
  }
  ensure(response && response.status === 200 && typeof response.text === 'function',
    'PROVIDER_READ_UNAVAILABLE');
  let data;
  try {
    const text = await response.text();
    ensure(text.length <= 65536, 'PROVIDER_RESPONSE_TOO_LARGE');
    data = JSON.parse(text);
  } catch {
    fail('PROVIDER_RESPONSE_INVALID');
  }
  ensure(data && typeof data === 'object', 'PROVIDER_RESPONSE_INVALID');
  return data;
}

async function readScope(scope, credential, fetchImpl) {
  const expected = EXPECTED[scope];
  const project = await providerGet({ ref: expected.ref, suffix: '', credential, fetchImpl });
  ensure(project.id === expected.ref && typeof project.region === 'string'
    && /^[a-z0-9-]+$/.test(project.region), 'PROVIDER_PROJECT_IDENTITY_UNVERIFIED');

  const bucketResponse = await providerGet({
    ref: expected.ref, suffix: '/storage/buckets', credential, fetchImpl
  });
  // Management API response shape may be either a bare list or a buckets envelope.
  const buckets = Array.isArray(bucketResponse) ? bucketResponse : bucketResponse.buckets;
  ensure(Array.isArray(buckets), 'PROVIDER_BUCKET_SHAPE_UNVERIFIED');
  const matches = buckets.filter(b =>
    b && (b.id === expected.bucket || b.name === expected.bucket));
  ensure(matches.length === 1 && matches[0].public === false,
    'PROVIDER_PRIVATE_BUCKET_UNVERIFIED');
  return Object.freeze({
    projectRef: expected.ref,
    region: project.region,
    projectStatus: typeof project.status === 'string' ? project.status : 'UNKNOWN',
    expectedBucket: expected.bucket,
    bucketPrivate: true
  });
}

/**
 * Never return PASS. Provider project/bucket existence doesn't prove where
 * effective Vercel Prisma or Storage credentials are connected or issued.
 */
async function collectProviderMetadata({ previewCredential, productionCredential, fetchImpl = globalThis.fetch } = {}) {
  ensure(nonempty(previewCredential) && nonempty(productionCredential)
    && previewCredential !== productionCredential, 'DISTINCT_PROVIDER_SCOPES_REQUIRED');
  ensure(typeof fetchImpl === 'function', 'PROVIDER_FETCH_UNAVAILABLE');
  const preview = await readScope('preview', previewCredential, fetchImpl);
  const production = await readScope('production', productionCredential, fetchImpl);
  ensure(preview.projectRef !== production.projectRef, 'PROVIDER_SCOPE_COLLISION');
  return Object.freeze({
    contract: 'r6b-provider-metadata-readonly/v1',
    evidenceAuthority: 'PROVIDER_METADATA_ONLY',
    preview, production, ...RELEASE_HOLD
  });
}
module.exports = { EXPECTED, RELEASE_HOLD, collectProviderMetadata };
