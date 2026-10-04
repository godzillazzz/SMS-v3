'use strict';
const reconciliation = require('./reconcile-production-attendance-migrations');

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
if (require.main === module) verify().catch(() => {
  console.error('PREAPPLIED_ATTENDANCE_POLICY=FAIL_CLOSED'); process.exitCode = 1;
});
module.exports = { verify };
