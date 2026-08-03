'use strict';

const fs = require('node:fs');
const { parse } = require('dotenv');
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
  const url = new URL(normalizeConnectionValue(rawUrl).normalizedValue);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('not-postgresql');
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

function readRawEnvironment(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const values = {};
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (match) values[key] = match[1];
  }
  return values;
}

function normalizeConnectionValue(rawValue) {
  const original = String(rawValue || '');
  const trimmed = original.trim();
  const quoted = trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
  const normalizedValue = quoted ? trimmed.slice(1, -1).trim() : trimmed;
  return { original, trimmed, normalizedValue, quoted, hasControlCharacters: /[\r\n]/.test(original) };
}

function parseConnectionUrl(value, { raw = false } = {}) {
  const normalized = normalizeConnectionValue(value);
  if (raw && normalized.quoted) return { ok: false, reason: 'QUOTED_VALUE' };
  if (raw && normalized.hasControlCharacters) return { ok: false, reason: 'CONTROL_CHARACTERS' };
  try {
    const url = new URL(raw ? normalized.trimmed : normalized.normalizedValue);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return { ok: false, reason: 'UNSUPPORTED_PROTOCOL' };
    const hasHost = Boolean(url.hostname);
    const hasUser = Boolean(url.username);
    const hasPassword = Boolean(url.password);
    const hasDatabase = Boolean(url.pathname && url.pathname !== '/');
    if (!hasHost) return { ok: false, reason: 'MISSING_HOST' };
    if (!hasDatabase) return { ok: false, reason: 'MISSING_DATABASE' };
    return {
      ok: true,
      protocol: url.protocol,
      port: url.port || '5432',
      hasHost,
      hasUser,
      hasPassword,
      hasDatabase,
      normalizedValue: normalized.normalizedValue
    };
  } catch {
    return { ok: false, reason: 'MALFORMED_URL' };
  }
}

function connectionDiagnostics(rawValue) {
  const raw = parseConnectionUrl(rawValue, { raw: true });
  const normalized = parseConnectionUrl(rawValue);
  return { raw, normalized };
}

function parseDiagnosticsFor(values, rawValues = values) {
  return {
    database: connectionDiagnostics(rawValues.DATABASE_URL || values.DATABASE_URL),
    direct: connectionDiagnostics(rawValues.DIRECT_URL || values.DIRECT_URL)
  };
}

function classifyTargetValues(values) {
  const database = summarizeTarget(values.DATABASE_URL);
  const direct = summarizeTarget(values.DIRECT_URL);
  let logicalPairMatch = 'unknown';
  if (database.target && direct.target && database.target.provider === 'supabase' && direct.target.provider === 'supabase') {
    try {
      if (database.target.projectRef !== direct.target.projectRef || database.target.database !== direct.target.database) throw new Error('identity-mismatch');
      logicalPairMatch = 'true';
    } catch (reason) {
      logicalPairMatch = /identit(?:y|ies)|database identities|provider identities/i.test(reason.message) ? 'false' : 'unknown';
    }
  }
  return {
    databaseUrl: { present: database.present, mode: database.mode, port: database.port },
    directUrl: { present: direct.present, mode: direct.mode, port: direct.port },
    logicalPairMatch
  };
}

