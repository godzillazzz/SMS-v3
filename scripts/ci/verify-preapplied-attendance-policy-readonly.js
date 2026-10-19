'use strict';
const reconciliation = require('./reconcile-production-attendance-migrations');
const { isAttendanceSchemaPinError } = require('./attendance-schema-pin');

// Closed allowlist of reportable failure categories. Any other error collapses to the invariant
// category: raw messages, stacks, paths, queries, credentials and digests are never echoed.
const PREAPPLIED_FAILURE_CATEGORIES = Object.freeze([
  'SCHEMA_PIN_MISMATCH',
  'SCHEMA_READ_PERMISSION_DENIED',
  'SCHEMA_QUERY_TIMEOUT',
  'SCHEMA_OBJECT_NOT_FOUND',
  'SCHEMA_CONNECTION_FAILED',
  'INVARIANT_OR_QUERY_FAIL_CLOSED',
  'PREAPPLIED_SCHEMA_NOT_VALID',
  'PREAPPLIED_STATE_FAILED',
  'APPLICATION_RELEASE_MIGRATION_FORBIDDEN',
]);
function preappliedFailureCategory(error) {
  if (isAttendanceSchemaPinError(error)) return 'SCHEMA_PIN_MISMATCH';
  const message = String(error?.message || '');
  if (PREAPPLIED_FAILURE_CATEGORIES.includes(message)) return message;
  const category = reconciliation.failureCategory(error);
  return PREAPPLIED_FAILURE_CATEGORIES.includes(category) ? category : 'INVARIANT_OR_QUERY_FAIL_CLOSED';
}

// Application release observes the independently proven history, but never deploys migrations.
async function verify({ env = process.env, run = reconciliation.run, readFacts = reconciliation.readFacts } = {}) {
  const result = await run({
    env: { ...env, SOURCE_SHA: env.TARGET_SHA, SOURCE_TREE: env.TARGET_TREE,
      CURRENT_PRODUCTION_ID: env.ROLLBACK_DEPLOYMENT_ID, CURRENT_PRODUCTION_SHA: env.CURRENT_PRODUCTION_SOURCE_SHA },
    observe: async (client, sources, log) => {
      const facts = await readFacts(client,sources,log);
      if (facts.plan !== 'PLAN_NO_DATABASE_CHANGE') throw new Error('PREAPPLIED_SCHEMA_NOT_VALID');
      return facts;
    },
    apply: () => { throw new Error('APPLICATION_RELEASE_MIGRATION_FORBIDDEN'); }
  });
  if (result.plan !== 'PLAN_NO_DATABASE_CHANGE') throw new Error('PREAPPLIED_STATE_FAILED');
  return result;
}
if (require.main === module) verify().catch((error) => {
  console.error('PREAPPLIED_FAILURE_CATEGORY=' + preappliedFailureCategory(error));
  console.error('PREAPPLIED_ATTENDANCE_POLICY=FAIL_CLOSED');
  process.exitCode = 1;
});
module.exports = { verify, preappliedFailureCategory, PREAPPLIED_FAILURE_CATEGORIES };
