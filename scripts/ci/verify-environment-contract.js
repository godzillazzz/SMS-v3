'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const contract = require('../../config/environment-contract.json');
const { normalizeLogicalTarget, parseTarget, targetFingerprint } = require('./verify-deployment-target');

const ROOT = path.resolve(__dirname, '../..');
const HEX_64 = /^[0-9a-f]{64}$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;
const VERCEL_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i;

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function loadEnvFile(file) {
  if (!file) return {};
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`environment file not found: ${file}`);
  // Keep --contract-only dependency-free so release validation can run before npm ci.
  const dotenv = require('dotenv');
  return dotenv.parse(fs.readFileSync(resolved, 'utf8'));
}

function validateContractDefinition(definition = contract) {
  if (definition.schemaVersion !== 1) throw new Error('environment contract schemaVersion is unsupported');
  if (definition.project?.name !== 'sms-v3-staging') throw new Error('environment contract project name mismatch');
  if (definition.project?.canonicalProductionOrigin !== 'https://sms-v3-staging-ten.vercel.app') {
    throw new Error('environment contract canonical origin mismatch');
  }
  for (const name of ['production', 'preview', 'development']) {
    const environment = definition.environments?.[name];
    if (!environment) throw new Error(`environment contract missing ${name}`);
    if (!Array.isArray(environment.required) || !Array.isArray(environment.requiredGuards)) {
      throw new Error(`environment contract ${name} required lists are invalid`);
    }
    for (const key of [...environment.required, ...environment.requiredGuards]) {
      if (!/^[A-Z][A-Z0-9_]+$/.test(key)) throw new Error(`environment contract key is invalid: ${key}`);
    }
  }
  const sourceKeys = new Set(definition.sourceValidatedKeys || []);
  if (!sourceKeys.has('DATABASE_URL') || !sourceKeys.has('CORS_ORIGIN')) {
    throw new Error('environment contract is missing source-validated keys');
  }
  const serialized = JSON.stringify(definition);
  if (/postgres(?:ql)?:\/\/[^\s"']+@/i.test(serialized)) {
    throw new Error('environment contract contains a raw database credential');
  }
  if (/-----BEGIN (?:RSA|OPENSSH|EC|PRIVATE) KEY-----/i.test(serialized)) {
    throw new Error('environment contract contains a private key');
  }
  return definition;
}

function normalizeEnvironmentName(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'preview' || normalized === 'production' || normalized === 'development') return normalized;
  throw new Error(`unsupported deployment environment: ${value}`);
}

function parseBoolean(value, name) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be explicitly true or false`);
}

function parseOrigin(value, name = 'origin') {
  if (!hasValue(value)) throw new Error(`${name} is missing`);
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error(`${name} is malformed`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${name} is not a valid origin`);
  }
  return url.origin;
}

function normalizePreviewOrigin(value, name = 'preview origin') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const candidate = raw.includes('://') ? raw : `https://${raw}`;
  const origin = parseOrigin(candidate, name);
  const hostname = new URL(origin).hostname.toLowerCase();
  if (!VERCEL_HOST.test(hostname)) throw new Error(`${name} must be a Vercel Preview hostname`);
  return `https://${hostname}`;
}

function validateCors(environmentName, env, definition = contract) {
  const policy = definition.environments[environmentName].cors;
  const raw = env.CORS_ORIGIN;
  if (!hasValue(raw)) throw new Error('CORS_ORIGIN is required; implicit defaults are not accepted by release preflight');
  const origins = String(raw).split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.includes('*')) throw new Error('CORS_ORIGIN must be an explicit non-wildcard allowlist');
  const normalized = origins.map((value) => parseOrigin(value, 'CORS_ORIGIN entry'));
  if (environmentName === 'production') {
    if (!normalized.includes(policy.requiredCanonicalOrigin)) throw new Error('Production CORS_ORIGIN must include the canonical Production origin');
    for (const origin of normalized) {
      const url = new URL(origin);
      if (policy.rejectLocalhost && ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
        throw new Error('Production CORS_ORIGIN cannot include a local origin');
      }
      if (url.hostname.toLowerCase().endsWith('.vercel.app') && origin !== policy.requiredCanonicalOrigin) {
        throw new Error('Production CORS_ORIGIN cannot implicitly trust a non-canonical Vercel hostname');
      }
      if (url.protocol !== 'https:') throw new Error('Production CORS_ORIGIN entries must use HTTPS');
    }
  }
  if (environmentName === 'preview') {
    for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) {
      if (hasValue(env[key])) normalizePreviewOrigin(env[key], key);
    }
  }
  return normalized;
}

