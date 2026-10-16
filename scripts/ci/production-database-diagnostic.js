'use strict';

const { Client } = require('pg');

const pooledQueryKeys = new Set(['connection_pool', 'connection_pool_mode', 'pool_mode', 'poolmode', 'pgbouncer', 'pooling', 'mode']);
const supabaseSessionHostPattern = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/i;

function isSupabaseHost(hostname) {
  return /(?:\.supabase\.co|\.pooler\.supabase\.com)$/i.test(hostname);
}

function queryConnectionMode(url) {
  let mode = null;
  for (const [key, value] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = value.toLowerCase();
    if (!pooledQueryKeys.has(normalizedKey)) continue;
    if ((normalizedKey === 'pool_mode' || normalizedKey === 'mode') && normalizedValue === 'session' && !mode) {
      mode = 'session';
      continue;
    }
    if ((normalizedKey === 'pool_mode' || normalizedKey === 'mode') && normalizedValue === 'transaction') return 'pooled';
    return 'unknown';
  }
  return mode;
}

function parseTarget(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('unsupported-protocol');
  const hostname = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!hostname || !database) throw new Error('missing-identity');
  const provider = isSupabaseHost(hostname) ? 'supabase' : 'unknown';
  const port = url.port || '5432';
  const queryMode = queryConnectionMode(url);
  const mode = port === '6543' || queryMode === 'pooled' ? 'pooled'
    : queryMode === 'unknown' ? 'unknown'
      : provider === 'supabase' && /^db\.[a-z0-9-]+\.supabase\.co$/i.test(hostname) && port === '5432' ? 'direct'
        : provider === 'supabase' && supabaseSessionHostPattern.test(hostname) && port === '5432' ? 'verified-supabase-session'
          : 'unknown';
  const directMatch = hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i);
  const usernameMatch = decodeURIComponent(url.username || '').match(/^[^.\s@]+\.([a-z0-9-]+)$/i);
  const projectRef = directMatch?.[1]?.toLowerCase() || usernameMatch?.[1]?.toLowerCase() || null;
  return { provider, port, database, mode, projectRef };
}

function displayMode(target) {
  if (target.provider !== 'supabase') return 'unknown';
  if (target.mode === 'pooled' && target.port === '6543') return 'transaction-pooler';
  if (target.mode === 'verified-supabase-session' && target.port === '5432') return 'verified-supabase-session';
  if (target.mode === 'direct' && target.port === '5432') return 'direct';
  return 'unknown';
}

function summarizeTarget(rawUrl) {
  if (!rawUrl) return { present: false, mode: 'unknown', port: 'unknown', target: null };
  try {
    const target = parseTarget(rawUrl);
    return { present: true, mode: displayMode(target), port: ['5432', '6543'].includes(target.port) ? target.port : 'unknown', target };
  } catch {
    return { present: true, mode: 'unknown', port: 'unknown', target: null };
  }
}

function classifyTargetValues(values) {
  const database = summarizeTarget(values.DATABASE_URL);
  const direct = summarizeTarget(values.DIRECT_URL);
  let logicalPairMatch = 'unknown';
  if (database.target && direct.target && database.target.provider === 'supabase' && direct.target.provider === 'supabase') {
    logicalPairMatch = database.target.projectRef === direct.target.projectRef && database.target.database === direct.target.database ? 'true' : 'false';
  }
  return {
    databaseUrl: { present: database.present, mode: database.mode, port: database.port },
    directUrl: { present: direct.present, mode: direct.mode, port: direct.port },
    logicalPairMatch
  };
}

function parseProcessUrl(rawValue) {
  const value = String(rawValue || '');
  try {
    const url = new URL(value);
    const protocol = url.protocol === 'postgres:' ? 'postgres' : url.protocol === 'postgresql:' ? 'postgresql' : 'other';
    if (protocol === 'other') return { ok: false, protocol, reason: 'UNSUPPORTED_PROTOCOL' };
    return {
      ok: true,
      protocol,
      port: url.port || '5432',
      hasHost: Boolean(url.hostname),
      hasUser: Boolean(url.username),
      hasPassword: Boolean(url.password),
      hasDatabase: Boolean(url.pathname && url.pathname !== '/')
    };
  } catch {
    return { ok: false, protocol: 'other', reason: 'MALFORMED_URL' };
  }
}

function lengthBucket(value) {
  const length = String(value || '').length;
  if (length < 100) return '0-99';
  if (length < 200) return '100-199';
  if (length < 300) return '200-299';
  return '300+';
}

