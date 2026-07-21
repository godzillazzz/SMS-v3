/*
 * Logical PostgreSQL backup runner for a restricted company-server account.
 * Scheduling, encryption-key management, transfer, and alerting remain external.
 * Connection values are read only from the process environment and are never logged.
 */
require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: 'ignore', shell: false });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with a non-zero status.`)));
});
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function postgresEnvironment(connectionString) {
  const connection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('The backup connection must use PostgreSQL.');
  if (!connection.hostname || !connection.username || connection.pathname.length < 2) throw new Error('The backup connection is incomplete.');
  const env = { ...process.env };
  delete env.DATABASE_URL; delete env.DIRECT_URL; delete env.BACKUP_DATABASE_URL;
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

async function main() {
  const connection = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!connection) throw new Error('BACKUP_DATABASE_URL or DATABASE_URL is required.');
  const pgEnv = postgresEnvironment(connection);
  const dryRun = process.argv.includes('--dry-run') || process.env.BACKUP_DRY_RUN === 'true';
  const directory = path.resolve(process.env.BACKUP_DIRECTORY || './backups');
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('BACKUP_RETENTION_DAYS must be a positive integer.');
  await fsp.mkdir(directory, { recursive: true });
  const name = `smsv3-${stamp()}.dump`;
  const temporary = path.join(directory, `${name}.partial`);
  const completed = path.join(directory, name);
  const logFile = path.join(directory, 'backup-results.ndjson');
  let finalPath;
  try {
    if (dryRun) {
      await fsp.appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), dryRun: true, status: 'dry-run' })}\n`);
      console.log('Backup dry run completed.');
      return;
    }
    await run('pg_dump', ['--format=custom', '--file', temporary], pgEnv);
    await run('pg_restore', ['--list', temporary], pgEnv);
    let finalTemporary = temporary;
    if (process.env.BACKUP_ENCRYPT_COMMAND) {
      const encrypted = `${temporary}.enc`;
      const args = (process.env.BACKUP_ENCRYPT_ARGS || '{input} {output}').split(' ').filter(Boolean).map((value) => value.replace('{input}', temporary).replace('{output}', encrypted));
      await run(process.env.BACKUP_ENCRYPT_COMMAND, args, pgEnv);
      await fsp.rm(temporary, { force: true });
      finalTemporary = encrypted;
    }
    finalPath = process.env.BACKUP_ENCRYPT_COMMAND ? `${completed}.enc` : completed;
    await fsp.rename(finalTemporary, finalPath);
    await fsp.writeFile(`${finalPath}.sha256`, `${await checksum(finalPath)}  ${path.basename(finalPath)}\n`, { flag: 'wx' });
    const oldest = Date.now() - retentionDays * 86400000;
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.startsWith('smsv3-') && (await fsp.stat(candidate)).mtimeMs < oldest) await fsp.rm(candidate, { force: true });
    }
    await fsp.appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), dryRun: false, status: 'success', file: path.basename(finalPath) })}\n`);
    console.log('Backup completed.');
  } catch (error) {
    await Promise.allSettled([temporary, `${temporary}.enc`, finalPath, finalPath && `${finalPath}.sha256`].filter(Boolean).map((file) => fsp.rm(file, { force: true })));
    await fsp.appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), dryRun: false, status: 'failed' })}\n`).catch(() => {});
    throw error;
  }
}

main().catch(() => { console.error('Backup failed.'); process.exitCode = 1; });
