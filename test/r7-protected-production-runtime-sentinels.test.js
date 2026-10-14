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
  // Parse the literal list used by the protected Production workflow. Do not
  // duplicate the values here or silently substitute a less strict checklist.
  const matches = [...workflow.matchAll(/const sentinels = \[([^\r\n]+)\];/g)];
  assert.equal(matches.length, 1, 'exactly one protected runtime sentinel list is required');
  const body = matches[0][1];
  const entries = [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
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
  assert.match(workflow, /'นโยบายเวลาลงงาน','ผ่อนผันการมาสาย \(นาที\)','latestCheckInEnabled'/);
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