function formatProcessEnvironment(values = process.env) {
  const databaseUrl = String(values.DATABASE_URL || '');
  const directUrl = String(values.DIRECT_URL || '');
  const database = parseProcessUrl(databaseUrl);
  const direct = parseProcessUrl(directUrl);
  const target = classifyTargetValues(values);
  const injection = databaseUrl && directUrl ? 'PASS' : 'FAIL';
  const uriParse = database.ok && direct.ok ? 'PASS' : 'FAIL';
  return [
    `ENV_INJECTION=${injection}`,
    `DATABASE_URL_PRESENT=${Boolean(databaseUrl)}`,
    `DATABASE_URL_PROTOCOL=${database.protocol}`,
    `DATABASE_URL_PARSE=${database.ok ? 'PASS' : 'FAIL'}`,
    `DATABASE_URL_PORT=${database.ok ? database.port : 'unknown'}`,
    `DATABASE_URL_LENGTH=${lengthBucket(databaseUrl)}`,
    `DIRECT_URL_PRESENT=${Boolean(directUrl)}`,
    `DIRECT_URL_PROTOCOL=${direct.protocol}`,
    `DIRECT_URL_PARSE=${direct.ok ? 'PASS' : 'FAIL'}`,
    `DIRECT_URL_PORT=${direct.ok ? direct.port : 'unknown'}`,
    `DIRECT_URL_LENGTH=${lengthBucket(directUrl)}`,
    `URI_PARSE=${uriParse}`,
    `LOGICAL_PAIR_MATCH=${target.logicalPairMatch}`
  ].join('\n');
}

function redactDiagnosticText(value, secretValues = []) {
  let text = String(value || '');
  for (const secret of secretValues.filter(Boolean)) text = text.split(String(secret)).join('[redacted-secret]');
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted-token]')
    .replace(/(?:postgres(?:ql)?|mysql|sqlserver):\/\/[^\s"'<>]+/gi, '[redacted-connection-string]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(?:host|hostname|server|address|user(?:name)?|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\?.*?(?=\s|$)/g, '[redacted-query]')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPrismaCodes(value) {
  return [...new Set(String(value || '').match(/\bP\d{4}\b/g) || [])];
}

function classifyConnectivityOutput(output, exitCode, timedOut = false) {
  const text = String(output || '');
  const normalized = text.toLowerCase();
  const codes = extractPrismaCodes(text);
  let classification = 'UNKNOWN';
  if (codes.includes('P2024') || /pool timeout|connection pool|pool exhausted/i.test(normalized)) classification = 'POOL_EXHAUSTED';
  else if (timedOut || codes.includes('P1002') || codes.includes('P2028') || /timed out|timeout/i.test(normalized)) classification = 'TIMEOUT';
  else if (codes.includes('P1001') || /econnrefused|enotfound|could not connect|connection refused|database unavailable/i.test(normalized)) classification = 'CONNECTION_ERROR';
  else if (/malformed_url|unsupported_protocol|configuration|invalid provider/i.test(normalized)) classification = 'CONFIG_ERROR';
  else if (exitCode === 0) classification = 'PASS';
  return { classification, errorCode: codes[0] || 'none', safeSummary: classification === 'PASS' ? 'SELECT 1 completed.' : `Database connectivity ${classification.toLowerCase()}.` };
}

async function probeDatabase(values = process.env, { timeoutMs = 10000, clientFactory = (url) => new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs }) } = {}) {
  const databaseUrl = String(values.DATABASE_URL || '');
  const parsed = parseProcessUrl(databaseUrl);
  if (!parsed.ok) return { ...classifyConnectivityOutput(parsed.reason, 1), values };
  let client;
  let timer;
  try {
    client = clientFactory(databaseUrl);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('database connection timeout');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeoutMs);
    });
    await client.connect();
    await Promise.race([client.query('SELECT 1'), timeout]);
    return { ...classifyConnectivityOutput('', 0), values };
  } catch (error) {
    const output = redactDiagnosticText([error?.code, error?.message].filter(Boolean).join(' '));
    return { ...classifyConnectivityOutput(output, 1, error?.code === 'ETIMEDOUT'), values };
  } finally {
    if (timer) clearTimeout(timer);
    if (client) {
      try {
        await client.end();
      } catch {
      }
    }
  }
}

async function main() {
  const command = process.argv[2];
  if (command !== 'diagnose') {
    console.error('Usage: production-database-diagnostic.js diagnose');
    return 2;
  }
  console.log(formatProcessEnvironment(process.env));
  const database = parseProcessUrl(process.env.DATABASE_URL);
  const result = await probeDatabase(process.env);
  console.log(`SELECT_1=${result.classification === 'PASS' ? 'PASS' : database.ok ? 'FAIL' : 'NOT_RUN'}`);
  console.log(`PRISMA_ERROR_CODE=${result.errorCode}`);
  console.log(`SAFE_ERROR_CATEGORY=${result.classification}`);
  console.log(`SAFE_SUMMARY=${result.safeSummary}`);
  return result.classification === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  classifyConnectivityOutput,
  classifyTargetValues,
  displayMode,
  formatProcessEnvironment,
  lengthBucket,
  parseProcessUrl,
  parseTarget,
  probeDatabase,
  redactDiagnosticText,
  summarizeTarget
};
