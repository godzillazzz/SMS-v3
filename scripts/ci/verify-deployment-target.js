'use strict';

const crypto = require('node:crypto');

const blockedHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);
const blockedDatabases = new Set(['sms_v3_test', 'sms_v3_dev', 'smsv3_test']);
const pooledPorts = new Set(['6543']);
const pooledQueryKeys = new Set(['connection_pool', 'connection_pool_mode', 'pool_mode', 'poolmode', 'pgbouncer', 'pooling']);

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSupabaseHost(hostname) {
  return /(?:\.supabase\.co|\.pooler\.supabase\.com)$/i.test(hostname);
}

function detectConnectionMode(url, provider) {
  const hostname = url.hostname.toLowerCase();
  const queryHasPoolSignal = [...url.searchParams.keys()].some((key) => pooledQueryKeys.has(key.toLowerCase())) ||
    [...url.searchParams.entries()].some(([key, value]) => pooledQueryKeys.has(key.toLowerCase()) && /^(1|true|transaction|session)$/i.test(value));
  if (pooledPorts.has(url.port) || /(^|[.-])(pooler|pgbouncer)([.-]|$)/i.test(hostname) || queryHasPoolSignal) return 'pooled';
  if (provider === 'supabase' && /^db\.[^.]+\.supabase\.co$/i.test(hostname)) return 'direct';
  return 'unknown';
}

function supabaseProjectRef(url, mode) {
  const hostname = url.hostname.toLowerCase();
  const directMatch = hostname.match(/^db\.([^.]+)\.supabase\.co$/i);
  if (directMatch) return directMatch[1];
  if (mode === 'pooled') {
    const username = decodeURIComponent(url.username || '');
    const usernameMatch = username.match(/^postgres\.([a-z0-9-]+)$/i);
    if (usernameMatch) return usernameMatch[1].toLowerCase();
  }
  return null;
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

  const provider = isSupabaseHost(hostname) ? 'supabase' : 'postgresql';
  const mode = detectConnectionMode(url, provider);
  return {
    provider,
    hostname,
    port: url.port || '5432',
    database,
    mode,
    projectRef: provider === 'supabase' ? supabaseProjectRef(url, mode) : null
  };
}

function assertDirectMigrationTarget(target) {
  if (target.mode === 'pooled') throw new Error('DIRECT_URL is configured as a pooled PostgreSQL connection');
  if (target.mode !== 'direct') throw new Error('DIRECT_URL connection mode could not be verified as direct');
  return target;
}

function normalizeLogicalTarget(databaseUrl, directUrl) {
  if (databaseUrl.mode === 'unknown') throw new Error('DATABASE_URL connection mode could not be verified');
  assertDirectMigrationTarget(directUrl);
  if (databaseUrl.provider !== directUrl.provider) throw new Error('Deployment target provider identities differ');
  if (databaseUrl.database !== directUrl.database) throw new Error('Deployment target database identities differ');

  if (databaseUrl.provider === 'supabase') {
    if (!databaseUrl.projectRef || !directUrl.projectRef) throw new Error('Deployment target project identity could not be verified');
    if (databaseUrl.projectRef !== directUrl.projectRef) throw new Error('Deployment target project identities differ');
    return { provider: 'supabase', projectRef: directUrl.projectRef, database: directUrl.database };
  }

  if (databaseUrl.hostname !== directUrl.hostname) throw new Error('Deployment target endpoint identity could not be verified');
  return { provider: databaseUrl.provider, endpoint: databaseUrl.hostname, database: databaseUrl.database };
}

function targetFingerprint(databaseUrl, directUrl) {
  const normalized = directUrl ? normalizeLogicalTarget(databaseUrl, directUrl) : databaseUrl;
  return hash(JSON.stringify(normalized));
}

function parseAndNormalize(env) {
  const databaseUrl = parseTarget('DATABASE_URL', env.DATABASE_URL);
  const directUrl = parseTarget('DIRECT_URL', env.DIRECT_URL);
  const normalized = normalizeLogicalTarget(databaseUrl, directUrl);
  return { databaseUrl, directUrl, normalized, fingerprint: targetFingerprint(normalized) };
}

function generateFingerprint({ env = process.env, log = console.log, error = console.error } = {}) {
  log(`DATABASE_URL_PRESENT=${Boolean(env.DATABASE_URL)}`);
  log(`DIRECT_URL_PRESENT=${Boolean(env.DIRECT_URL)}`);
  try {
    const { databaseUrl, directUrl, fingerprint } = parseAndNormalize(env);
    log(`DATABASE_CONNECTION_MODE=${databaseUrl.mode}`);
    log(`DIRECT_CONNECTION_MODE=${directUrl.mode}`);
    log('TARGET_PAIR_MATCH=true');
    log(`APPROVED_DATABASE_TARGET_FINGERPRINT=${fingerprint}`);
    return 0;
  } catch (reason) {
    error(`Deployment target bootstrap failed: ${reason.message}`);
    return 1;
  }
}

function verifyDeploymentTarget({ env = process.env, log = console.log, error = console.error } = {}) {
  log(`DATABASE_URL_PRESENT=${Boolean(env.DATABASE_URL)}`);
  log(`DIRECT_URL_PRESENT=${Boolean(env.DIRECT_URL)}`);

  let databaseUrl;
  let directUrl;
  try {
    ({ databaseUrl, directUrl } = parseAndNormalize(env));
  } catch (reason) {
    error(`Deployment target guard failed: ${reason.message}`);
    return 1;
  }

  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  const approved = env.APPROVED_DATABASE_TARGET_FINGERPRINT;
  const match = Boolean(approved) && approved === fingerprint;
  log(`DATABASE_MODE=${databaseUrl.mode}`);
  log(`DIRECT_MODE=${directUrl.mode}`);
  log(`TARGET_FINGERPRINT_MATCH=${match}`);
  if (!match) {
    error('Deployment target guard failed: approved fingerprint mismatch');
    return 1;
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = process.argv.includes('--generate-fingerprint') ? generateFingerprint() : verifyDeploymentTarget();
}

module.exports = {
  assertDirectMigrationTarget,
  detectConnectionMode,
  generateFingerprint,
  normalizeLogicalTarget,
  parseTarget,
  targetFingerprint,
  verifyDeploymentTarget
};
