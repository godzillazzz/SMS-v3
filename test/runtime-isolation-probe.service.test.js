'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED,
  signChallenge,
  createRuntimeIsolationReceipt
} = require('../src/services/runtime-isolation-probe.service');
const { parseAndNormalize } = require('../src/utils/database-target-identity');

const APP_SHA = 'a'.repeat(40);
const DEPLOYMENT_ID = 'dpl_PreviewRuntimeFixture123';
const NOW = 1760000000000;
const NONCE = 'c'.repeat(32);
const HMAC_FIXTURE = 'TEST_ONLY_HMAC_KEY_MATERIAL_0123456789';

function token(ref = EXPECTED.previewStorageRef, role = 'service_role') {
  const claims = Buffer.from(JSON.stringify({ ref, role })).toString('base64url');
  return 'header.' + claims + '.signature';
}

function environment(overrides = {}) {
  const base = {
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: EXPECTED.projectId,
    VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
    VERCEL_URL: 'sms-v3-staging-preview-fixture-godzillazz.vercel.app',
    VERCEL_GIT_COMMIT_SHA: APP_SHA,
    VERCEL_GIT_COMMIT_REF: EXPECTED.integrationRef,
    VERCEL_GIT_REPO_OWNER: 'godzillazzz',
    VERCEL_GIT_REPO_SLUG: 'SMS-v3',
    RUNTIME_ISOLATION_PROBE_HMAC_SECRET: HMAC_FIXTURE,
    DATABASE_URL: 'postgresql://postgres.ezxanpfagitckpfsnflp:TEST_ONLY_PASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://postgres:TEST_ONLY_PASSWORD@db.ezxanpfagitckpfsnflp.supabase.co:5432/postgres',
    SUPABASE_URL: 'https://ezxanpfagitckpfsnflp.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: token(),
    LICENSE_DOCUMENTS_BUCKET: EXPECTED.licenseBucket
  };
  const defaultFingerprint = parseAndNormalize(base).fingerprint;
  return {
    ...base,
    APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: defaultFingerprint,
    ...overrides
  };
}

function requestFor(env, updates = {}) {
  const issuedAt = String(Math.floor(NOW / 1000));
  const query = {
    nonce: NONCE,
    sha: APP_SHA,
    deploymentId: DEPLOYMENT_ID,
    issuedAt,
    ...(updates.query || {})
  };
  const headers = {
    host: env.VERCEL_URL,
    ...(updates.headers || {})
  };
  headers['x-smsv3-probe-signature'] = signChallenge(
    env.RUNTIME_ISOLATION_PROBE_HMAC_SECRET,
    {
      host: headers.host,
      deploymentId: query.deploymentId,
      sha: query.sha,
      nonce: query.nonce,
      issuedAt: Number(query.issuedAt)
    }
  );
  return { method: updates.method || 'GET', headers, query };
}

function databaseFixture({ databaseName = 'postgres', readOnly = 'on' } = {}) {
  const calls = [];
  const prisma = {
    async $transaction(callback, options) {
      calls.push({ kind: 'transaction', options });
      let readOnlyTransaction = false;
      const tx = {
        async $executeRawUnsafe(sql) {
          calls.push({ kind: 'sql', sql });
          if (sql === 'SET TRANSACTION READ ONLY') readOnlyTransaction = true;
        },
        async $queryRawUnsafe(sql) {
          calls.push({ kind: 'query', sql });
          return [{
            database_name: databaseName,
            transaction_read_only: readOnlyTransaction ? readOnly : 'off'
          }];
        }
      };
      return callback(tx);
    }
  };
  return { prisma, calls };
}

function storageFixture({ status = 200, publicBucket = false, redirect = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (redirect) return { status: 302, ok: false, json: async () => ({}) };
    return {
      status,
      ok: status === 200,
      async json() {
        return {
          id: EXPECTED.licenseBucket,
          name: EXPECTED.licenseBucket,
          public: publicBucket
        };
      }
    };
  };
  return { fetchImpl, calls };
}

function signedRequest(env, changes) {
  return requestFor(env, changes);
}

