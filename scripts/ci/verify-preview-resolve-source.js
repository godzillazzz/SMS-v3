'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RESOLVE_TARGET = '202608240003_g06_security_site_qr_gps_v1';
const RESOLVE_CHECKSUM = '2d706f436f0b8585c8e6c682a525744d4f4cda6a2b10ee09cc5100dde22e5636';
const MIGRATION_PATH = path.join('prisma', 'migrations', RESOLVE_TARGET, 'migration.sql');

function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');
}

function hasDataStatements(sql) {
  const executableSql = stripSqlComments(sql);
  return /^\s*(?:INSERT|UPDATE|DELETE|UPSERT|COPY|MERGE)\b/im.test(executableSql);
}

function verifyPreviewResolveSource({ cwd = process.cwd(), log = console.log } = {}) {
  const migrationFile = path.join(cwd, MIGRATION_PATH);
  if (!fs.existsSync(migrationFile)) throw new Error('Resolve migration file is missing');

  const migrationSql = fs.readFileSync(migrationFile, 'utf8');
  // Git stores the reviewed migration with LF; normalize only checkout line endings
  // so the checksum is stable on Windows and Linux without changing SQL content.
  const canonicalSql = migrationSql.replace(/\r\n/g, '\n');
  const checksum = crypto.createHash('sha256').update(canonicalSql).digest('hex');
  if (checksum !== RESOLVE_CHECKSUM) throw new Error('Resolve migration checksum mismatch');
  if (hasDataStatements(canonicalSql)) throw new Error('Resolve migration contains data statements');

  log('RESOLVE_TARGET_SOURCE=PASS');
  log('RESOLVE_CHECKSUM=PASS');
  log('MIGRATION_HAS_DATA_STATEMENTS=NO');
  log('RAW_DATABASE_OUTPUT_EMITTED=false');
  return { migrationPath: MIGRATION_PATH, checksum, hasDataStatements: false };
}

function main() {
  try {
    verifyPreviewResolveSource();
    return 0;
  } catch (reason) {
    console.error(`Preview resolve source guard failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  MIGRATION_PATH,
  RESOLVE_CHECKSUM,
  RESOLVE_TARGET,
  hasDataStatements,
  stripSqlComments,
  verifyPreviewResolveSource,
};
