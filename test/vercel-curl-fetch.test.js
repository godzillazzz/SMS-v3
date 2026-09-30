'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVercelCurlFetch } = require('../scripts/ci/vercel-curl-fetch');

test('Vercel curl adapter targets one protected deployment and parses its HTTP response', async () => {
  let invocation;
  const fetchImpl = createVercelCurlFetch({
    baseUrl: 'https://sms-v3-staging-candidate.vercel.app',
    token: 'test-token',
    orgId: 'team_123456789',
    projectId: 'prj_123456789',
    cliVersion: '56.4.1',
    run: (command, args, options) => {
      invocation = { command, args, options };
      const headerPath = args[args.indexOf('--dump-header') + 1];
      const bodyPath = args[args.indexOf('--output') + 1];
      fs.writeFileSync(headerPath, 'HTTP/2 200\r\ncontent-type: application/json\r\naccess-control-allow-origin: https://sms-v3-staging-ten.vercel.app\r\n\r\n');
      fs.writeFileSync(bodyPath, '{"status":"ok"}');
      return { status: 0, stdout: '200', stderr: '' };
    },
  });

  const response = await fetchImpl('https://sms-v3-staging-candidate.vercel.app/api/v1/health', {
    method: 'GET',
    headers: { Origin: 'https://sms-v3-staging-ten.vercel.app' },
  });

  assert.equal(invocation.command, 'npx');
  assert.ok(invocation.args.includes('https://sms-v3-staging-candidate.vercel.app'));
  assert.ok(invocation.args.includes('/api/v1/health'));
  assert.ok(!invocation.args.includes('test-token'));
  assert.equal(invocation.options.env.VERCEL_TOKEN, 'test-token');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('Vercel curl adapter refuses requests outside the candidate origin', async () => {
  const fetchImpl = createVercelCurlFetch({
    baseUrl: 'https://sms-v3-staging-candidate.vercel.app',
    token: 'test-token',
    orgId: 'team_123456789',
    projectId: 'prj_123456789',
    cliVersion: '56.4.1',
    run: () => { throw new Error('must not execute for an external request'); },
  });

  await assert.rejects(fetchImpl('https://outside.invalid/assets/chunk.js'), /escaped deployment origin/);
});
