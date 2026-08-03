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
    if (path === '/' || path === '/login') return new Response('<html><link href="/assets/app.css"><script src="/assets/app.js"></script></html>', { status: 200 });
    if (path === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
    if (path === '/api/v1/dashboard' || path === '/api/v1/licenses') return new Response('', { status: 401 });
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

test('health gate uses the canonical URL without a generated deployment URL', async () => {
  const originalFetch = global.fetch;
  const canonicalOrigin = 'https://sms-v3-staging-ten.vercel.app';
  global.fetch = async (url) => {
    assert.equal(new URL(url).origin, canonicalOrigin);
    const path = new URL(url).pathname;
    if (path === '/' || path === '/login') return new Response('<html></html>', { status: 200 });
    if (path === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
    if (path === '/api/v1/dashboard' || path === '/api/v1/licenses') return new Response('', { status: 401 });
    return new Response('', { status: 200 });
  };
  try {
    assert.equal(await main({ env: { CANONICAL_URL: canonicalOrigin }, log: () => {}, error: () => {} }), 0);
  } finally { global.fetch = originalFetch; }
});

test('health gate accepts an internal root redirect to the login route', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/') return new Response('', { status: 302, headers: { location: '/login' } });
    if (path === '/login') return new Response('<html><link href="/assets/login.css"><script src="/assets/login.js"></script></html>', { status: 200 });
    if (path === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
    if (path === '/api/v1/dashboard' || path === '/api/v1/licenses') return new Response('', { status: 403 });
    return new Response('', { status: 200 });
  };
  try {
    assert.equal(await main({ env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' }, log: () => {}, error: () => {} }), 0);
  } finally { global.fetch = originalFetch; }
});

test('health gate rejects external, missing, and looping root redirects', async (t) => {
  for (const [name, rootResponse, loginResponse] of [
    ['external', new Response('', { status: 302, headers: { location: 'https://external.example/login' } }), new Response('', { status: 200 })],
    ['missing Location', new Response('', { status: 302 }), new Response('', { status: 200 })],
    ['loop', new Response('', { status: 302, headers: { location: '/login' } }), new Response('', { status: 302, headers: { location: '/login' } })]
  ]) {
    await t.test(name, async () => {
      const originalFetch = global.fetch;
      global.fetch = async (url) => new URL(url).pathname === '/' ? rootResponse : loginResponse;
      try { assert.equal(await main({ env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' }, error: () => {} }), 1); }
      finally { global.fetch = originalFetch; }
    });
  }
});

test('health gate rejects an unavailable login destination', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => new URL(url).pathname === '/' ? new Response('', { status: 302, headers: { location: '/login' } }) : new Response('', { status: 503 });
  try { assert.equal(await main({ env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' }, error: () => {} }), 1); }
  finally { global.fetch = originalFetch; }
});

test('health gate keeps health, readiness, and database checks strict', async (t) => {
  for (const [name, response] of [
    ['health', new Response('', { status: 503 })],
    ['ready', new Response(JSON.stringify({ status: 'ready', database: 'error' }), { status: 200 })]
  ]) {
    await t.test(name, async () => {
      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        const path = new URL(url).pathname;
        if (path === '/' || path === '/login') return new Response('<html></html>', { status: 200 });
        if ((name === 'health' && path === '/api/v1/health') || (name === 'ready' && path === '/api/v1/ready')) return response;
        if (path === '/api/v1/ready') return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
        return new Response('', { status: 401 });
      };
      try { assert.equal(await main({ env: { DEPLOYMENT_URL: 'https://sms-v3-staging-preview.vercel.app', CANONICAL_URL: 'https://sms-v3-staging-ten.vercel.app' }, error: () => {} }), 1); }
      finally { global.fetch = originalFetch; }
    });
  }
});

test('normalizeBase requires HTTPS', () => {
  assert.throws(() => normalizeBase('http://sms-v3-staging-ten.vercel.app', 'CANONICAL_URL'), /HTTPS/);
});
