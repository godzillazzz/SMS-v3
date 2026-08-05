'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function windowsCommandLine(command, args) {
  const quote = (value) => /[\s"]/.test(value) ? `"${value.replace(/(["\\])/g, '\\$1')}"` : value;
  return [command, ...args].map(quote).join(' ');
}

function sanitizeOutput(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => {
      if (/DATABASE_URL|DIRECT_URL|SUPABASE|PASSWORD|TOKEN|API[_ -]?KEY|SECRET/i.test(line)) return '[redacted environment output]';
      if (/datasource|database server|postgres(?:ql)?:\/\/|connection string|host|username|user|database|schema/i.test(line)) return '[redacted database output]';
      return line
        .replace(/(?:postgres(?:ql)?|mysql|sqlserver):\/\/[^\s"']+/gi, '[redacted database URL]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g, '[redacted host]')
        .replace(/\b[a-z0-9-]+\.(?:internal|local|invalid|com|net|org)(?::\d{2,5})?\b/gi, '[redacted host]')
        .replace(/(?:password|passwd|pwd|token|api[_-]?key|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
    })
    .filter(Boolean)
    .join('\n');
}

function extractMigrationNames(output) {
  return [...new Set(String(output || '').match(/\b\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*\b/g) || [])];
}

function extractPrismaErrorCodes(output) {
  return [...new Set(String(output || '').match(/\bP\d{4}\b/g) || [])];
}

function classifyMigrationStatus(output, exitCode, { knownMigrations = [] } = {}) {
  const text = String(output || '');
  const normalized = text.toLowerCase();
  const codes = extractPrismaErrorCodes(text);
  const migrationNames = extractMigrationNames(text);
  const known = new Set(knownMigrations);
  const upToDate = /database schema is up to date|no pending migrations|all migrations have been applied|already in sync|no migrations found/i.test(text);
  const pendingIndicator = !upToDate && /pending migration|not yet been applied|following migration(?:s)? .* applied|have not been applied/i.test(text);
  const connectionError = codes.some((code) => ['P1001', 'P1002', 'P1003', 'P1008', 'P1017'].includes(code))
    || /econnrefused|enotfound|connection (?:error|timed out|timeout)|timed out|timeout while|could not connect|server has closed/i.test(normalized);
  const failedMigration = codes.some((code) => ['P3009', 'P3018'].includes(code))
    || /failed migration|failed to apply migration|migration .* failed to apply/i.test(normalized);
  const historyDiverged = codes.some((code) => ['P3008', 'P3011', 'P3015', 'P3017', 'P3019'].includes(code))
    || /migration history|applied migration.*missing|missing from the migrations directory|migrations?.*(?:do not match|not match|diverg|differ)|database migrations? are out of sync/i.test(normalized);
  const migrationTableMissing = /(?:table|relation) ["'`]?_prisma_migrations["'`]? does not exist|_prisma_migrations.*(?:missing|not found)/i.test(text);
  const schemaOrConfigError = codes.includes('P1012')
    || /schema (?:validation|mismatch|error)|unknown (?:argument|field|enum)|invalid (?:datasource|provider|schema)|configuration error/i.test(normalized);

  let classification = 'UNKNOWN';
  if (connectionError) classification = 'CONNECTION_ERROR';
  else if (migrationTableMissing) classification = 'MIGRATION_TABLE_MISSING';
  else if (failedMigration) classification = 'FAILED_MIGRATION';
  else if (historyDiverged) classification = 'HISTORY_DIVERGED';
  else if (schemaOrConfigError) classification = 'SCHEMA_OR_CONFIG_ERROR';
  else if (pendingIndicator) {
    const allKnown = migrationNames.length > 0 && migrationNames.every((name) => known.has(name));
    classification = allKnown ? 'PENDING_MIGRATIONS_ONLY' : 'UNKNOWN';
  } else if (exitCode === 0 && upToDate) {
    classification = 'UP_TO_DATE';
  }

  return {
    classification,
    errorCodes: codes,
    migrationNames,
    pending: classification === 'PENDING_MIGRATIONS_ONLY',
    driftDetected: /drift|schema[\s-]+differs|schema[\s-]+does not match/i.test(text),
    migrationHistoryMismatch: historyDiverged,
    schemaMismatch: schemaOrConfigError,
    exitCode
  };
}

function loadKnownMigrations(migrationsDirectory = path.join(process.cwd(), 'prisma', 'migrations')) {
  try {
    return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function logStatusDiagnostics(diagnostics, log) {
  log(`PRISMA_MIGRATE_STATUS=${diagnostics.classification === 'UP_TO_DATE' || diagnostics.classification === 'PENDING_MIGRATIONS_ONLY' ? 'passed' : 'failed'}`);
  log(`MIGRATION_STATUS_CLASS=${diagnostics.classification}`);
  log(`PRISMA_ERROR_CODE=${diagnostics.errorCodes.join(',') || 'not_exposed'}`);
  log(`MIGRATION_NAME=${diagnostics.migrationNames.join(',') || 'not_exposed'}`);
  log(`DRIFT_DETECTED=${diagnostics.driftDetected ? 'true' : 'false'}`);
  log(`MIGRATION_HISTORY_MISMATCH=${diagnostics.migrationHistoryMismatch ? 'true' : 'false'}`);
  log(`SCHEMA_MISMATCH=${diagnostics.schemaMismatch ? 'true' : 'false'}`);
  log(`PENDING_MIGRATIONS=${diagnostics.pending ? 'true' : 'false'}`);
  log('STDERR_SANITIZED=true');
  log('RAW_DATABASE_OUTPUT_EMITTED=false');
}

function runMigrationCommand(mode, { env = process.env, run = spawnSync, log = console.log, error = console.error, allowPending = false, knownMigrations = loadKnownMigrations() } = {}) {
  if (!['status', 'deploy'].includes(mode)) {
    error('Prisma migration command must be status or deploy');
    return 1;
  }
  if (!env.DATABASE_URL || !env.DIRECT_URL) {
    error('Prisma migration guard failed: DATABASE_URL and DIRECT_URL are required');
    return 1;
  }

  const command = npxCommand();
  const args = ['--no-install', 'prisma', 'migrate', mode];
  const isWindowsScript = process.platform === 'win32';
  const executable = isWindowsScript ? (env.ComSpec || process.env.ComSpec || 'cmd.exe') : command;
  const executableArgs = isWindowsScript ? ['/d', '/s', '/c', windowsCommandLine(command, args)] : args;
  const result = run(executable, executableArgs, {
    env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe']
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  if (mode === 'status') {
    const diagnostics = classifyMigrationStatus(output, exitCode, { knownMigrations });
    logStatusDiagnostics(diagnostics, log);
    if (diagnostics.classification === 'UP_TO_DATE') return 0;
    if (allowPending && diagnostics.classification === 'PENDING_MIGRATIONS_ONLY') return 0;
    error(`Prisma migration status blocked: ${diagnostics.classification}`);
    return 1;
  }
  const safeOutput = sanitizeOutput(output);
  if (safeOutput) log(safeOutput);
  if (exitCode !== 0) {
    error(`Prisma migrate ${mode} failed (exit=${exitCode})`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  const mode = process.argv[2];
  process.exitCode = runMigrationCommand(mode, { allowPending: process.argv.includes('--allow-pending') });
}

module.exports = { classifyMigrationStatus, extractMigrationNames, extractPrismaErrorCodes, loadKnownMigrations, runMigrationCommand, sanitizeOutput };
