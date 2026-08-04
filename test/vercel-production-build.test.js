const test = require('node:test');
const assert = require('node:assert/strict');

const { runBuild, sanitizeOutput } = require('../scripts/vercel-production-build');

function createRunner(failFor = new Map()) {
  const calls = [];
  const run = (command, args) => {
    const call = { command, args };
    calls.push(call);
    const key = args.includes('migrate') && args.includes('deploy')
      ? 'migration'
      : args.includes('--prefix') && args.includes('build')
        ? 'application-build'
        : args.join(' ');
    return { status: failFor.get(key) || 0 };
  };
  return { calls, run };
}

function runWith(env, runner) {
  const logs = [];
  const errors = [];
  const status = runBuild({
    env,
    run: runner.run,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  });
  return { status, logs, errors };
}

test('local build skips production migration', () => {
  const runner = createRunner();
  const result = runWith({}, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
  assert.match(result.logs[0], /migration skipped/);
});

test('preview build skips production migration', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: 'present-only' }, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
});

test('production build does not require database URLs', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production' }, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
  assert.match(result.logs[1], /build-only/);
});

test('production build rejects an unexpected project', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_ID: 'unexpected', DATABASE_URL: 'present-only' }, runner);

  assert.equal(result.status, 1);
  assert.equal(runner.calls.length, 0);
  assert.match(result.errors[0], /project mismatch/);
});

test('production build remains build-only with migration gate metadata', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_ID: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s', CI_MIGRATION_COMPLETED: 'true' }, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
  assert.match(result.logs[1], /build-only/);
});

test('production build runs generate and application build without migration', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'present-only', DIRECT_URL: 'present-only' }, runner);
  const commands = runner.calls.map(({ args }) => args.join(' '));

  assert.equal(result.status, 0);
  const generateIndex = runner.calls.findIndex(({ args }) => args.includes('generate'));
  const migrationIndex = runner.calls.findIndex(({ args }) => args.includes('migrate') && args.includes('deploy'));
  assert.equal(migrationIndex, -1);
  assert.ok(generateIndex >= 0);
  assert.ok(commands.includes('--prefix frontend run build'));
});

test('production build does not fail when DIRECT_URL is missing', () => {
  const runner = createRunner();
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'present-only' }, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
});

test('migration command is never called even if a migration failure is configured', () => {
  const runner = createRunner(new Map([['migration', 17]]));
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'present-only', DIRECT_URL: 'present-only' }, runner);

  assert.equal(result.status, 0);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
});

test('application build failure fails the deployment', () => {
  const runner = createRunner(new Map([['application-build', 23]]));
  const result = runWith({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'present-only', DIRECT_URL: 'present-only' }, runner);

  assert.equal(result.status, 1);
  assert.equal(runner.calls.some(({ args }) => args.includes('migrate') && args.includes('deploy')), false);
  assert.match(result.errors.at(-1), /Application build failed/);
});

test('database-oriented child output is redacted', () => {
  const output = sanitizeOutput('Datasource "db": PostgreSQL database "app" at "db.example.invalid:5432"\nApplying migration');

  assert.doesNotMatch(output, /db\.example\.invalid/);
  assert.match(output, /Applying migration/);
});
