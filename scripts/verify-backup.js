/* Restore-verification prototype; requires pg_restore and psql, never production URLs. */
require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const backup = process.argv[2];
const run = (command, args) => new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'ignore', shell: false }); child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))); });
async function main() {
  if (!backup || !process.env.VERIFY_ADMIN_DATABASE_URL) throw new Error('Usage: node scripts/verify-backup.js <backup-file>; VERIFY_ADMIN_DATABASE_URL is required.');
  const db = `smsv3_verify_${crypto.randomUUID().replace(/-/g, '')}`;
  const admin = process.env.VERIFY_ADMIN_DATABASE_URL;
  try {
    await run('psql', [admin, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${db}`]);
    const target = new URL(admin); target.pathname = `/${db}`;
    await run('pg_restore', ['--no-owner', '--no-privileges', '--dbname', target.toString(), backup]);
    await run('psql', [target.toString(), '-v', 'ON_ERROR_STOP=1', '-Atqc', 'SELECT count(*) FROM "_prisma_migrations"; SELECT count(*) FROM "users"; SELECT count(*) FROM "employees";']);
    console.log('Backup restore verification completed.');
  } finally { await run('psql', [admin, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]).catch(() => {}); }
}
main().catch(() => { console.error('Backup restore verification failed.'); process.exitCode = 1; });
