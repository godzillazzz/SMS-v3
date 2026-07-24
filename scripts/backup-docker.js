/*
 * Creates a PostgreSQL custom-format backup with the official PostgreSQL
 * Docker image. Connection components are passed as environment variables and
 * are never included in command arguments or console output.
 */
require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const checksum = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  input.on('error', reject);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => resolve(hash.digest('hex')));
});

const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += chunk.toString('utf8');
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else {
      const error = new Error('Dockerized PostgreSQL backup command failed.');
      error.safeCategory = classifyFailure(stderr);
      reject(error);
    }
  });
});

function classifyFailure(stderr) {
  if (/server version.*pg_dump version|aborting because of server version mismatch/i.test(stderr)) return 'CLIENT_VERSION_MISMATCH';
  if (/password authentication failed|28P01/i.test(stderr)) return 'AUTHENTICATION';
  if (/permission denied for (table|schema|sequence|database)|must be owner/i.test(stderr)) return 'DATABASE_PRIVILEGE';
  if (/could not translate host name|name or service not known/i.test(stderr)) return 'DNS';
  if (/timeout expired|connection timed out/i.test(stderr)) return 'TIMEOUT';
  if (/certificate|ssl|tls/i.test(stderr)) return 'TLS';
  if (/permission denied|mount|no such file or directory/i.test(stderr)) return 'FILESYSTEM_OR_VOLUME';
  return 'UNKNOWN';
}

function postgresEnvironment(connectionString) {
  const connection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('The backup connection must use PostgreSQL.');
  }
  if (!connection.hostname || !connection.username || connection.pathname.length < 2) {
    throw new Error('The backup connection is incomplete.');
  }

  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  delete env.BACKUP_DATABASE_URL;
  Object.assign(env, {
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGSSLMODE: connection.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: connection.searchParams.get('connect_timeout') || '15'
  });
  return env;
}

async function main() {
  const connection = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!connection) throw new Error('A backup database connection is required.');

  const directory = path.resolve(process.env.BACKUP_DIRECTORY || './backups');
  await fsp.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filename = `smsv3-pre-legacy-migration-${timestamp}.dump`;
  const partial = path.join(directory, `${filename}.partial`);
  const completed = path.join(directory, filename);
  const sidecar = `${completed}.sha256`;
  const pgEnv = postgresEnvironment(connection);
  const dockerEnvironmentNames = [
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGSSLMODE',
    'PGCONNECT_TIMEOUT'
  ];
  const dockerImage = process.env.BACKUP_POSTGRES_IMAGE || 'postgres:17-alpine';
  const dockerArgs = [
    'run',
    '--rm',
    ...dockerEnvironmentNames.flatMap((name) => ['-e', name]),
    '-v',
    `${directory}:/backup`,
    dockerImage,
    'sh',
    '-c',
    `pg_dump --format=custom --file=/backup/${filename}.partial && pg_restore --list /backup/${filename}.partial >/dev/null`
  ];

  try {
    await run('docker', dockerArgs, pgEnv);
    await fsp.rename(partial, completed);
    const digest = await checksum(completed);
    await fsp.writeFile(sidecar, `${digest}  ${filename}\n`, { flag: 'wx' });
    const actual = await checksum(completed);
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(actual))) {
      throw new Error('Backup checksum validation failed.');
    }
    console.log('BACKUP_CREATE=PASS');
    console.log('CUSTOM_FORMAT=PASS');
    console.log('CHECKSUM=PASS');
  } catch (error) {
    await Promise.allSettled([
      fsp.rm(partial, { force: true }),
      fsp.rm(completed, { force: true }),
      fsp.rm(sidecar, { force: true })
    ]);
    throw error;
  }
}

main().catch((error) => {
  console.error('BACKUP_CREATE=FAIL');
  console.error(`BACKUP_FAILURE_CATEGORY=${error.safeCategory || 'CONFIGURATION_OR_RUNTIME'}`);
  process.exitCode = 1;
});