function verifySourceIdentity({ sha, tree, cwd = ROOT } = {}) {
  if (!sha && !tree) return false;
  if (!SHA_40.test(String(sha || '')) || !SHA_40.test(String(tree || ''))) throw new Error('source SHA/tree must be 40 hexadecimal characters');
  let head;
  let headTree;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    headTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('source identity could not be read from Git');
  }
  if (head !== sha || headTree !== tree) throw new Error('source SHA/tree does not match the checked-out worktree');
  return true;
}

function verifyDatabaseTarget(environmentName, env, { requireApprovedFingerprint = false, requirePreviewFingerprint = false, approvedFingerprint } = {}) {
  const databaseUrl = parseTarget('DATABASE_URL', env.DATABASE_URL);
  const directUrl = parseTarget('DIRECT_URL', env.DIRECT_URL);
  const normalized = normalizeLogicalTarget(databaseUrl, directUrl);
  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  const fingerprintName = contract.environments[environmentName].database.fingerprintVariable;
  const expected = approvedFingerprint || env[fingerprintName];
  const required = environmentName === 'production' ? requireApprovedFingerprint : requirePreviewFingerprint;
  if (required && !HEX_64.test(String(expected || ''))) {
    throw new Error(`${fingerprintName} is required for ${environmentName} release preflight`);
  }
  if (hasValue(expected) && !HEX_64.test(String(expected))) throw new Error(`${fingerprintName} must be a SHA-256 fingerprint`);
  if (hasValue(expected) && expected !== fingerprint) throw new Error(`${fingerprintName} does not match the logical database target`);
  if (environmentName === 'preview' && hasValue(env.APPROVED_DATABASE_TARGET_FINGERPRINT) && !HEX_64.test(String(env.APPROVED_DATABASE_TARGET_FINGERPRINT))) {
    throw new Error('APPROVED_DATABASE_TARGET_FINGERPRINT must be a SHA-256 fingerprint');
  }
  if (environmentName === 'preview' && hasValue(env.APPROVED_DATABASE_TARGET_FINGERPRINT) && env.APPROVED_DATABASE_TARGET_FINGERPRINT === fingerprint) {
    throw new Error('Preview database target must not equal the Production target fingerprint');
  }
  return { databaseUrl, directUrl, normalized, fingerprint, approvedMatch: hasValue(expected) ? expected === fingerprint : null };
}

function validateMigrationPolicy(environmentName, env, explicitRunMigrations) {
  const value = explicitRunMigrations ?? env.RUN_MIGRATIONS;
  if (!hasValue(value)) throw new Error('RUN_MIGRATIONS must be explicit for release preflight');
  const runMigrations = parseBoolean(value, 'RUN_MIGRATIONS');
  if (environmentName === 'preview' && runMigrations) throw new Error('Preview preflight forbids migrations');
  return runMigrations;
}

