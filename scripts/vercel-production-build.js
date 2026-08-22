'use strict';

const { spawnSync } = require('node:child_process');

const EXPECTED_PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';

function packageCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

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
      if (/DATABASE_URL|DIRECT_URL|SUPABASE|PASSWORD|TOKEN|API[_ -]?KEY|SECRET/i.test(line)) {
        return '[redacted environment output]';
      }
      if (/datasource|database server|postgres(?:ql)?:\/\/|connection string/i.test(line)) {
        return '[redacted database output]';
      }
      return line;
    })
    .filter(Boolean)
    .join('\n');
}

function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  const isWindowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const executable = isWindowsScript ? (env.ComSpec || process.env.ComSpec || 'cmd.exe') : command;
  const executableArgs = isWindowsScript ? ['/d', '/s', '/c', windowsCommandLine(command, args)] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const safeOutput = sanitizeOutput(output);
  if (safeOutput) console.log(safeOutput);
  return { status: typeof result.status === 'number' ? result.status : 1 };
}

function runStep(label, command, args, { env, run, log, error }) {
  log(`${label} started`);
  const result = run(command, args, { env });
  if (result.status !== 0) {
    error(`${label} failed (exit=${result.status})`);
    return false;
  }
  log(`${label} passed`);
  return true;
}

function runApplicationBuild({ env, run, log, error }) {
  const npm = packageCommand();
  const steps = [
    ['Application runtime check', process.execPath, ['--version']],
    ['Prisma generate', npxCommand(), ['--no-install', 'prisma', 'generate']],
    ['Application build', npm, ['--prefix', 'frontend', 'run', 'build']],
  ];

  for (const [label, command, args] of steps) {
    if (!runStep(label, command, args, { env, run, log, error })) return 1;
  }
  return 0;
}

function runBuild({ env = process.env, run = runCommand, log = console.log, error = console.error } = {}) {
  if (env.VERCEL !== '1') {
    log('Non-Vercel build: production migration skipped');
    return runApplicationBuild({ env, run, log, error });
  }

  if (!env.VERCEL_ENV) {
    error('Vercel build guard failed: VERCEL_ENV is missing');
    return 1;
  }

  if (env.VERCEL_ENV !== 'production') {
    log(`Vercel ${env.VERCEL_ENV} build: production migration skipped`);
    if (env.VERCEL_ENV === 'preview') {
      if (!runStep('Preview migration gate', process.execPath, ['scripts/preview-migration-gate.js'], { env, run, log, error })) return 1;
    }
    return runApplicationBuild({ env, run, log, error });
  }

  if (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== EXPECTED_PROJECT_ID) {
    error('Vercel build guard failed: project mismatch');
    return 1;
  }

  log('Production environment guard passed');
  log('Vercel build is build-only; database migration runs in the protected deployment workflow');

  return runApplicationBuild({ env, run, log, error });
}

if (require.main === module) {
  process.exitCode = runBuild();
}

module.exports = {
  EXPECTED_PROJECT_ID,
  runBuild,
  runApplicationBuild,
  sanitizeOutput,
};
