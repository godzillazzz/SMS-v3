/* Non-production backup prototype. It never logs database URLs or credentials. */
require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: 'ignore', shell: false });
  child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
});
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checksum = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.env.BACKUP_DRY_RUN === 'true';
  const directory = path.resolve(process.env.BACKUP_DIRECTORY || './backups');
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('BACKUP_RETENTION_DAYS must be a positive integer.');
  await fs.mkdir(directory, { recursive: true });
  const name = `smsv3-${stamp()}.dump`; const temporary = path.join(directory, `${name}.partial`); const completed = path.join(directory, name);
  const logFile = path.join(directory, 'backup-results.ndjson');
  const result = { at: new Date().toISOString(), dryRun, status: 'started', file: name };
  try {
    if (dryRun) { result.status = 'dry-run'; await fs.appendFile(logFile, `${JSON.stringify(result)}\n`); console.log('Backup dry run completed.'); return; }
    await run('pg_dump', ['--format=custom', '--file', temporary, process.env.DATABASE_URL]);
    let finalTemporary = temporary;
    if (process.env.BACKUP_ENCRYPT_COMMAND) {
      const encrypted = `${temporary}.enc`;
      const args = (process.env.BACKUP_ENCRYPT_ARGS || '{input} {output}').split(' ').filter(Boolean).map((value) => value.replace('{input}', temporary).replace('{output}', encrypted));
      await run(process.env.BACKUP_ENCRYPT_COMMAND, args); await fs.rm(temporary, { force: true }); finalTemporary = encrypted;
    }
    const finalPath = process.env.BACKUP_ENCRYPT_COMMAND ? `${completed}.enc` : completed;
    await fs.rename(finalTemporary, finalPath); await fs.writeFile(`${finalPath}.sha256`, `${await checksum(finalPath)}  ${path.basename(finalPath)}\n`);
    const oldest = Date.now() - retentionDays * 86400000;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.startsWith('smsv3-') && (await fs.stat(path.join(directory, entry.name))).mtimeMs < oldest) await fs.rm(path.join(directory, entry.name), { force: true });
    result.status = 'success'; result.file = path.basename(finalPath); await fs.appendFile(logFile, `${JSON.stringify(result)}\n`); console.log('Backup completed.');
  } catch (error) {
    await fs.rm(temporary, { force: true }); await fs.rm(`${temporary}.enc`, { force: true }); result.status = 'failed'; result.error = error.message; await fs.appendFile(logFile, `${JSON.stringify(result)}\n`); console.error('Backup failed.'); process.exitCode = 1;
  }
}
main();
