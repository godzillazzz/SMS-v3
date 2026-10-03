'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_ROLE,
  PUBLIC_MUTATION_CHECKS,
  PUBLIC_MUTATING_FUNCTION_NAMES,
  PUBLIC_MUTATION_SURFACE_SQL,
  PASSIVE_QUERIES,
  PRIVILEGE_FACTS_SQL,
  PROOF_CHECKS,
  evaluatePrivilegeFacts,
  evaluatePublicMutationSurface,
  inspectPublicMutationSurface,
  inspectReadOnlyRole,
  safeFailureCategory,
} = require('../scripts/ci/preview-readonly-role-privileges');
const {
  buildPsqlProvisioningInput,
  buildReadOnlyUrl,
  createEncryptedEnvelope,
  parseConnectionUrl,
  parsePsqlEnvironment,
  provisionPreviewReadonlyRole,
  quoteIdentifier,
  runPsqlProvisioning,
  validateRecipientPublicKey,
} = require('../scripts/ci/provision-preview-readonly-role');
const { disablePreviewReadonlyRole } = require('../scripts/ci/disable-preview-readonly-role');

const root = path.join(__dirname, '..');
const provisionWorkflow = fs.readFileSync(path.join(root, '.github/workflows/provision-preview-attendance-readonly-role.yml'), 'utf8').replaceAll('\r\n', '\n');

function passingFacts() {
  return Object.fromEntries(Object.entries(PROOF_CHECKS).map(([name, expected]) => [name, expected]));
}

function fakeClient(facts = passingFacts(), failAt = null) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push('CONNECT'); if (failAt === 'CONNECT') throw Object.assign(new Error('postgres://secret'), { code: 'ECONNREFUSED' }); },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN READ ONLY') return { rows: [] };
      if (sql === PRIVILEGE_FACTS_SQL) return { rows: [facts] };
      if (sql === PASSIVE_QUERIES.ledger) return { rows: [{ row_count: '99' }] };
      if (sql === PASSIVE_QUERIES.catalog) return { rows: [{ readable: 1 }] };
      if (sql === 'ROLLBACK') return { rows: [] };
      throw new Error('unexpected query');
    },
    async end() { calls.push('END'); },
  };
}

test('read-only proof accepts the exact minimum authority and no mutating privileges', () => {
  const result = evaluatePrivilegeFacts(passingFacts(), { ledgerReadable: true, catalogReadable: true });
  assert.equal(result.passed, true);
  assert.equal(result.checks.database_create, true);
  assert.equal(result.checks.database_temp, true);
  assert.equal(result.checks.no_relation_data_or_mutation_privilege, true);
  assert.equal(result.checks.ledger_select, true);
});

test('read-only proof fails closed for every extra authority or missing required read', () => {
  for (const [name, expected] of Object.entries(PROOF_CHECKS)) {
    const facts = passingFacts();
    facts[name] = !expected;
    assert.equal(evaluatePrivilegeFacts(facts, { ledgerReadable: true, catalogReadable: true }).passed, false, name);
  }
  assert.equal(evaluatePrivilegeFacts(passingFacts(), { ledgerReadable: false, catalogReadable: true }).passed, false);
  assert.equal(evaluatePrivilegeFacts(passingFacts(), { ledgerReadable: true, catalogReadable: false }).passed, false);
});

test('pre-provision public privilege scan fails closed on TEMP, mutating large-object functions, and inherited writes', () => {
  const safe = Object.fromEntries(Object.entries(PUBLIC_MUTATION_CHECKS).map(([name, expected]) => [name, expected]));
  assert.equal(evaluatePublicMutationSurface(safe).passed, true);
  for (const name of Object.keys(PUBLIC_MUTATION_CHECKS)) {
    const facts = { ...safe, [name]: !safe[name] };
    assert.equal(evaluatePublicMutationSurface(facts).passed, false, name);
  }
  assert.match(PUBLIC_MUTATION_SURFACE_SQL, /acl\.privilege_type IN \('TEMP', 'TEMPORARY'\)/);
  assert.match(PUBLIC_MUTATION_SURFACE_SQL, /pg_catalog\.aclexplode\(p\.proacl\)/);
  assert.ok(PUBLIC_MUTATING_FUNCTION_NAMES.includes('lo_create'));
});

