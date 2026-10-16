'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const {
  EXPECTED_ROLE,
  inspectPublicMutationSurface,
  inspectReadOnlyRole,
} = require('./preview-readonly-role-privileges');

function runTargetGuard(env, log) {
  const guardPath = path.join(env.RELEASE_CONTROL_ROOT || __dirname, 'scripts', 'ci', 'verify-preview-migration-target.js');
  const guard = require(guardPath);
  guard.verifyPreviewMigrationTarget({ env, log });
}

function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function parseConnectionUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw Object.assign(new Error(), { safeCategory: 'PREVIEW_URL_INVALID' }); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw Object.assign(new Error(), { safeCategory: 'PREVIEW_URL_INVALID' });
  }
  return url;
}

function buildReadOnlyUrl(directUrl, password, roleName = EXPECTED_ROLE) {
  const url = new URL(directUrl);
  url.username = roleName;
  url.password = password;
  url.searchParams.set('application_name', 'smsv3-preview-readonly-inspector');
  url.searchParams.set('connect_timeout', '10');
  return url.toString();
}

function parsePsqlEnvironment(directUrl, baseEnv = process.env) {
  const url = parseConnectionUrl(directUrl);
  const pgEnv = { ...baseEnv };
  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'RECIPIENT_PUBLIC_KEY', 'APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT', 'APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) {
    delete pgEnv[name];
  }
  pgEnv.PGHOST = url.hostname;
  pgEnv.PGPORT = url.port || '5432';
  pgEnv.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  pgEnv.PGUSER = decodeURIComponent(url.username);
  pgEnv.PGPASSWORD = decodeURIComponent(url.password);
  pgEnv.PGSSLMODE = url.searchParams.get('sslmode') || 'require';
  pgEnv.PGCONNECT_TIMEOUT = '10';
  pgEnv.PGAPPNAME = 'smsv3-preview-role-provisioning';
  pgEnv.PGOPTIONS = '-c statement_timeout=15000 -c lock_timeout=5000';
  const rootCert = url.searchParams.get('sslrootcert');
  if (rootCert) pgEnv.PGSSLROOTCERT = rootCert;
  return pgEnv;
}

function validateRecipientPublicKey(pem) {
  if (typeof pem !== 'string' || pem.length > 12000 || !pem.includes('BEGIN PUBLIC KEY')) {
    throw Object.assign(new Error(), { safeCategory: 'RECIPIENT_KEY_INVALID' });
  }
  let key;
  try { key = crypto.createPublicKey(pem); } catch { throw Object.assign(new Error(), { safeCategory: 'RECIPIENT_KEY_INVALID' }); }
  if (key.asymmetricKeyType !== 'rsa' || Number(key.asymmetricKeyDetails?.modulusLength || 0) < 3072) {
    throw Object.assign(new Error(), { safeCategory: 'RECIPIENT_KEY_TOO_WEAK' });
  }
  return key;
}