function formatTargetDiagnostics(values, rawValues = values) {
  const summary = classifyTargetValues(values);
  const parsed = parseDiagnosticsFor(values, rawValues);
  const lines = [
    `DATABASE_URL_RAW_PARSE=${parsed.database.raw.ok ? 'PASS' : 'FAIL'}`,
    `DATABASE_URL_NORMALIZED_PARSE=${parsed.database.normalized.ok ? 'PASS' : 'FAIL'}`,
    `DIRECT_URL_RAW_PARSE=${parsed.direct.raw.ok ? 'PASS' : 'FAIL'}`,
    `DIRECT_URL_NORMALIZED_PARSE=${parsed.direct.normalized.ok ? 'PASS' : 'FAIL'}`
  ];
  for (const [name, result] of [['DATABASE_URL', parsed.database.normalized], ['DIRECT_URL', parsed.direct.normalized]]) {
    lines.push(`${name}_PARSE_REASON=${result.ok ? 'PASS' : result.reason}`);
    if (result.ok) {
      lines.push(`${name}_PROTOCOL=${result.protocol}`);
      lines.push(`${name}_PARSED_PORT=${result.port}`);
      lines.push(`${name}_HAS_HOST=${result.hasHost}`);
      lines.push(`${name}_HAS_USER=${result.hasUser}`);
      lines.push(`${name}_HAS_PASSWORD=${result.hasPassword}`);
      lines.push(`${name}_HAS_DATABASE=${result.hasDatabase}`);
    }
  }
  lines.push(
    `DATABASE_URL_PRESENT=${summary.databaseUrl.present}`,
    `DATABASE_URL_MODE=${summary.databaseUrl.mode}`,
    `DATABASE_URL_PORT=${summary.databaseUrl.port}`,
    `DIRECT_URL_PRESENT=${summary.directUrl.present}`,
    `DIRECT_URL_MODE=${summary.directUrl.mode}`,
    `DIRECT_URL_PORT=${summary.directUrl.port}`,
    `LOGICAL_PAIR_MATCH=${summary.logicalPairMatch}`
  );
  return lines.join('\n');
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
  else if (codes.includes('P1012') || /schema|datasource|configuration|invalid provider|malformed_url|missing_(?:host|database)|unsupported_protocol|quoted_value|control_characters/i.test(normalized)) classification = 'CONFIG_ERROR';
  else if (exitCode === 0) classification = 'PASS';
  const safeReason = normalized.match(/(?:malformed_url|missing_(?:host|database)|unsupported_protocol|quoted_value|control_characters)/i)?.[0]?.toUpperCase();
  return {
    classification,
    errorCode: codes[0] || 'none',
    safeSummary: classification === 'PASS' ? 'SELECT 1 completed.' : safeReason ? `Database connection configuration ${safeReason}.` : `Database connectivity ${classification.toLowerCase()}.`
  };
}

function parsePulledEnvironment(filePath) {
  return parse(fs.readFileSync(filePath, 'utf8'));
}

function validateTargetSha(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ''));
}

async function probeDatabase(filePath, { timeoutMs = 10000, clientFactory = (url) => new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs }) } = {}) {
  const values = parsePulledEnvironment(filePath);
  if (!values.DATABASE_URL) return { ...classifyConnectivityOutput('DATABASE_URL missing', 1), values };
  if (!values.DIRECT_URL) return { ...classifyConnectivityOutput('DIRECT_URL missing', 1), values };
  const rawValues = readRawEnvironment(filePath);
  const parsed = parseDiagnosticsFor(values, rawValues);
  if (!parsed.database.normalized.ok) {
    return { ...classifyConnectivityOutput(`DATABASE_URL ${parsed.database.normalized.reason}`, 1), values };
  }
  let client;
  let timer;
  try {
    client = clientFactory(parsed.database.normalized.normalizedValue);
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
        // Preserve the one-shot query result if disconnect itself fails.
      }
    }
  }
}

async function main() {
  const [command, filePath] = process.argv.slice(2);
  if (command === 'validate-sha') {
    if (!validateTargetSha(filePath)) {
      console.error('TARGET_SHA_INVALID');
      return 1;
    }
    console.log('TARGET_SHA_FORMAT=VALID');
    return 0;
  }
  if (!filePath || !['format', 'probe'].includes(command)) {
    console.error('Usage: production-database-diagnostic.js <format|probe> <env-file>');
    return 2;
  }
  if (command === 'format') {
    console.log(formatTargetDiagnostics(parsePulledEnvironment(filePath), readRawEnvironment(filePath)));
    return 0;
  }
  const result = await probeDatabase(filePath);
  console.log(`CONNECTIVITY=${result.classification === 'PASS' ? 'PASS' : 'FAIL'}`);
  console.log(`PRISMA_ERROR_CODE=${result.errorCode}`);
  console.log(`CONNECTION_CLASSIFICATION=${result.classification}`);
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
  connectionDiagnostics,
  displayMode,
  formatTargetDiagnostics,
  parsePulledEnvironment,
  probeDatabase,
  redactDiagnosticText,
  summarizeTarget,
  normalizeConnectionValue,
  validateTargetSha
};
