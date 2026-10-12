'use strict';

const crypto = require('node:crypto');
const { parseAndNormalize } = require('../utils/database-target-identity');
const { verifyPreviewDatabaseTarget } = require('./runtime-database-target-guard.service');

const EXPECTED = Object.freeze({
  contract: 'sms-v3-preview-isolation/v2',
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  repositoryOwner: 'godzillazzz',
  repositorySlug: 'sms-v3',
  integrationRef: 'fix/serverless-database-reliability',
  previewDatabaseRef: 'ezxanpfagitckpfsnflp',
  previewStorageRef: 'ezxanpfagitckpfsnflp',
  licenseBucket: 'license-documents-g05-preview',
  routePath: '/api/v1/ops/preview-isolation-attestation',
  noncePattern: /^[a-f0-9]{32}$/i,
  shaPattern: /^[a-f0-9]{40}$/i,
  deploymentPattern: /^dpl_[A-Za-z0-9]+$/
});

const READ_ONLY_DATABASE_SQL =
  'SELECT current_database() AS database_name, current_setting(\'transaction_read_only\') AS transaction_read_only';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function ensure(condition, code) {
  if (!condition) fail(code);
}

function constantTimeTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function header(req, name) {
  const value = req?.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}

function queryValue(req, name) {
  const value = req?.query?.[name];
  ensure(typeof value === 'string' && value.length > 0, 'PROBE_CHALLENGE_INVALID');
  return value;
}

function canonicalChallenge({ host, deploymentId, sha, nonce, issuedAt }) {
  return [
    'GET',
    EXPECTED.routePath,
    host.toLowerCase(),
    deploymentId,
    sha.toLowerCase(),
    nonce.toLowerCase(),
    String(issuedAt)
  ].join('\n');
}

function signChallenge(secret, fields) {
  return 'v1=' + crypto.createHmac('sha256', secret)
    .update(canonicalChallenge(fields))
    .digest('hex');
}

function authorizeProbeRequest(req, environment = process.env, now = Date.now()) {
  ensure(req?.method === 'GET', 'PROBE_METHOD_REJECTED');
  ensure(environment.VERCEL_ENV === 'preview', 'PREVIEW_RUNTIME_REQUIRED');
  ensure(environment.VERCEL_PROJECT_ID === EXPECTED.projectId, 'VERCEL_PROJECT_ID_MISMATCH');
  ensure(environment.VERCEL_GIT_REPO_OWNER?.toLowerCase() === EXPECTED.repositoryOwner
    && environment.VERCEL_GIT_REPO_SLUG?.toLowerCase() === EXPECTED.repositorySlug,
  'VERCEL_REPOSITORY_MISMATCH');
  ensure(environment.VERCEL_GIT_COMMIT_REF === EXPECTED.integrationRef, 'INTEGRATION_REF_REQUIRED');

  const nonce = queryValue(req, 'nonce').toLowerCase();
  const sha = queryValue(req, 'sha').toLowerCase();
  const deploymentId = queryValue(req, 'deploymentId');
  const issuedAtText = queryValue(req, 'issuedAt');
  ensure(EXPECTED.noncePattern.test(nonce)
    && EXPECTED.shaPattern.test(sha)
    && EXPECTED.deploymentPattern.test(deploymentId)
    && /^\d{10,13}$/.test(issuedAtText),
  'PROBE_CHALLENGE_INVALID');

  const issuedAt = Number(issuedAtText);
  const issuedAtMs = issuedAtText.length === 10 ? issuedAt * 1000 : issuedAt;
  ensure(Number.isSafeInteger(issuedAt) && Math.abs(now - issuedAtMs) <= 120000,
    'PROBE_CHALLENGE_EXPIRED');
  ensure(environment.VERCEL_DEPLOYMENT_ID === deploymentId
    && environment.VERCEL_GIT_COMMIT_SHA?.toLowerCase() === sha,
  'RUNTIME_DEPLOYMENT_IDENTITY_MISMATCH');

  const runtimeHost = String(environment.VERCEL_URL || '').toLowerCase();
  const requestHost = String(req?.headers?.host || '').toLowerCase();
  ensure(runtimeHost && requestHost && requestHost === runtimeHost, 'RUNTIME_HOST_MISMATCH');

  const secret = environment.RUNTIME_ISOLATION_PROBE_HMAC_SECRET;
  ensure(typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32, 'PROBE_AUTH_NOT_CONFIGURED');
  const providedSignature = header(req, 'x-smsv3-probe-signature');
  const expectedSignature = signChallenge(secret, {
    host: runtimeHost, deploymentId, sha, nonce, issuedAt
  });
  ensure(constantTimeTextEqual(providedSignature, expectedSignature), 'PROBE_AUTH_REQUIRED');

  return { nonce, sha, deploymentId, issuedAt, host: runtimeHost };
}