function createEncryptedEnvelope(recipientPublicKey, secretText) {
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secretText, 'utf8')), cipher.final()]);
  const wrappedKey = crypto.publicEncrypt({
    key: recipientPublicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, contentKey);
  return {
    version: 1,
    kdf: 'RSA-OAEP-SHA256',
    cipher: 'AES-256-GCM',
    key: wrappedKey.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function buildPsqlProvisioningInput({ databaseName, roleName = EXPECTED_ROLE }) {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(roleName)) throw Object.assign(new Error(), { safeCategory: 'ROLE_NAME_INVALID' });
  const db = quoteIdentifier(databaseName);
  const role = quoteIdentifier(roleName);
  return [
    'BEGIN;',
    `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role};`,
    `GRANT USAGE ON SCHEMA public TO ${role};`,
    `GRANT SELECT ON TABLE public."_prisma_migrations" TO ${role};`,
    `ALTER ROLE ${role} SET default_transaction_read_only = 'on';`,
    `ALTER ROLE ${role} SET statement_timeout = '15s';`,
    `ALTER ROLE ${role} SET lock_timeout = '5s';`,
    `\\password ${roleName}`,
    `ALTER ROLE ${role} LOGIN;`,
    'COMMIT;',
    '',
  ].join('\n');
}

function runPsqlProvisioning({ databaseName, password, roleName = EXPECTED_ROLE, runnerTemp, psqlEnv, spawn = spawnSync }) {
  const generatedPassword = String(password || '');
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(generatedPassword)) throw Object.assign(new Error(), { safeCategory: 'GENERATED_CREDENTIAL_INVALID' });
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) throw Object.assign(new Error(), { safeCategory: 'RUNNER_TEMP_UNAVAILABLE' });
  const sqlPath = path.join(path.resolve(runnerTemp), 'preview-readonly-role-provision.sql');
  fs.writeFileSync(sqlPath, buildPsqlProvisioningInput({ databaseName, roleName }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const expectProgram = [
    'set timeout 30',
    'set password $env(ROLE_PASSWORD)',
    'unset env(ROLE_PASSWORD)',
    'log_user 0',
    'spawn -noecho psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --file $env(PROVISION_SQL_FILE)',
    'expect {',
    '  -re {(?i)new password: *$} { send -- "$password\\r"; exp_continue }',
    '  -re {(?i)again: *$} { send -- "$password\\r"; exp_continue }',
    '  eof { }',
    '  timeout { exit 124 }',
    '}',
    'set result [wait]',
    'exit [lindex $result 3]',
    '',
  ].join('\n');
  try {
    const result = spawn('expect', ['-c', expectProgram], {
      env: { ...psqlEnv, ROLE_PASSWORD: generatedPassword, PROVISION_SQL_FILE: sqlPath },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return !result.error && result.status === 0;
  } finally {
    fs.rmSync(sqlPath, { force: true });
  }
}

function writeEnvelope(envelope, runnerTemp) {
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) throw Object.assign(new Error(), { safeCategory: 'RUNNER_TEMP_UNAVAILABLE' });
  const directory = path.resolve(runnerTemp);
  fs.mkdirSync(directory, { recursive: true });
  const outputPath = path.join(directory, 'preview-readonly-db-url.envelope.json');
  fs.writeFileSync(outputPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return outputPath;
}

function disableRoleLogin(env, psqlEnvironment) {
  const role = quoteIdentifier(EXPECTED_ROLE);
  const result = spawnSync('psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--dbname', psqlEnvironment.PGDATABASE], {
    env: psqlEnvironment,
    input: `ALTER ROLE ${role} NOLOGIN;\n`,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return !result.error && result.status === 0;
}

async function provisionPreviewReadonlyRole(args = {}) {
  const env = args.env || process.env;
  const log = args.log || console.log;
  const createClient = args.createClient || ((options) => new Client(options));
  const spawn = args.spawn || spawnSync;
  let envelopePath;
  let roleCreated = false;
  let psqlEnv;
  try {
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview') {
      throw Object.assign(new Error(), { safeCategory: 'PREVIEW_ENVIRONMENT_REQUIRED' });
    }
    (args.targetGuard || runTargetGuard)(env, log);
    const adminUrl = env.DIRECT_URL;
    if (!adminUrl || !env.DATABASE_URL) throw Object.assign(new Error(), { safeCategory: 'PREVIEW_TARGET_CONFIGURATION_INVALID' });
    const dbUrl = parseConnectionUrl(adminUrl);
    const recipientPublicKey = validateRecipientPublicKey(env.RECIPIENT_PUBLIC_KEY);

    const baselineClient = createClient({
      connectionString: adminUrl,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      application_name: 'smsv3-preview-readonly-baseline-proof',
    });
    const baseline = await inspectPublicMutationSurface(baselineClient, EXPECTED_ROLE);
    log(`PUBLIC_MUTATION_SURFACE=${baseline.passed ? 'PASS' : 'FAIL'}`);
    log(`PUBLIC_MUTATION_SURFACE_CATEGORY=${baseline.category}`);
    for (const [name, passed] of Object.entries(baseline.checks || {})) {
      log(`PUBLIC_PRIVILEGE_CHECK_${name.toUpperCase()}=${passed ? 'PASS' : 'FAIL'}`);
    }
    if (!baseline.passed) {
      throw Object.assign(new Error(), { safeCategory: `PRE_PROVISION_${baseline.category}` });
    }

    const password = crypto.randomBytes(36).toString('base64url');
    const readonlyUrl = buildReadOnlyUrl(adminUrl, password);
    const encryptedEnvelope = createEncryptedEnvelope(recipientPublicKey, readonlyUrl);
    envelopePath = writeEnvelope(encryptedEnvelope, env.RUNNER_TEMP);
    psqlEnv = parsePsqlEnvironment(adminUrl, env);

    const psqlVersion = spawn('psql', ['--version'], {
      env: psqlEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
    });
    if (psqlVersion.error || psqlVersion.status !== 0) {
      throw Object.assign(new Error(), { safeCategory: 'PSQL_CLIENT_UNAVAILABLE' });
    }

    const provisioned = runPsqlProvisioning({
      databaseName: decodeURIComponent(dbUrl.pathname.slice(1)), password,
      runnerTemp: env.RUNNER_TEMP, psqlEnv, spawn,
    });
    if (!provisioned) {
      throw Object.assign(new Error(), { safeCategory: 'ROLE_PROVISIONING_TRANSACTION_FAILED' });
    }
    roleCreated = true;

    const proofEnv = {
      ...env,
      DATABASE_URL: readonlyUrl,
      DIRECT_URL: readonlyUrl,
      VERCEL_ENV: 'preview',
    };
    const proofClient = createClient({
      connectionString: readonlyUrl,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      application_name: 'smsv3-preview-readonly-proof',
    });
    const proof = await inspectReadOnlyRole(proofClient, EXPECTED_ROLE);
    if (!proof.passed) {
      const disabled = disableRoleLogin(proofEnv, psqlEnv);
      roleCreated = !disabled;
      throw Object.assign(new Error(), {
        safeCategory: disabled ? `POST_PROVISION_PROOF_${proof.category}` : 'ROLE_DISABLE_ON_FAILURE_FAILED',
      });
    }

    log('READ_ONLY_ROLE_PROVISIONED=PASS');
    log('READ_ONLY_PRIVILEGE_PROOF=PASS');
    log('READ_ONLY_AUTHORITY=CONNECT,SCHEMA_USAGE,PRISMA_LEDGER_SELECT,CATALOG_READ');
    log('READ_ONLY_MUTATION_PRIVILEGES=ABSENT');
    log('SECRET_HANDOFF=ENCRYPTED_EPHEMERAL_ARTIFACT');
    log('RAW_CONNECTION_VALUES_EMITTED=false');
    log('APPLICATION_ROWS_READ=false');
    return { passed: true, envelopePath, roleName: EXPECTED_ROLE, proof };
  } catch (error) {
    if (roleCreated && psqlEnv) {
      const disabled = disableRoleLogin(env, psqlEnv);
      if (!disabled) log('READ_ONLY_ROLE_FAIL_CLOSED_DISABLE=FAILED');
      else log('READ_ONLY_ROLE_FAIL_CLOSED_DISABLE=PASS');
    }
    if (envelopePath) fs.rmSync(envelopePath, { force: true });
    const category = error?.safeCategory || 'ROLE_PROVISIONING_FAILED';
    log(`READ_ONLY_ROLE_PROVISIONED=FAIL`);
    log(`READ_ONLY_ROLE_FAILURE_CATEGORY=${category}`);
    log('RAW_CONNECTION_VALUES_EMITTED=false');
    log('APPLICATION_ROWS_READ=false');
    return { passed: false, category };
  }
}

async function main() {
  const result = await provisionPreviewReadonlyRole();
  return result.passed ? 0 : 1;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  buildPsqlProvisioningInput,
  buildReadOnlyUrl,
  createEncryptedEnvelope,
  main,
  parseConnectionUrl,
  parsePsqlEnvironment,
  provisionPreviewReadonlyRole,
  quoteIdentifier,
  runPsqlProvisioning,
  validateRecipientPublicKey,
};
