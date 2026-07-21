/* Restore verification is restricted to a random, disposable database on localhost. */
require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: 'ignore', shell: false });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with a non-zero status.`)));
});
function localPostgresEnvironment(connectionString) {
  const connection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !localHosts.has(connection.hostname)) throw new Error('Restore verification requires a local PostgreSQL server.');
  const env = { ...process.env };
  delete env.DATABASE_URL; delete env.DIRECT_URL; delete env.VERIFY_ADMIN_DATABASE_URL;
  Object.assign(env, {
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGSSLMODE: connection.searchParams.get('sslmode') || 'prefer'
  });
  return env;
}
const checksum = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  input.on('error', reject); input.on('data', (chunk) => hash.update(chunk)); input.on('end', () => resolve(hash.digest('hex')));
});
async function validateChecksum(backup, sidecar) {
  const expected = (await fsp.readFile(sidecar, 'utf8')).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Backup checksum file is invalid.');
  const actual = await checksum(backup);
  if (!crypto.timingSafeEqual(Buffer.from(expected.toLowerCase()), Buffer.from(actual.toLowerCase()))) throw new Error('Backup checksum does not match.');
}

async function main() {
  const backup = process.argv[2] && path.resolve(process.argv[2]);
  const sidecar = process.argv[3] ? path.resolve(process.argv[3]) : backup && `${backup}.sha256`;
  if (!backup || !process.env.VERIFY_ADMIN_DATABASE_URL) throw new Error('A backup file and VERIFY_ADMIN_DATABASE_URL are required.');
  const adminEnv = localPostgresEnvironment(process.env.VERIFY_ADMIN_DATABASE_URL);
  const database = `smsv3_verify_${crypto.randomUUID().replace(/-/g, '')}`;
  const targetEnv = { ...adminEnv, PGDATABASE: database };
  let created = false;
  let primaryError;
  let stage = 'checksum';
  try {
    await validateChecksum(backup, sidecar);
    stage = 'custom-format-validation';
    await run('pg_restore', ['--list', backup], adminEnv);
    stage = 'database-create';
    await run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-c', `CREATE DATABASE ${database}`], adminEnv);
    created = true;
    stage = 'restore-preparation';
    await run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA IF EXISTS public CASCADE'], targetEnv);
    stage = 'restore';
    await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', database, backup], targetEnv);
    const verificationSql = `DO $$ BEGIN
      IF to_regclass('public."_prisma_migrations"') IS NULL OR to_regclass('public."users"') IS NULL OR to_regclass('public."employees"') IS NULL THEN
        RAISE EXCEPTION 'Required restored tables are missing';
      END IF;
      IF (SELECT count(*) FROM "_prisma_migrations") < 1 OR (SELECT count(*) FROM "users") < 1 OR (SELECT count(*) FROM "employees") < 1 THEN
        RAISE EXCEPTION 'Required sample rows are missing';
      END IF;
    END $$;`;
    stage = 'table-and-row-verification';
    await run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-c', verificationSql], targetEnv);
  } catch (error) {
    error.safeStage = stage;
    primaryError = error;
  } finally {
    if (created) {
      try { await run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`], adminEnv); }
      catch (cleanupError) { cleanupError.safeStage = 'cleanup'; primaryError ||= cleanupError; }
    }
  }
  if (primaryError) throw primaryError;
  console.log('Backup checksum and disposable restore verification completed.');
}

main().catch((error) => { console.error(`Backup restore verification failed during ${error.safeStage || 'configuration'}.`); process.exitCode = 1; });
