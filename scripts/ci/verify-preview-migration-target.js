'use strict';

const {
  normalizeLogicalTarget,
  parseTarget,
  targetFingerprint,
} = require('./verify-deployment-target');

const HEX_64 = /^[0-9a-f]{64}$/i;

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function verifyPreviewMigrationTarget({ env = process.env, log = console.log } = {}) {
  log(`DATABASE_URL_PRESENT=${hasValue(env.DATABASE_URL)}`);
  log(`DIRECT_URL_PRESENT=${hasValue(env.DIRECT_URL)}`);

  if (String(env.VERCEL_ENV || '').trim().toLowerCase() !== 'preview') {
    throw new Error('VERCEL_ENV must be preview');
  }

  const approvedPreview = String(env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  const approvedProduction = String(env.APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  if (!HEX_64.test(approvedPreview)) {
    throw new Error('APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT is required');
  }
  if (!HEX_64.test(approvedProduction)) {
    throw new Error('APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT is required');
  }
  if (approvedPreview === approvedProduction) {
    throw new Error('Preview and Production target fingerprints must be distinct');
  }

  let databaseUrl;
  let directUrl;
  try {
    databaseUrl = parseTarget('DATABASE_URL', env.DATABASE_URL);
    directUrl = parseTarget('DIRECT_URL', env.DIRECT_URL);
    normalizeLogicalTarget(databaseUrl, directUrl);
  } catch {
    throw new Error('Preview database target could not be verified');
  }

  const fingerprint = targetFingerprint(databaseUrl, directUrl);
  const previewMatch = fingerprint === approvedPreview;
  log(`DATABASE_MODE=${databaseUrl.mode}`);
  log(`DIRECT_MODE=${directUrl.mode}`);
  log(`TARGET_FINGERPRINT_MATCH=${previewMatch}`);
  if (!previewMatch) throw new Error('Preview database target fingerprint mismatch');
  if (fingerprint === approvedProduction) throw new Error('Preview database target matches Production');

  log('PREVIEW_DATABASE_IDENTITY=PROVEN');
  log('PREVIEW_NOT_PRODUCTION=PASS');
  log('RAW_DATABASE_OUTPUT_EMITTED=false');
  return {
    fingerprint,
    provider: databaseUrl.provider,
    databaseMode: databaseUrl.mode,
    directMode: directUrl.mode,
  };
}

function main({ env = process.env, log = console.log, error = console.error } = {}) {
  try {
    verifyPreviewMigrationTarget({ env, log });
    return 0;
  } catch (reason) {
    error(`Preview migration target guard failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { HEX_64, hasValue, main, verifyPreviewMigrationTarget };
