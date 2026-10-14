'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SENTINELS } = require('../scripts/ci/verify-release-artifact');
const { verifyPublicRuntime } = require('../scripts/ci/verify-public-runtime');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-approved-production-v2.yml'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'frontend/src/main.tsx'), 'utf8');

function runtimeSentinels() {
  assert.match(workflow, /const sentinels = \[\.\.\.manifest\.runtime\];/);
  assert.match(workflow, /git show "\$GITHUB_SHA:frontend\/src\/release-runtime-sentinels\.json"/);
  const entries = require('../frontend/src/release-runtime-sentinels.json').runtime;
  assert.equal(entries.length, 20, 'preserve all 20 original Production runtime sentinels');
  assert.equal(new Set(entries).size, entries.length, 'no duplicate required sentinels');
  return entries;
}

test('R7 protected Production T38 runtime sentinel matches current navigation and artifact guard', () => {
  const label = 'ศูนย์ควบคุมการลงเวลา';
  const list = runtimeSentinels();
  assert.equal(list.filter((entry) => entry === label).length, 1);
  assert.ok(!list.includes('ลงเวลาแทนพนักงาน'), 'rejected historical T38 label must not be a required sentinel');
  assert.ok(DEFAULT_SENTINELS.includes(label));
  for (const sentinel of DEFAULT_SENTINELS) {
    assert.ok(list.includes(sentinel), `runtime verification dropped required artifact sentinel: ${sentinel}`);
  }
  assert.ok(ui.includes("{ id: 'attendanceSupervisor', icon: 'dashboard', label: 'ศูนย์ควบคุมการลงเวลา' }"));
});

test('protected Production runtime guard preserves security checks, rollback, and manual dispatch', () => {
  assert.match(workflow, /^on:\r?\n\s+workflow_dispatch:/m);
  assert.match(workflow, /environment:\s*\n\s+name: production-sms-v3-staging/);
  assert.match(workflow, /NO_DATABASE_CHANGES/);
  assert.match(workflow, /Auto-rollback to manifest checkpoint if post-deploy verification fails/);
  assert.match(workflow, /Fail closed after verified automatic rollback/);
  assert.match(workflow, /verifyPublicRuntime\(/);
  assert.match(workflow, /SENTINELS=\$\{sentinels\.length\}/);
  assert.match(workflow, /sentinels\.push\(\.\.\.manifest\.attendanceTimePolicy\)/);
});

test('runtime verifier still fails closed when the new T38 label is absent', async () => {
  const oldLabel = 'ลงเวลาแทนพนักงาน';
  const newLabel = 'ศูนย์ควบคุมการลงเวลา';
  const html = '<html><script type="module" src="/assets/index-test.js"></script></html>';
  const baseUrl = 'https://sms-v3-staging-abc.vercel.app';
  await assert.rejects(
    verifyPublicRuntime({
      baseUrl,
      html,
      sentinels: [newLabel],
      fetchImpl: async (url) => ({
        status: 200,
        url,
        headers: new Map([['content-type', 'application/javascript']]),
        text: async () => `const legacy = ${JSON.stringify(oldLabel)};`,
      }),
    }),
    /missing runtime sentinels: ศูนย์ควบคุมการลงเวลา/,
  );
});

test('each manifest runtime sentinel fails closed when absent, with frontend source coverage', async () => {
  const manifest = require('../frontend/src/release-runtime-sentinels.json');
  const frontendSource = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? frontendSource(file) : /\.(tsx?|css)$/.test(file) && !/\.test\./.test(file) ? [fs.readFileSync(file, 'utf8')] : [];
  });
  const corpus = frontendSource(path.join(root, 'frontend/src')).join('\n');
  for (const sentinel of [...manifest.runtime, ...manifest.attendanceTimePolicy]) {
    assert.ok(corpus.includes(sentinel), `sentinel absent from frontend source: ${sentinel}`);
    await assert.rejects(verifyPublicRuntime({
      baseUrl: 'https://fixture.example', html: '<script type="module" src="/assets/index.js"></script>',
      sentinels: [...manifest.runtime, ...manifest.attendanceTimePolicy], onLog: () => {},
      fetchImpl: async url => ({ status: 200, url, headers: new Map([['content-type', 'application/javascript']]),
        text: async () => [...manifest.runtime, ...manifest.attendanceTimePolicy].filter(value => !value.includes(sentinel)).join('\n') })
    }), /missing runtime sentinels/);
  }
});

test('protected workflow fails closed on an incomplete or malformed manifest', () => {
  const { runInNewContext } = require('node:vm');
  const manifest = require('../frontend/src/release-runtime-sentinels.json');
  const start = workflow.indexOf("const manifest = require('/tmp/sms-release-control-plane/release-runtime-sentinels.json');");
  const end = workflow.indexOf('const { verifyPublicRuntime }', start);
  assert.ok(start >= 0 && end > start, 'could not isolate runtime manifest validation block');
  const validation = workflow.slice(start, end);
  for (const key of ['artifact', 'runtime', 'attendanceTimePolicy']) {
    for (const entries of [[], manifest[key].slice(1), [...manifest[key].slice(1), '']]) {
      assert.throws(() => runInNewContext(validation, { require: () => ({ ...manifest, [key]: entries }), process: { env: {} } }), /Invalid release sentinel manifest/);
    }
  }
});