test('returns a sanitized receipt after Preview URL pair, approved guard, read-only Prisma query and private bucket GET pass', async () => {
  const env = environment();
  const { prisma, calls: dbCalls } = databaseFixture();
  const { fetchImpl, calls: storageCalls } = storageFixture();
  const result = await createRuntimeIsolationReceipt({
    req: signedRequest(env),
    environment: env,
    prisma,
    fetchImpl,
    now: NOW
  });

  assert.equal(result.contract, EXPECTED.contract);
  assert.equal(result.nonce, NONCE);
  assert.equal(result.deploymentId, DEPLOYMENT_ID);
  assert.equal(result.applicationSha, APP_SHA);
  assert.equal(result.database.configuredDatabaseProjectRef, EXPECTED.previewDatabaseRef);
  assert.equal(result.database.configuredDirectProjectRef, EXPECTED.previewDatabaseRef);
  assert.equal(result.database.configuredDatabaseName, 'postgres');
  assert.equal(result.database.observedDatabaseName, 'postgres');
  assert.equal(result.database.targetGuardMatched, true);
  assert.equal(result.database.databaseReadOnlyQuerySucceeded, true);
  assert.equal(result.storage.configuredEndpointProjectRef, EXPECTED.previewStorageRef);
  assert.equal(result.storage.bucket, EXPECTED.licenseBucket);
  assert.equal(result.storage.privateBucketMetadataReadSucceeded, true);
  assert.equal(result.storage.bucketIsPrivate, true);
  assert.equal(Object.keys(result.database).some(key => /connectedProjectRef|providerProjectRef/i.test(key)), false);
  assert.equal(Object.keys(result.storage).some(key => /credentialProjectRef|serviceRoleKeyProjectRef/i.test(key)), false);
  assert.deepEqual(storageCalls.map(x => x.options.method), ['GET']);
  assert.equal(storageCalls[0].options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(storageCalls[0].options.headers.authorization, 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
  assert.match(dbCalls.find(x => x.kind === 'sql').sql, /^SET TRANSACTION READ ONLY$/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(HMAC_FIXTURE), false);
  assert.equal(serialized.includes(env.DATABASE_URL), false);
  assert.equal(serialized.includes(env.DIRECT_URL), false);
  assert.equal(serialized.includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
  assert.equal(Object.keys(result).some(key => /production/i.test(key)), false);
});

test('sends sb_secret_ only as apikey for private bucket metadata GET', async () => {
  const secretKey = 'sb_secret_TEST_ONLY_UAT_METADATA_KEY';
  const env = environment({ SUPABASE_SERVICE_ROLE_KEY: secretKey });
  const { prisma } = databaseFixture();
  const { fetchImpl, calls } = storageFixture();
  const result = await createRuntimeIsolationReceipt({
    req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW
  });

  assert.equal(result.storage.privateBucketMetadataReadSucceeded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.apikey, secretKey);
  assert.equal(Object.hasOwn(calls[0].options.headers, 'authorization'), false);
  assert.equal(JSON.stringify(result).includes(secretKey), false);
});

test('fails closed when sb_secret_ apikey is rejected and never retries it as Bearer', async () => {
  const secretKey = 'sb_secret_TEST_ONLY_REJECTED_KEY';
  const env = environment({ SUPABASE_SERVICE_ROLE_KEY: secretKey });
  const { prisma } = databaseFixture();
  const { fetchImpl, calls } = storageFixture({ status: 401 });

  await assert.rejects(
    createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
    error => error.code === 'STORAGE_CREDENTIAL_REJECTED'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, secretKey);
  assert.equal(Object.hasOwn(calls[0].options.headers, 'authorization'), false);
});

test('rejects unauthenticated, expired, wrong-SHA, wrong-deployment and non-Preview probes before provider calls', async (t) => {
  const cases = [
    ['missing signature', req => { delete req.headers['x-smsv3-probe-signature']; }],
    ['bad signature', req => { req.headers['x-smsv3-probe-signature'] = 'v1=' + '0'.repeat(64); }],
    ['expired challenge', req => { req.query.issuedAt = '1750000000'; }],
    ['wrong SHA', req => { req.query.sha = 'b'.repeat(40); }],
    ['wrong deployment', req => { req.query.deploymentId = 'dpl_Other'; }],
    ['Production runtime', (_req, env) => { env.VERCEL_ENV = 'production'; }]
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const env = environment();
      const req = signedRequest(env);
      if (name === 'Production runtime') change(req, env);
      else {
        change(req);
        if (name === 'wrong SHA' || name === 'wrong deployment' || name === 'expired challenge') {
          // An attacker cannot reuse a signature after changing the signed challenge.
        }
      }
      const { prisma, calls: dbCalls } = databaseFixture();
      const { fetchImpl, calls: storageCalls } = storageFixture();
      await assert.rejects(
        createRuntimeIsolationReceipt({ req, environment: env, prisma, fetchImpl, now: NOW })
      );
      assert.deepEqual(dbCalls, []);
      assert.deepEqual(storageCalls, []);
    });
  }
});

test('does not accept the Vercel deployment bypass secret as the probe HMAC key', async () => {
  const env = environment({ RUNTIME_ISOLATION_PROBE_HMAC_SECRET: '' });
  env.VERCEL_AUTOMATION_BYPASS_SECRET = 'TEST_ONLY_VERCEL_BYPASS_VALUE_0123456789';
  const { prisma, calls: dbCalls } = databaseFixture();
  const { fetchImpl, calls: storageCalls } = storageFixture();
  await assert.rejects(
    createRuntimeIsolationReceipt({ req: signedRequest(environment()), environment: env, prisma, fetchImpl, now: NOW }),
    error => error.code === 'PROBE_AUTH_NOT_CONFIGURED'
  );
  assert.deepEqual(dbCalls, []);
  assert.deepEqual(storageCalls, []);
});

test('fails closed before Provider calls when required Vercel runtime identity variables are missing', async (t) => {
  const cases = [
    ['VERCEL_ENV', { VERCEL_ENV: undefined }, 'PREVIEW_RUNTIME_REQUIRED'],
    ['VERCEL_PROJECT_ID', { VERCEL_PROJECT_ID: undefined }, 'VERCEL_PROJECT_ID_MISMATCH'],
    ['repository metadata', { VERCEL_GIT_REPO_OWNER: undefined }, 'VERCEL_REPOSITORY_MISMATCH'],
    ['Integration ref', { VERCEL_GIT_COMMIT_REF: undefined }, 'INTEGRATION_REF_REQUIRED'],
    ['Deployment ID', { VERCEL_DEPLOYMENT_ID: undefined }, 'RUNTIME_DEPLOYMENT_IDENTITY_MISMATCH'],
    ['deployment host', { VERCEL_URL: undefined }, 'RUNTIME_HOST_MISMATCH']
  ];
  for (const [name, overrides, expectedCode] of cases) {
    await t.test(name, async () => {
      const env = environment(overrides);
      const req = signedRequest(environment());
      const { prisma, calls: dbCalls } = databaseFixture();
      const { fetchImpl, calls: storageCalls } = storageFixture();
      await assert.rejects(
        createRuntimeIsolationReceipt({ req, environment: env, prisma, fetchImpl, now: NOW }),
        error => error.code === expectedCode
      );
      assert.deepEqual(dbCalls, []);
      assert.deepEqual(storageCalls, []);
    });
  }
});

test('rejects a database URL pair for a different Supabase project without connecting', async () => {
  const env = environment({
    DATABASE_URL: 'postgresql://postgres.otherproject123:TEST_ONLY_PASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://postgres:TEST_ONLY_PASSWORD@db.otherproject123.supabase.co:5432/postgres'
  });
  env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT = parseAndNormalize(env).fingerprint;
  const { prisma, calls: dbCalls } = databaseFixture();
  const { fetchImpl, calls: storageCalls } = storageFixture();

  await assert.rejects(
    createRuntimeIsolationReceipt({ req: signedRequest(environment()), environment: env, prisma, fetchImpl, now: NOW }),
    error => error.code === 'RUNTIME_DEPLOYMENT_IDENTITY_MISMATCH'
      || error.code === 'DATABASE_TARGET_MISMATCH'
  );
  assert.deepEqual(dbCalls, []);
  assert.deepEqual(storageCalls, []);
});

test('approved fingerprint mismatch fails before read-only connect and does not disclose the fingerprint', async () => {
  const env = environment({ APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'f'.repeat(64) });
  const { prisma, calls: dbCalls } = databaseFixture();
  const { fetchImpl, calls: storageCalls } = storageFixture();

  await assert.rejects(
    createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
    error => error.code === 'DATABASE_APPROVED_TARGET_MISMATCH'
  );
  assert.deepEqual(dbCalls, []);
  assert.deepEqual(storageCalls, []);
});

test('rejects malformed/missing DB credential pair without exposing values', async (t) => {
  for (const field of ['DATABASE_URL', 'DIRECT_URL']) {
    await t.test(field, async () => {
      const env = environment({ [field]: '' });
      const { prisma, calls: dbCalls } = databaseFixture();
      const { fetchImpl, calls: storageCalls } = storageFixture();
      await assert.rejects(
        createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
        error => error.code === 'DATABASE_TARGET_INVALID'
      );
      assert.deepEqual(dbCalls, []);
      assert.deepEqual(storageCalls, []);
    });
  }
});

test('does not connect when the read-only transaction or DB identity check fails', async (t) => {
  for (const options of [{ databaseName: 'wrongdb' }, { readOnly: 'off' }]) {
    await t.test(JSON.stringify(options), async () => {
      const env = environment();
      const { prisma, calls: dbCalls } = databaseFixture(options);
      const { fetchImpl, calls: storageCalls } = storageFixture();
      await assert.rejects(
        createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
        error => error.code === 'DATABASE_READ_ONLY_CHECK_MISMATCH'
      );
      assert.deepEqual(storageCalls, []);
      assert.equal(dbCalls.some(x => x.kind === 'sql'), true);
    });
  }
});

test('rejects wrong Storage project and bucket before connecting to the database or sending the key', async (t) => {
  const cases = [
    {
      name: 'wrong endpoint project',
      overrides: { SUPABASE_URL: 'https://otherproject123.supabase.co' },
      code: 'STORAGE_ENDPOINT_MISMATCH'
    },
    {
      name: 'wrong bucket',
      overrides: { LICENSE_DOCUMENTS_BUCKET: 'license-documents-production' },
      code: 'STORAGE_BUCKET_MISMATCH'
    },
    {
      name: 'wrong credential project',
      overrides: { SUPABASE_SERVICE_ROLE_KEY: token('otherproject123') },
      code: 'STORAGE_CREDENTIAL_CLAIM_MISMATCH'
    },
    {
      name: 'legacy JWT with a non-service role',
      overrides: { SUPABASE_SERVICE_ROLE_KEY: token(EXPECTED.previewStorageRef, 'anon') },
      code: 'STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID'
    },
    {
      name: 'malformed legacy JWT',
      overrides: { SUPABASE_SERVICE_ROLE_KEY: 'header.not-json.signature' },
      code: 'STORAGE_SERVICE_ROLE_CREDENTIAL_INVALID'
    },
    {
      name: 'missing credential',
      overrides: { SUPABASE_SERVICE_ROLE_KEY: '' },
      code: 'STORAGE_CREDENTIALS_MISSING'
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const env = environment(item.overrides);
      const { prisma, calls: dbCalls } = databaseFixture();
      const { fetchImpl, calls: storageCalls } = storageFixture();
      await assert.rejects(
        createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
        error => error.code === item.code
      );
      assert.deepEqual(dbCalls, []);
      assert.deepEqual(storageCalls, []);
    });
  }
});

test('rejects Storage credential accepted nowhere, redirects, and public bucket metadata', async (t) => {
  const cases = [
    { name: 'credential rejected', fixture: { status: 401 }, code: 'STORAGE_CREDENTIAL_REJECTED' },
    { name: 'redirect rejected', fixture: { redirect: true }, code: 'STORAGE_REDIRECT_REJECTED' },
    { name: 'public bucket rejected', fixture: { publicBucket: true }, code: 'STORAGE_BUCKET_NOT_PRIVATE' }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const env = environment();
      const { prisma } = databaseFixture();
      const { fetchImpl } = storageFixture(item.fixture);
      await assert.rejects(
        createRuntimeIsolationReceipt({ req: signedRequest(env), environment: env, prisma, fetchImpl, now: NOW }),
        error => error.code === item.code
      );
    });
  }
});
