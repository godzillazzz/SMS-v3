'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPublicRuntime } = require('../scripts/ci/verify-public-runtime');

const baseUrl = 'https://sms-v3-staging-abc.vercel.app';
const html = '<!doctype html><html><head><script type="module" src="/assets/index-entry.js"></script></head></html>';

function response(body, { status = 200, contentType = 'application/javascript', url } = {}) {
  return {
    status,
    url,
    headers: new Map(contentType ? [['content-type', contentType]] : []),
    text: async () => body,
  };
}

function makeFetch(assets, { failures = new Set(), calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (failures.has(parsed.pathname)) throw new Error('network detail must not be logged');
    const asset = assets.get(parsed.pathname);
    if (!asset) return response('not found', { status: 404, url });
    return typeof asset === 'string' ? response(asset, { url }) : response(asset.body, { ...asset, url });
  };
}

test('passes when every required sentinel is in the entry JavaScript bundle', async () => {
  const logs = [];
  const result = await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['เข้าสู่ระบบด้วย Passkey', 'ลงเวลา'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'const ui = "เข้าสู่ระบบด้วย Passkey"; const attendance = "ลงเวลา";'],
    ])),
    onLog: (line) => logs.push(line),
  });

  assert.equal(result.assets.length, 1);
  assert.match(logs[0], /SENTINEL_FOUND=.*ASSET=\/assets\/index-entry\.js/);
  assert.equal(logs.length, 2);
});

test('passes when required sentinels are in reachable lazy-loaded chunks', async () => {
  const result = await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['Approval Authority Matrix / SLA', 'Data Retention Center'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'import("./ApprovalPanel.js"); import("./RetentionPanel.js");'],
      ['/assets/ApprovalPanel.js', 'const label="Approval Authority Matrix / SLA";'],
      ['/assets/RetentionPanel.js', 'const label="Data Retention Center";'],
    ])),
  });

  assert.equal(result.assets.length, 3);
  assert.equal(result.sentinels['Approval Authority Matrix / SLA'], '/assets/ApprovalPanel.js');
  assert.equal(result.sentinels['Data Retention Center'], '/assets/RetentionPanel.js');
});

test('fails closed when all required sentinels are absent', async () => {
  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl: makeFetch(new Map([['/assets/index-entry.js', 'const other="not the label";']])),
    }),
    /missing runtime sentinels: required label/,
  );
});

test('fails closed when a reachable lazy chunk cannot be fetched', async () => {
  const fetchImpl = makeFetch(
    new Map([['/assets/index-entry.js', 'import("./broken.js");']]),
    { failures: new Set(['/assets/broken.js']) },
  );

  await assert.rejects(
    verifyPublicRuntime({ baseUrl, html, sentinels: ['required label'], fetchImpl }),
    /runtime asset fetch failed: \/assets\/broken\.js/,
  );
});

test('does not crawl external URLs or non-JavaScript assets', async () => {
  const calls = [];
  await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['required label'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'import("https://outside.invalid/secret.js"); const image="/assets/logo.svg"; const label="required label";'],
    ]), { calls }),
  });

  assert.deepEqual(calls, [`${baseUrl}/assets/index-entry.js`]);
});

test('ignores JavaScript filenames in dependency metadata that are not imports', async () => {
  const calls = [];
  const result = await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['required label'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'const deps = ["assets/metadata-only.js"]; import("./reachable.js"); const label="required label";'],
      ['/assets/reachable.js', 'const other = true;'],
    ]), { calls }),
    onLog: () => {},
  });

  assert.equal(result.assets.length, 2);
  assert.deepEqual(calls.map((url) => new URL(url).pathname), [
    '/assets/index-entry.js',
    '/assets/reachable.js',
  ]);
});

test('deduplicates cyclic chunk references and terminates', async () => {
  const calls = [];
  const result = await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['cycle label'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'import("./a.js"); import("./a.js");'],
      ['/assets/a.js', 'import("./index-entry.js"); import("./b.js");'],
      ['/assets/b.js', 'import("./a.js"); const label="cycle label";'],
    ]), { calls }),
  });

  assert.equal(result.assets.length, 3);
  assert.equal(calls.length, 3);
});

test('uses bounded concurrent fetches while traversing reachable chunks', async () => {
  let active = 0;
  let maxActive = 0;
  const references = Array.from({ length: 8 }, (_, index) => `import("./chunk-${index}.js");`).join('');
  const fetchImpl = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
    const parsed = new URL(url);
    const source = parsed.pathname === '/assets/index-entry.js'
      ? `${references} const label="required label";`
      : 'const chunk = true;';
    return response(source, { url });
  };

  const result = await verifyPublicRuntime({ baseUrl, html, sentinels: ['required label'], fetchImpl });

  assert.equal(result.assets.length, 9);
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= 4);
});

test('ignores malformed and non-JavaScript references without crawling them', async () => {
  const calls = [];
  const result = await verifyPublicRuntime({
    baseUrl,
    html,
    sentinels: ['safe label'],
    fetchImpl: makeFetch(new Map([
      ['/assets/index-entry.js', 'import("http://[malformed.js"); import("/assets/not-a-chunk.css"); const label="safe label";'],
    ]), { calls }),
  });

  assert.equal(result.assets.length, 1);
  assert.equal(calls.length, 1);
});

test('rejects an HTML fallback served for a reachable .js asset', async () => {
  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl: makeFetch(new Map([
        ['/assets/index-entry.js', '<!doctype html><html>login</html>'],
      ])),
    }),
    /returned HTML instead of JavaScript/,
  );
});

test('rejects a reachable .js path served with a non-JavaScript content type', async () => {
  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl: makeFetch(new Map([
        ['/assets/index-entry.js', { body: 'const label="required label";', contentType: 'text/plain' }],
      ])),
    }),
    /returned non-JavaScript content type/,
  );
});

test('fails closed when reachable assets exceed traversal bounds', async () => {
  const fetchImpl = makeFetch(new Map([
    ['/assets/index-entry.js', 'import("./a.js"); import("./b.js"); const label="required label";'],
    ['/assets/a.js', ''],
    ['/assets/b.js', ''],
  ]));

  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl,
      limits: { maxAssets: 2 },
    }),
    /exceeded max asset count 2/,
  );
});

test('fails closed when a reachable lazy chunk exceeds the maximum traversal depth', async () => {
  const fetchImpl = makeFetch(new Map([
    ['/assets/index-entry.js', 'import("./level-one.js");'],
    ['/assets/level-one.js', 'import("./level-two.js");'],
    ['/assets/level-two.js', 'const label="required label";'],
  ]));

  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl,
      limits: { maxDepth: 1 },
    }),
    /exceeded max depth 1/,
  );
});

test('fails closed when reachable JavaScript exceeds the total byte budget', async () => {
  const source = 'x'.repeat(6);
  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: ['required label'],
      fetchImpl: makeFetch(new Map([
        ['/assets/index-entry.js', `${source} import('./a.js')`],
        ['/assets/a.js', source],
      ])),
      limits: { maxAssetBytes: 64, maxTotalBytes: 25 },
      onLog: () => {},
    }),
    /exceeded max total size 25/,
  );
});
