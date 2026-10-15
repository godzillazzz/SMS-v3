'use strict';
const { fail } = require('./config');
// These are non-sensitive observations from the immutable Vercel deployment,
// not a project-level mutable setting or a caller assertion that isolation passed.
function verifyRuntimeIsolation(target, deployment, readiness) {
  if (deployment.env?.VERCEL_ENV !== 'preview') fail('UAT_RUNTIME_PREVIEW_ENVIRONMENT_UNVERIFIED');
  const actual = deployment.env?.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT;
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual)) fail('UAT_DEPLOYED_DATABASE_FINGERPRINT_UNAVAILABLE');
  if (actual !== target.database_target_fingerprint) fail('UAT_RUNTIME_DATABASE_TARGET_MISMATCH');
  const production = target.production_database_target_fingerprint;
  if (typeof production !== 'string' || !/^[a-f0-9]{64}$/.test(production) || actual === production) fail('UAT_DATABASE_NOT_DISTINCT_FROM_PRODUCTION');
  if (readiness?.status !== 'ready' || readiness?.database !== 'ok') fail('UAT_RUNTIME_DATABASE_READINESS_FAILED');
  // Reviewed source hashes are verified before protected execution. The existing
  // Preview readiness guard computes the actual DATABASE_URL/DIRECT_URL logical
  // identity in-process; the pinned Prisma config uses that same target.
  return { approvedFingerprintMatch: true, productionDistinct: true, runtimeReadiness: 'PASS' };
}
module.exports = { verifyRuntimeIsolation };
