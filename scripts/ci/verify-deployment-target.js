'use strict';

const crypto = require('node:crypto');

const blockedHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);
const blockedDatabases = new Set(['sms_v3_test', 'sms_v3_dev', 'smsv3_test']);

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPooler(hostname) {
  return /(^|\.)pooler\.supabase\.com$/i.test(hostname);
}

function parseTarget(name, rawUrl) {
  if (!rawUrl) throw new Error(`${name} is missing`);

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${name} is malformed`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${name} must use PostgreSQL`);
  const hostname = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!hostname || !database) throw new Error(`${name} must include a host and database`);
  if (blockedHosts.has(hostname) || blockedDatabases.has(database)) throw new Error(`${name} points to a local or test database`);

  const provider = /(?:\.supabase\.co|\.pooler\.supabase\.com)$/i.test(hostname) ? 'supabase' : 'postgresql';
  return {
    provider,
    hostname,
    port: url.port || '5432',
    database,
    mode: isPooler(hostname) ? 'pooled' : 'direct'
  };
}

function targetFingerprint(databaseUrl, directUrl) {
  const pair = [databaseUrl, directUrl].map(({ provider, hostname, port, database }) => ({ provider, hostname, port, database }));
  return hash(JSON.stringify(pair));
}

function maskedHash(value) {
  return hash(value).slice(0, 12);
}

function verifyDeploymentTarget({ env = process.env, log = console.log, error = console.error } = {}) {
  log(`DATABASE_URL_PRESENT=${Boolean(env.DATABASE_URL)}`);
  log(`DIRECT_URL_PRESENT=${Boolean(env.DIRECT_URL)}`);

  let databaseUrl;
  let directUrl;
  try {
    databaseUrl = parseTarget('DATABASE_URL', env.DATABASE_URL);
    directUrl = parseTarget('DIRECT_URL', env.DIRECT_URL);
  } catch (reason) {
    error(`Deployment target guard failed: ${reason.message}`);
    return 1;
  }

  if (databaseUrl.provider !== directUrl.provider || databaseUrl.database !== directUrl.database) {
    error('Deployment target guard failed: runtime and migration targets differ');
    return 1;
  }

  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  const approved = env.APPROVED_DATABASE_TARGET_FINGERPRINT;
  const match = Boolean(approved) && approved === fingerprint;
  log(`DATABASE_MODE=${databaseUrl.mode}`);
  log(`DIRECT_MODE=${directUrl.mode}`);
  log(`PROVIDER_FINGERPRINT=${maskedHash(databaseUrl.provider)}`);
  log(`DATABASE_HOST_FINGERPRINT=${maskedHash(databaseUrl.hostname)}`);
  log(`DATABASE_NAME_FINGERPRINT=${maskedHash(databaseUrl.database)}`);
  log(`TARGET_FINGERPRINT_MATCH=${match}`);
  if (!match) {
    error('Deployment target guard failed: approved fingerprint mismatch');
    return 1;
  }

  return 0;
}

if (require.main === module) process.exitCode = verifyDeploymentTarget();

module.exports = {
  parseTarget,
  targetFingerprint,
  verifyDeploymentTarget
};
