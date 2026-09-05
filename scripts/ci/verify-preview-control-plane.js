'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const contract = require('../../config/environment-contract.json');

const HEX_64 = /^[0-9a-f]{64}$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseEnvFile(file) {
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      try {
        value = value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1);
      } catch {
        throw new Error(`${match[1]} value is malformed`);
      }
    }
    env[match[1]] = value;
  }
  return env;
}

function parseOrigin(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('CORS_ORIGIN entry is malformed');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('CORS_ORIGIN entry is not a valid HTTPS origin');
  }
  return url.origin;
}

function projectLevelPreviewRows(metadata, key) {
  const rows = Array.isArray(metadata?.envs) ? metadata.envs : [];
  return rows.filter((row) =>
    row?.key === key &&
    Array.isArray(row.target) &&
    row.target.includes('preview') &&
    !row.gitBranch
  );
}

function validateMetadata(metadata) {
  const sensitive = new Set(['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET']);
  const readable = new Set(['CORS_ORIGIN', 'APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT']);
  for (const key of [...sensitive, ...readable]) {
    const rows = projectLevelPreviewRows(metadata, key);
    if (rows.length !== 1) throw new Error(`${key} must have exactly one project-level Preview row`);
    const type = String(rows[0].type || '').toLowerCase();
    if (sensitive.has(key) && type !== 'sensitive') throw new Error(`${key} must remain Vercel Sensitive`);
    if (readable.has(key) && type === 'sensitive') throw new Error(`${key} must be readable non-sensitive configuration`);
  }
}

function verifySourceIdentity({ sha, tree, cwd }) {
  if (!SHA_40.test(String(sha || '')) || !SHA_40.test(String(tree || ''))) {
    throw new Error('source SHA/tree must be 40 hexadecimal characters');
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const headTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
  if (head !== sha || headTree !== tree) throw new Error('source SHA/tree does not match the checked-out worktree');
}

function validate({
  envFile,
  metadataFile,
  sourceSha,
  sourceTree,
  cwd = process.cwd(),
  productionFingerprint,
  runMigrations,
}) {
  const env = parseEnvFile(envFile);
  const metadata = JSON.parse(fs.readFileSync(path.resolve(metadataFile), 'utf8'));
  validateMetadata(metadata);

  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'CORS_ORIGIN', 'APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT']) {
    if (!hasValue(env[key])) throw new Error(`${key} is required for preview`);
  }

  const corsOrigins = String(env.CORS_ORIGIN).split(',').map((value) => value.trim()).filter(Boolean);
  if (!corsOrigins.length || corsOrigins.includes('*')) throw new Error('CORS_ORIGIN must be an explicit non-wildcard allowlist');
  const normalizedOrigins = corsOrigins.map(parseOrigin);
  const canonical = contract.project?.canonicalProductionOrigin;
  if (!normalizedOrigins.includes(canonical)) throw new Error('Preview CORS_ORIGIN must include the governed canonical base origin');

  const previewFingerprint = String(env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT).trim().toLowerCase();
  if (!HEX_64.test(previewFingerprint)) throw new Error('APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT must be a SHA-256 fingerprint');

  const production = String(productionFingerprint || '').trim().toLowerCase();
  if (!HEX_64.test(production)) throw new Error('Production database fingerprint is required for Preview control-plane validation');
  if (previewFingerprint === production) throw new Error('Preview database target fingerprint must not equal Production');

  if (String(runMigrations) !== 'false') throw new Error('Preview preflight forbids migrations');
  verifySourceIdentity({ sha: sourceSha, tree: sourceTree, cwd });

  return {
    corsCount: normalizedOrigins.length,
    sourceVerified: true,
    databaseRuntimeValidation: 'DEFERRED_TO_PREVIEW_READINESS',
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[key] = inline !== undefined ? inline : argv[++index];
  }
  return result;
}

function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  try {
    const args = parseArgs(argv);
    const result = validate({
      envFile: args.envFile,
      metadataFile: args.metadataFile,
      sourceSha: args.sourceSha,
      sourceTree: args.sourceTree,
      cwd: args.cwd,
      productionFingerprint: args.productionFingerprint,
      runMigrations: args.runMigrations,
    });
    log('PREVIEW_CONTROL_PLANE_PREFLIGHT=PASS');
    log('DATABASE_URL_METADATA=SENSITIVE_PRESENT');
    log('DIRECT_URL_METADATA=SENSITIVE_PRESENT');
    log('JWT_SECRET_METADATA=SENSITIVE_PRESENT');
    log('CORS_CONTRACT=PASS');
    log(`CORS_ORIGIN_COUNT=${result.corsCount}`);
    log('APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT_PRESENT=true');
    log('PREVIEW_PRODUCTION_DATABASE_FINGERPRINT_DISTINCT=PASS');
    log('DATABASE_TARGET_RUNTIME_VALIDATION=DEFERRED_TO_PREVIEW_READINESS');
    log('RUN_MIGRATIONS=false');
    log('BRANCH_OVERRIDE_REQUIRED=false');
    log(`SOURCE_IDENTITY=${result.sourceVerified ? 'PASS' : 'NOT_REQUESTED'}`);
    return 0;
  } catch (reason) {
    error(`Preview control-plane preflight failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  main,
  parseEnvFile,
  parseOrigin,
  projectLevelPreviewRows,
  validate,
  validateMetadata,
  verifySourceIdentity,
};