test('pre-provision privilege scan is a read-only SELECT and returns only sanitized checks', async () => {
  const facts = Object.fromEntries(Object.entries(PUBLIC_MUTATION_CHECKS).map(([name, expected]) => [name, expected]));
  const calls = [];
  const client = {
    async connect() { calls.push('CONNECT'); },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
      if (sql === PUBLIC_MUTATION_SURFACE_SQL) return { rows: [facts] };
      throw new Error('unexpected query');
    },
    async end() { calls.push('END'); },
  };
  const result = await inspectPublicMutationSurface(client, EXPECTED_ROLE);
  assert.equal(result.passed, true);
  assert.equal(result.category, 'PUBLIC_MUTATION_SURFACE_CLEAR');
  const statements = calls.filter((call) => typeof call !== 'string').map((call) => call.sql);
  assert.ok(statements.every((sql) => /^\s*(?:SELECT|BEGIN\s+READ\s+ONLY|ROLLBACK)\b/i.test(sql)));
  assert.doesNotMatch(JSON.stringify(result), /postgres:|password|secret-value|raw/i);
});

test('provisioning stops before role creation when inherited PUBLIC mutation rights exist', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-preview-role-blocked-'));
  const facts = Object.fromEntries(Object.entries(PUBLIC_MUTATION_CHECKS).map(([name, expected]) => [name, expected]));
  facts.public_database_temp = true;
  const log = [];
  let spawnCalled = false;
  const client = {
    async connect() {},
    async query(sql) {
      if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
      if (sql === PUBLIC_MUTATION_SURFACE_SQL) return { rows: [facts] };
      throw new Error('unexpected query');
    },
    async end() {},
  };
  try {
    const result = await provisionPreviewReadonlyRole({
      env: {
        VERCEL_ENV: 'preview',
        DATABASE_URL: 'postgresql://admin:admin-secret@preview-db.invalid:5432/preview?sslmode=require',
        DIRECT_URL: 'postgresql://admin:admin-secret@preview-db.invalid:5432/preview?sslmode=require',
        RECIPIENT_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'pem' }),
        RUNNER_TEMP: runnerTemp,
      },
      targetGuard() {},
      createClient: () => client,
      spawn() { spawnCalled = true; throw new Error('must not spawn before safe privilege proof'); },
      log(value) { log.push(value); },
    });
    assert.equal(result.passed, false);
    assert.equal(result.category, 'PRE_PROVISION_PUBLIC_MUTATION_PRIVILEGE_PRESENT');
    assert.equal(spawnCalled, false);
    assert.equal(fs.readdirSync(runnerTemp).length, 0);
    assert.ok(log.includes('PUBLIC_PRIVILEGE_CHECK_PUBLIC_DATABASE_TEMP=FAIL'));
    assert.ok(log.every((line) => !/postgresql:|admin-secret|password=/i.test(line)));
  } finally {
    fs.rmdirSync(runnerTemp);
  }
});

test('inspector starts a read-only transaction and reads only migration/catalog metadata', async () => {
  const client = fakeClient();
  const result = await inspectReadOnlyRole(client, EXPECTED_ROLE);
  assert.equal(result.passed, true);
  assert.equal(client.calls[0], 'CONNECT');
  assert.equal(client.calls[1].sql, 'BEGIN READ ONLY');
  assert.ok(client.calls.some((call) => call.sql === PASSIVE_QUERIES.ledger));
  assert.ok(client.calls.some((call) => call.sql === PASSIVE_QUERIES.catalog));
  assert.equal(client.calls.at(-1), 'END');
  assert.ok(client.calls.every((call) => typeof call === 'string' || !/attendance_events|employees|attendance_time_policies/i.test(call.sql)));
});

