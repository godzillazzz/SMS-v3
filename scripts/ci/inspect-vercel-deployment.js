'use strict';

const { inspectVercelDeployment } = require('./vercel-api-deployment');

async function main({ args = process.argv.slice(2), env = process.env, fetchImpl } = {}) {
  const [deploymentId, expectedCommitSha, expectedCommitRef, expectedTarget, noCanonicalAlias] = args;
  if (!deploymentId || !expectedCommitSha || !expectedCommitRef || !expectedTarget || !['true', 'false'].includes(noCanonicalAlias)) {
    throw new Error('Usage: inspect-vercel-deployment <deployment-id> <expected-sha> <expected-ref> <expected-target> <require-no-canonical-alias>');
  }

  const record = await inspectVercelDeployment({
    deploymentId,
    teamId: env.VERCEL_ORG_ID,
    token: env.VERCEL_TOKEN,
    expectedProjectId: env.EXPECTED_PROJECT_ID,
    expectedCommitSha,
    expectedCommitRef,
    expectedTarget,
    expectedCanonicalUrl: env.EXPECTED_CANONICAL_URL,
    requireReady: true,
    requireNoCanonicalAlias: noCanonicalAlias === 'true',
    fetchImpl,
  });

  process.stdout.write([
    'VERCEL_NATIVE_DEPLOYMENT=PASS',
    `deployment_id=${record.id}`,
    `project_id=${record.projectId}`,
    `github_commit_sha=${record.commitSha}`,
    `github_commit_ref=${record.commitRef}`,
    `target=${record.target}`,
    `ready_state=${record.readyState}`,
    `alias_assigned=${String(record.aliasAssigned)}`,
    `alias_count=${record.aliases.length}`,
    `canonical_alias_assigned=${String(record.canonicalAliasAssigned)}`,
  ].join('\n') + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
