'use strict';

// Read-only identity proof for a candidate disposable Q13 database.
// This compares protected fingerprints and connection targets. It does NOT
// prove that a Vercel deployment is wired to the checked URL: that is a
// separate mandatory protected live identity / readiness gate.
const { parseTarget, normalizeLogicalTarget, targetFingerprint } = require('./verify-deployment-target');

const HEX_64 = /^[0-9a-f]{64}$/i;
const SHARED_PROJECT = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const SHARED_DEPLOYMENT = 'dpl_6SxGPuH374ogrr2mjzwDkincaMCA';
const SHARED_URL = 'https://sms-v3-staging-ntizvmjdo-godzillazz.vercel.app';
const CANONICAL_URL = 'https://sms-v3-staging-ten.vercel.app';
const DISPOSABLE_HOST = /^sms-v3-q13-disposable-[a-z0-9-]+-godzillazz\.vercel\.app$/i;

function reject() {
  // Never include connection strings, hostnames or fingerprints in errors.
  throw new Error('Q13_DISPOSABLE_PREVIEW_TARGET_NOT_PROVEN');
}

function verifiedFingerprint(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!HEX_64.test(text)) reject();
  return text;
}

function verifyQ13DisposablePreviewTarget(env = process.env) {
  if (env.UAT_TARGET_MODE !== 'preview') reject();
  if (env.UAT_DISPOSABLE_PREVIEW_DB_APPROVED !== 'YES') reject();
  if (env.UAT_SCOPE !== 'q13b-specialist-write-targeted' &&
      env.UAT_SCOPE !== 'q13c-business-workflow-targeted') reject();

  const deploymentId = String(env.UAT_EXPECTED_DEPLOYMENT_ID || '');
  const projectId = String(env.Q13_DISPOSABLE_PROJECT_ID || '');
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId) ||
      deploymentId === SHARED_DEPLOYMENT ||
      !/^prj_[A-Za-z0-9]+$/.test(projectId) ||
      projectId === SHARED_PROJECT) reject();

  let target;
  try { target = new URL(String(env.UAT_BASE_URL || '')); } catch { reject(); }
  if (target.protocol !== 'https:' || target.username || target.password ||
      target.port || target.pathname !== '/' || target.search || target.hash ||
      !DISPOSABLE_HOST.test(target.hostname) ||
      target.origin === SHARED_URL || target.origin === CANONICAL_URL) reject();

  const disposableApproved = verifiedFingerprint(env.Q13_APPROVED_DISPOSABLE_TARGET_FINGERPRINT);
  const sharedApproved = verifiedFingerprint(env.Q13_APPROVED_SHARED_PREVIEW_TARGET_FINGERPRINT);
  const productionApproved = verifiedFingerprint(env.Q13_APPROVED_PRODUCTION_TARGET_FINGERPRINT);
  if (new Set([disposableApproved, sharedApproved, productionApproved]).size !== 3) reject();

  let actual;
  try {
    const db = parseTarget('DATABASE_URL', env.DATABASE_URL);
    const direct = parseTarget('DIRECT_URL', env.DIRECT_URL);
    normalizeLogicalTarget(db, direct);
    actual = targetFingerprint(db, direct).toLowerCase();
  } catch { reject(); }
  if (actual !== disposableApproved || actual === sharedApproved || actual === productionApproved) reject();

  return Object.freeze({
    approvedFingerprintMatched: true, distinctFromSharedPreview: true,
    distinctFromProduction: true, disposableProjectIdentifierDistinct: true,
    disposableDeploymentIdentifierDistinct: true,
    previewTargetGuard: 'PASS',
    deployedRuntimeTargetIdentity: 'NOT_VERIFIED',
    credentialsEmitted: false
  });
}

function main() {
  try {
    const result = verifyQ13DisposablePreviewTarget();
    console.log('Q13_DISPOSABLE_DB_FINGERPRINT=PASS');
    console.log('Q13_DISPOSABLE_DB_DISTINCT_FROM_SHARED_AND_PRODUCTION=PASS');
    console.log('Q13_DEPLOYED_RUNTIME_BINDING=NOT_VERIFIED');
    console.log('Q13_RAW_DATABASE_CONNECTION_EMITTED=false');
    return result.previewTargetGuard === 'PASS' ? 0 : 1;
  } catch {
    console.error('Q13_DISPOSABLE_PREVIEW_TARGET_NOT_PROVEN');
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { verifyQ13DisposablePreviewTarget, main };