test('connection failures are reduced to safe categories with no raw database error text', async () => {
  const proof = await inspectReadOnlyRole(fakeClient({}, 'CONNECT'));
  assert.equal(proof.passed, false);
  assert.equal(proof.category, 'CONNECTION_FAILED');
  assert.equal(safeFailureCategory(Object.assign(new Error('postgres://user:secret@host'), { code: '42501' })), 'PRIVILEGE_CHECK_FAILED');
});

test('recipient public key must be RSA 3072 bits or stronger', () => {
  const strong = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  assert.equal(validateRecipientPublicKey(strong.publicKey.export({ type: 'spki', format: 'pem' })).asymmetricKeyType, 'rsa');
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => validateRecipientPublicKey(weak.publicKey.export({ type: 'spki', format: 'pem' })),
    (error) => error.safeCategory === 'RECIPIENT_KEY_TOO_WEAK',
  );
});

test('secret envelope round-trips only to the ephemeral private key and contains no plaintext', () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const plaintext = 'postgresql://ephemeral-user:secret-value@preview.invalid:5432/db';
  const envelope = createEncryptedEnvelope(pair.publicKey, plaintext);
  const contentKey = crypto.privateDecrypt({
    key: pair.privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, Buffer.from(envelope.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  assert.equal(decrypted, plaintext);
  assert.doesNotMatch(JSON.stringify(envelope), /ephemeral-user|secret-value|postgresql:/);
});

test('read-only connection URI changes credentials but retains the same Preview target', () => {
  const admin = 'postgresql://admin:admin-secret@db.preview-example.supabase.co:5432/postgres?sslmode=require&schema=public';
  const readonly = buildReadOnlyUrl(admin, 'a'.repeat(48));
  const oldUrl = parseConnectionUrl(admin);
  const newUrl = parseConnectionUrl(readonly);
  assert.equal(newUrl.hostname, oldUrl.hostname);
  assert.equal(newUrl.pathname, oldUrl.pathname);
  assert.equal(newUrl.searchParams.get('sslmode'), 'require');
  assert.equal(decodeURIComponent(newUrl.username), EXPECTED_ROLE);
  assert.notEqual(decodeURIComponent(newUrl.password), decodeURIComponent(oldUrl.password));
  const psqlEnv = parsePsqlEnvironment(admin, { DATABASE_URL: 'do-not-pass', DIRECT_URL: admin, PATH: 'path-value' });
  assert.equal(psqlEnv.PGDATABASE, 'postgres');
  assert.equal(psqlEnv.PGUSER, 'admin');
  assert.equal(psqlEnv.DATABASE_URL, undefined);
  assert.equal(psqlEnv.DIRECT_URL, undefined);
});

test('role provisioning keeps password out of SQL and uses psql protected password prompt', () => {
  const input = buildPsqlProvisioningInput({ databaseName: 'preview-db' });
  assert.match(input, /^BEGIN;/);
  assert.match(input, /CREATE ROLE "smsv3_preview_attendance_inspector" NOLOGIN/);
  assert.match(input, /GRANT CONNECT ON DATABASE "preview-db"/);
  assert.match(input, /GRANT USAGE ON SCHEMA public/);
  assert.match(input, /GRANT SELECT ON TABLE public\."_prisma_migrations"/);
  assert.match(input, /\\password smsv3_preview_attendance_inspector/);
  assert.match(input, /ALTER ROLE "smsv3_preview_attendance_inspector" LOGIN/);
  assert.doesNotMatch(input, /PASSWORD\s+'[^']+'/i);
  assert.doesNotMatch(input, /[A-Za-z0-9_-]{40,80}/);
  assert.equal(quoteIdentifier('db"name'), '"db""name"');
});

test('psql handoff uses a hidden terminal prompt and never puts the password in SQL or argv', () => {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-preview-role-'));
  const generatedPassword = 'Ephemeral_-'.repeat(5);
  let capturedArgs;
  let capturedSql;
  let capturedEnv;
  try {
    const ok = runPsqlProvisioning({
      databaseName: 'preview-db',
      password: generatedPassword,
      runnerTemp,
      psqlEnv: { PGDATABASE: 'preview-db', PGPASSWORD: 'admin-only' },
      spawn(command, args, options) {
        capturedArgs = [command, ...args];
        capturedEnv = options.env;
        capturedSql = fs.readFileSync(options.env.PROVISION_SQL_FILE, 'utf8');
        return { status: 0, error: null };
      },
    });
    assert.equal(ok, true);
    assert.match(capturedArgs.join(' '), /expect/);
    assert.match(capturedArgs.join(' '), /log_user 0/);
    assert.doesNotMatch(capturedArgs.join(' '), /Ephemeral_|admin-only/);
    assert.doesNotMatch(capturedSql, /Ephemeral_|admin-only/);
    assert.equal(capturedEnv.ROLE_PASSWORD, generatedPassword);
    assert.equal(fs.existsSync(path.join(runnerTemp, 'preview-readonly-role-provision.sql')), false);
  } finally {
    fs.rmdirSync(runnerTemp);
  }
});

test('failed encrypted artifact upload has a dedicated targeted no-login cleanup path', () => {
  const result = disablePreviewReadonlyRole({
    env: {
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgresql://admin:admin-secret@preview-db.invalid:5432/preview?sslmode=require',
      DIRECT_URL: 'postgresql://admin:admin-secret@preview-db.invalid:5432/preview?sslmode=require',
    },
    releaseControlRoot: root,
    targetGuard() {},
    log() {},
    spawn(command, args, options) {
      assert.equal(command, 'psql');
      assert.match(options.input, /^ALTER ROLE "smsv3_preview_attendance_inspector" NOLOGIN;$/m);
      assert.doesNotMatch(args.join(' '), /password|secret/i);
      return { status: 0, error: null };
    },
  });
  assert.equal(result.passed, true);
  assert.match(provisionWorkflow, /steps\.provision\.outcome == 'success' && steps\.envelope_upload\.outcome != 'success'/);
});

test('one-time provisioning requires protected Preview approval and guards before DB mutation', () => {
  assert.match(provisionWorkflow, /permissions:\n\s+actions: read\n/);
  assert.doesNotMatch(provisionWorkflow, /permissions:[\s\S]*?actions:\s*write/);
  assert.match(provisionWorkflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(provisionWorkflow, /test "\$GITHUB_REF_NAME" = "main"/);
  const targetGuard = provisionWorkflow.indexOf('Prove Preview isolation before any database inspection or mutation');
  const provision = provisionWorkflow.indexOf('Create and prove the read-only Preview role');
  const artifact = provisionWorkflow.indexOf('Upload encrypted one-time connection secret');
  assert.ok(targetGuard >= 0 && targetGuard < provision && provision < artifact);
  assert.match(provisionWorkflow, /actions\/upload-artifact@v4/);
  assert.match(provisionWorkflow, /retention-days: 1/);
  assert.match(provisionWorkflow, /postgresql-client-16 expect/);
  assert.match(provisionWorkflow, /RECIPIENT_PUBLIC_KEY: \$\{\{ inputs\.recipient_public_key \}\}/);
  assert.doesNotMatch(provisionWorkflow, /PRODUCTION_DATABASE_URL|production-sms-v3-staging|prisma\s+migrate\s+deploy|prisma\s+db\s+push/i);
});

test('provision workflow checks out its exact tooling source before Node cache and npm install', () => {
  const checkout = provisionWorkflow.indexOf('Checkout exact workflow source and tooling lockfile');
  const nodeSetup = provisionWorkflow.indexOf('Set up Node.js 22');
  const install = provisionWorkflow.indexOf('Install PostgreSQL client and inspection tooling');
  assert.ok(checkout >= 0 && checkout < nodeSetup && nodeSetup < install);
  const checkoutStep = provisionWorkflow.slice(checkout, nodeSetup);
  assert.match(checkoutStep, /uses: actions\/checkout@v4/);
  assert.match(checkoutStep, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(checkoutStep, /fetch-depth: 1/);
  assert.match(checkoutStep, /persist-credentials: false/);
  assert.match(provisionWorkflow.slice(nodeSetup, install), /cache: npm/);
  assert.match(provisionWorkflow.slice(install), /npm ci --ignore-scripts --no-audit --no-fund/);
});
