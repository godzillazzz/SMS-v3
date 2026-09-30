'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../scripts/ci/create-vercel-git-candidate');

const env = {
  VERCEL_TOKEN: 'test-token',
  EXPECTED_ORG_ID: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  EXPECTED_PROJECT_ID: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  EXPECTED_PROJECT_NAME: 'sms-v3-staging',
  TARGET_SHA: '5c1e9414b6d694e53b060608d32c12184bb9c459',
  SOURCE_BRANCH: 'fix/serverless-database-reliability',
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function candidateRecord(overrides = {}) {
  return {
    id: 'dpl_Abc123',
    url: 'sms-v3-staging-abc123-godzillazz.vercel.app',
    projectId: env.EXPECTED_PROJECT_ID,
    readyState: 'READY',
    target: 'production',
    meta: { githubCommitSha: env.TARGET_SHA, githubCommitRef: env.SOURCE_BRANCH },
    gitSource: { type: 'github', org: 'godzillazzz', repo: 'SMS-v3', sha: env.TARGET_SHA, ref: env.SOURCE_BRANCH },
    alias: [],
    aliasAssigned: false,
    ...overrides,
  };
}

test('creates a production-target GitHub candidate pinned to the exact source SHA/ref without aliases', async () => {
  const requests = [];
  const output = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), init });
    if (url.includes('/v9/projects/')) {
      return response({
        id: env.EXPECTED_PROJECT_ID,
        name: env.EXPECTED_PROJECT_NAME,
        link: { type: 'github', org: 'godzillazzz', repo: 'SMS-v3' },
      });
    }
    return response(candidateRecord());
  };

  await main({
    env,
    fetchImpl,
    sleep: async () => {},
    log: () => {},
    now: () => 0,
  });

  assert.equal(requests.length, 2);
  const create = requests[1];
  const body = JSON.parse(create.init.body);
  assert.equal(create.init.method, 'POST');
  assert.equal(body.target, 'production');
  assert.deepEqual(body.alias, []);
  assert.deepEqual(body.gitSource, {
    type: 'github',
    org: 'godzillazzz',
    repo: 'SMS-v3',
    ref: env.SOURCE_BRANCH,
    sha: env.TARGET_SHA,
  });
});

test('fails closed when Vercel native Git SHA or ref does not match', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/v9/projects/')) {
      return response({
        id: env.EXPECTED_PROJECT_ID,
        name: env.EXPECTED_PROJECT_NAME,
        link: { type: 'github', org: 'godzillazzz', repo: 'SMS-v3' },
      });
    }
    return response(candidateRecord({
      meta: { githubCommitSha: env.TARGET_SHA, githubCommitRef: 'HEAD' },
    }));
  };

  await assert.rejects(main({ env, fetchImpl, sleep: async () => {}, now: () => 0 }), /native githubCommitRef mismatch/);
});

test('fails closed when candidate creation assigns an alias', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/v9/projects/')) {
      return response({
        id: env.EXPECTED_PROJECT_ID,
        name: env.EXPECTED_PROJECT_NAME,
        link: { type: 'github', org: 'godzillazzz', repo: 'SMS-v3' },
      });
    }
    return response(candidateRecord({ alias: ['sms-v3-staging-ten.vercel.app'], aliasAssigned: true }));
  };

  await assert.rejects(main({ env, fetchImpl, sleep: async () => {}, now: () => 0 }), /candidate was assigned an alias/);
});