function parseStorageTarget(environment) {
  const rawUrl = environment.SUPABASE_URL;
  const key = environment.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = environment.LICENSE_DOCUMENTS_BUCKET;
  ensure(typeof rawUrl === 'string' && rawUrl.length > 0, 'STORAGE_CREDENTIALS_MISSING');
  ensure(typeof key === 'string' && key.length > 0, 'STORAGE_CREDENTIALS_MISSING');
  ensure(bucket === EXPECTED.licenseBucket, 'STORAGE_BUCKET_MISMATCH');

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail('STORAGE_ENDPOINT_INVALID');
  }
  ensure(url.protocol === 'https:'
    && url.hostname === EXPECTED.previewStorageRef + '.supabase.co'
    && (url.pathname === '' || url.pathname === '/')
    && !url.username && !url.password && !url.search && !url.hash,
  'STORAGE_ENDPOINT_MISMATCH');

  let credentialKind = null;
  if (key.startsWith('sb_secret_')) {
    credentialKind = 'supabase_secret_key';
  } else {
    const parts = key.split('.');
    ensure(parts.length === 3, 'STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID');
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      fail('STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID');
    }
    ensure(claims?.role === 'service_role', 'STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID');
    // An unverified JWT claim is only a fail-closed input filter, never identity evidence.
    if (claims.ref !== undefined) {
      ensure(claims.ref === EXPECTED.previewStorageRef, 'STORAGE_CREDENTIAL_CLAIM_MISMATCH');
    }
    credentialKind = 'legacy_service_role_jwt';
  }
  return { url: url.origin, key, bucket, credentialKind };
}

function storageMetadataHeaders(credentialKind, key) {
  const headers = { apikey: key, accept: 'application/json' };
  if (credentialKind === 'legacy_service_role_jwt') {
    headers.authorization = 'Bearer ' + key;
  } else {
    ensure(credentialKind === 'supabase_secret_key', 'STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID');
  }
  return headers;
}

async function readPrivateBucket({ url, key, bucket, credentialKind, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(
      url + '/storage/v1/bucket/' + encodeURIComponent(bucket),
      {
        method: 'GET',
        redirect: 'manual',
        headers: storageMetadataHeaders(credentialKind, key),
        signal: AbortSignal.timeout(8000)
      }
    );
  } catch {
    fail('STORAGE_PROVIDER_UNAVAILABLE');
  }
  ensure(response && !(response.status >= 300 && response.status < 400),
    'STORAGE_REDIRECT_REJECTED');
  ensure(response.status === 200 && response.ok === true, 'STORAGE_CREDENTIAL_REJECTED');

  let metadata;
  try {
    metadata = await response.json();
  } catch {
    fail('STORAGE_METADATA_INVALID');
  }
  ensure(metadata?.id === bucket && metadata?.name === bucket && metadata?.public === false,
    'STORAGE_BUCKET_NOT_PRIVATE');
  return {
    configuredEndpointProjectRef: EXPECTED.previewStorageRef,
    bucket,
    privateBucketMetadataReadSucceeded: true,
    bucketIsPrivate: true
  };
}

async function readDatabase({ environment, target, prisma }) {
  let guard;
  try {
    guard = verifyPreviewDatabaseTarget(environment);
  } catch {
    fail('DATABASE_APPROVED_TARGET_MISMATCH');
  }
  ensure(guard?.required === true && guard?.matched === true, 'DATABASE_PREVIEW_GUARD_REQUIRED');
  ensure(prisma && typeof prisma.$transaction === 'function', 'DATABASE_CLIENT_UNAVAILABLE');

  let rows;
  try {
    rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe(READ_ONLY_DATABASE_SQL);
    }, { maxWait: 3000, timeout: 8000 });
  } catch {
    fail('DATABASE_READ_ONLY_CHECK_FAILED');
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  ensure(row
    && row.database_name === target.normalized.database
    && String(row.transaction_read_only).toLowerCase() === 'on',
  'DATABASE_READ_ONLY_CHECK_MISMATCH');
  return {
    configuredDatabaseProjectRef: target.databaseUrl.projectRef,
    configuredDirectProjectRef: target.directUrl.projectRef,
    configuredDatabaseName: target.normalized.database,
    observedDatabaseName: row.database_name,
    targetGuardMatched: true,
    databaseReadOnlyQuerySucceeded: true
  };
}

async function createRuntimeIsolationReceipt({
  req,
  environment = process.env,
  prisma,
  fetchImpl = globalThis.fetch,
  now = Date.now()
}) {
  const challenge = authorizeProbeRequest(req, environment, now);

  let target;
  try {
    target = parseAndNormalize(environment);
  } catch {
    fail('DATABASE_TARGET_INVALID');
  }
  ensure(target.databaseUrl.provider === 'supabase'
    && target.directUrl.provider === 'supabase'
    && target.databaseUrl.projectRef === EXPECTED.previewDatabaseRef
    && target.directUrl.projectRef === EXPECTED.previewDatabaseRef,
  'DATABASE_TARGET_MISMATCH');

  // Validate the Storage destination before opening a database connection or sending credentials.
  const storage = parseStorageTarget(environment);
  const database = await readDatabase({ environment, target, prisma });
  const storageReceipt = await readPrivateBucket({ ...storage, fetchImpl });

  return {
    contract: EXPECTED.contract,
    nonce: challenge.nonce,
    deploymentId: challenge.deploymentId,
    applicationSha: challenge.sha,
    vercelProjectId: environment.VERCEL_PROJECT_ID,
    gitCommitRef: environment.VERCEL_GIT_COMMIT_REF,
    database,
    storage: storageReceipt
  };
}

module.exports = {
  EXPECTED,
  READ_ONLY_DATABASE_SQL,
  canonicalChallenge,
  signChallenge,
  authorizeProbeRequest,
  parseStorageTarget,
  createRuntimeIsolationReceipt
};
