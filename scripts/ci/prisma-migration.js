'use strict';

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
      if (/datasource|database server|postgres(?:ql)?:\/\/|connection string/i.test(line)) return '[redacted database output]';
      return line;
    })
    .filter(Boolean)
    .join('\n');
}

function runMigrationCommand(mode, { env = process.env, run = spawnSync, log = console.log, error = console.error } = {}) {
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
  const safeOutput = sanitizeOutput(output);
  if (safeOutput) log(safeOutput);
  if (typeof result.status !== 'number' || result.status !== 0) {
    error(`Prisma migrate ${mode} failed (exit=${typeof result.status === 'number' ? result.status : 1})`);
    return 1;
  }
  if (mode === 'status' && !/database schema is up to date|no pending migrations|all migrations have been applied|already in sync/i.test(output)) {
    error('Prisma migration status did not confirm zero pending migrations');
    return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = runMigrationCommand(process.argv[2]);

module.exports = { sanitizeOutput, runMigrationCommand };