function validateEnvironment({ environment, env = process.env, envFile, sourceSha, sourceTree, cwd = ROOT, requireApprovedFingerprint = false, requirePreviewFingerprint = false, approvedFingerprint, previewOrigin, runMigrations } = {}) {
  const definition = validateContractDefinition();
  const mergedEnv = { ...env, ...loadEnvFile(envFile) };
  const environmentName = normalizeEnvironmentName(environment || mergedEnv.VERCEL_ENV || mergedEnv.NODE_ENV);
  if (!environmentName) throw new Error('deployment environment is required');
  if (['production', 'preview'].includes(environmentName) && mergedEnv.VERCEL_ENV !== environmentName) {
    throw new Error(`VERCEL_ENV must be ${environmentName}`);
  }
  const policy = definition.environments[environmentName];
  for (const key of policy.required) if (!hasValue(mergedEnv[key])) throw new Error(`${key} is required for ${environmentName}`);
  for (const key of policy.requiredGuards) {
    if (key === 'RUN_MIGRATIONS') continue;
    if ((environmentName === 'production' && requireApprovedFingerprint) || (environmentName === 'preview' && requirePreviewFingerprint)) {
      if (!hasValue(approvedFingerprint || mergedEnv[key])) throw new Error(`${key} is required for ${environmentName} release preflight`);
    }
  }
  const corsOrigins = validateCors(environmentName, mergedEnv, definition);
  const database = verifyDatabaseTarget(environmentName, mergedEnv, { requireApprovedFingerprint, requirePreviewFingerprint, approvedFingerprint });
  const migration = validateMigrationPolicy(environmentName, mergedEnv, runMigrations);
  if (environmentName === 'preview' && hasValue(previewOrigin)) {
    const requestedOrigin = normalizePreviewOrigin(previewOrigin, 'PREVIEW_ORIGIN');
    const ownOrigins = [mergedEnv.VERCEL_URL, mergedEnv.VERCEL_BRANCH_URL].map((value) => normalizePreviewOrigin(value)).filter(Boolean);
    if (!ownOrigins.includes(requestedOrigin)) throw new Error('PREVIEW_ORIGIN is not one of the deployment Vercel origins');
  }
  const sourceVerified = verifySourceIdentity({ sha: sourceSha, tree: sourceTree, cwd });
  return {
    environment: environmentName,
    requiredKeys: policy.required,
    corsOrigins,
    database,
    migration,
    sourceVerified,
    branchOverrideRequired: false,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--contract-only') { result.contractOnly = true; continue; }
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[key] = inline !== undefined ? inline : argv[++index];
  }
  return result;
}

function main(argv = process.argv.slice(2), { env = process.env, log = console.log, error = console.error } = {}) {
  try {
    const args = parseArgs(argv);
    validateContractDefinition();
    if (args.contractOnly) {
      log('ENVIRONMENT_CONTRACT_DEFINITION=PASS');
      log(`SOURCE_VALIDATED_KEYS=${contract.sourceValidatedKeys.length}`);
      return 0;
    }
    const result = validateEnvironment({
      environment: args.environment,
      env,
      envFile: args.envFile,
      sourceSha: args.sourceSha,
      sourceTree: args.sourceTree,
      cwd: args.cwd || ROOT,
      requireApprovedFingerprint: args.requireApprovedFingerprint === true || args.requireApprovedFingerprint === 'true',
      requirePreviewFingerprint: args.requirePreviewFingerprint === true || args.requirePreviewFingerprint === 'true',
      approvedFingerprint: args.approvedFingerprint,
      previewOrigin: args.previewOrigin,
      runMigrations: args.runMigrations,
    });
    log(`ENVIRONMENT_CONTRACT=PASS`);
    log(`ENVIRONMENT=${result.environment}`);
    log(`REQUIRED_VARIABLES=${result.requiredKeys.length}`);
    const safeInput = { ...env, ...loadEnvFile(args.envFile) };
    log(`DATABASE_URL_PRESENT=${hasValue(safeInput.DATABASE_URL)}`);
    log(`DIRECT_URL_PRESENT=${hasValue(safeInput.DIRECT_URL)}`);
    log(`DATABASE_TARGET_PROVIDER=${result.database.normalized.provider}`);
    log(`DATABASE_TARGET_MODE=${result.database.databaseUrl.mode}`);
    log(`DIRECT_TARGET_MODE=${result.database.directUrl.mode}`);
    log(`DATABASE_TARGET_FINGERPRINT=${result.database.fingerprint}`);
    log(`APPROVED_TARGET_MATCH=${result.database.approvedMatch === null ? 'NOT_REQUIRED' : result.database.approvedMatch}`);
    log('CORS_CONTRACT=PASS');
    log(`RUN_MIGRATIONS=${result.migration}`);
    log('BRANCH_OVERRIDE_REQUIRED=false');
    log(`SOURCE_IDENTITY=${result.sourceVerified ? 'PASS' : 'NOT_REQUESTED'}`);
    return 0;
  } catch (reason) {
    error(`Environment preflight failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  contract,
  hasValue,
  loadEnvFile,
  main,
  normalizePreviewOrigin,
  parseArgs,
  parseOrigin,
  validateContractDefinition,
  validateCors,
  validateEnvironment,
  validateMigrationPolicy,
  verifyDatabaseTarget,
  verifySourceIdentity,
};
