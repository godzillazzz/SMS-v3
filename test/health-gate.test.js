const test = require('node:test');
const assert = require('node:assert/strict');
const { main, normalizeBase } = require('../scripts/ci/verify-health');

test('health gate rejects an unapproved canonical domain', async () => {
  const errors = [];
  const status = await main({
    env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://example.invalid' },
    error: (message) => errors.push(message)
  });
  assert.equal(status, 1);
  assert.match(errors[0], /canonical/i);
});

test('health gate passes with mocked healthy responses and assets', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/') return new Response('<html><link href="/assets/app.css"><script src="/assets/app.js"></script></html>', { status: 200 });
    if (path === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
    return new Response('', { status: 200 });
  };
  try {
    const status = await main({
      env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' },
      log: () => {},
      error: (message) => { throw new Error(message); }
    });
    assert.equal(status, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('normalizeBase requires HTTPS', () => {
  assert.throws(() => normalizeBase('http://sms-v3-staging-ten.vercel.app', 'CANONICAL_URL'), /HTTPS/);
});
