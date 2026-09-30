'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../scripts/ci/inspect-vercel-deployment');

const record = {
  id: 'dpl_abc123',
  projectId: 'prj_expected',
  target: 'production',
  readyState: 'READY',
  meta: { githubCommitSha: 'a'.repeat(40), githubCommitRef: 'fix/serverless-database-reliability' },
  aliasAssigned: true,
  alias: ['sms-v3-staging-git-fix-serverless-database-re-662e13-godzillazz.vercel.app'],
};

test('CLI inspector reports only validated Vercel native deployment identity', async () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try {
    await main({
      args: ['dpl_abc123', 'a'.repeat(40), 'fix/serverless-database-reliability', 'production', 'true'],
      env: { VERCEL_ORG_ID: 'team_expected', VERCEL_TOKEN: 'test-token', EXPECTED_PROJECT_ID: 'prj_expected', EXPECTED_CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' },
      fetchImpl: async () => ({ ok: true, json: async () => record }),
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /VERCEL_NATIVE_DEPLOYMENT=PASS/);
  assert.match(output, /github_commit_sha=a{40}/);
  assert.match(output, /github_commit_ref=fix\/serverless-database-reliability/);
  assert.match(output, /alias_assigned=true/);
  assert.match(output, /alias_count=1/);
  assert.match(output, /canonical_alias_assigned=false/);
  assert.doesNotMatch(output, /test-token/);
});

test('CLI inspector requires an explicit alias policy argument', async () => {
  await assert.rejects(main({ args: ['dpl_abc123'], env: {} }), /Usage: inspect-vercel-deployment/);
});
