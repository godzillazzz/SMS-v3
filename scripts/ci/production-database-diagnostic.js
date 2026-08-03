'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('dotenv');

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
  const url = new URL(rawUrl);
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

function formatTargetDiagnostics(values) {
  const summary = classifyTargetValues(values);
  return [
    `DATABASE_URL_PRESENT=${summary.databaseUrl.present}`,
    `DATABASE_URL_MODE=${summary.databaseUrl.mode}`,
    `DATABASE_URL_PORT=${summary.databaseUrl.port}`,
    `DIRECT_URL_PRESENT=${summary.directUrl.present}`,
    `DIRECT_URL_MODE=${summary.directUrl.mode}`,
    `DIRECT_URL_PORT=${summary.directUrl.port}`,
    `LOGICAL_PAIR_MATCH=${summary.logicalPairMatch}`
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
  else if (codes.includes('P1012') || /schema|datasource|configuration|invalid provider/i.test(normalized)) classification = 'CONFIG_ERROR';
  else if (exitCode === 0) classification = 'PASS';
  return { classification, errorCode: codes[0] || 'none', safeSummary: classification === 'PASS' ? 'SELECT 1 completed.' : `Database connectivity ${classification.toLowerCase()}.` };
}

function parsePulledEnvironment(filePath) {
  return parse(fs.readFileSync(filePath, 'utf8'));
}

function validateTargetSha(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ''));
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function probeDatabase(filePath, { schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma'), timeoutMs = 10000 } = {}) {
  const values = parsePulledEnvironment(filePath);
  if (!values.DATABASE_URL) return { ...classifyConnectivityOutput('DATABASE_URL missing', 1), values };
  if (!values.DIRECT_URL) return { ...classifyConnectivityOutput('DIRECT_URL missing', 1), values };

  const tempSchemaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-schema-'));
  const tempSchema = path.join(tempSchemaDir, 'schema.prisma');
  try {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const withoutDirectUrl = schema.replace(/^\s*directUrl\s*=\s*env\(["']DIRECT_URL["']\)\s*\r?\n/m, '');
    if (withoutDirectUrl === schema) return { ...classifyConnectivityOutput('DIRECT_URL schema removal failed', 1), values };
    fs.writeFileSync(tempSchema, withoutDirectUrl, { mode: 0o600 });
    const result = spawnSync(npxCommand(), ['--no-install', 'prisma', 'db', 'execute', '--stdin', '--schema', tempSchema], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: values.DATABASE_URL, DIRECT_URL: values.DIRECT_URL },
      input: 'SELECT 1;',
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true
    });
    const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
    return { ...classifyConnectivityOutput(output, typeof result.status === 'number' ? result.status : 1, result.error?.code === 'ETIMEDOUT'), values };
  } finally {
    fs.rmSync(tempSchemaDir, { recursive: true, force: true });
  }
}

function main() {
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
    console.log(formatTargetDiagnostics(parsePulledEnvironment(filePath)));
    return 0;
  }
  const result = probeDatabase(filePath);
  console.log(`CONNECTIVITY=${result.classification === 'PASS' ? 'PASS' : 'FAIL'}`);
  console.log(`PRISMA_ERROR_CODE=${result.errorCode}`);
  console.log(`CONNECTION_CLASSIFICATION=${result.classification}`);
  console.log(`SAFE_SUMMARY=${result.safeSummary}`);
  return result.classification === 'PASS' ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  classifyConnectivityOutput,
  classifyTargetValues,
  displayMode,
  formatTargetDiagnostics,
  parsePulledEnvironment,
  probeDatabase,
  redactDiagnosticText,
  summarizeTarget,
  validateTargetSha
};
