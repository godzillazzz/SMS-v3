'use strict';

// Dependency-free fallback for isolated/offline reviews; runs actual TS functions
// with browser/fetch fixtures. This does not replace Vitest or browser acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const root = process.env.R71_SOURCE_ROOT || path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = source => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('R7.1 actual routing preserves month/year and limits inherited type to the center', async () => {
  let href = 'https://fixture.example/app/roster/approvals?type=SCHEDULE&month=10&year=2026&page=4';
  const history = { state: {}, pushState(state, unused, target) { this.state = state; href = new URL(target, href).href; }, replaceState(state, unused, target) { this.pushState(state, unused, target); } };
  global.window = { location: { get href() { return href; } }, history, dispatchEvent() {} };
  try {
    const { navigate, navigateSettingsSection } = await load(read('frontend/src/routing.ts'));
    assert.equal(navigate('approvalCenter').searchParams.get('type'), 'SCHEDULE');
    assert.equal(navigate('employees').search, '?month=10&year=2026');
    href += '&type=LEAVE&status=PENDING';
    assert.equal(navigateSettingsSection('notifications').search, '?month=10&year=2026');
    assert.equal(navigate('employees', { query: { department: 'AN1' } }).searchParams.get('department'), 'AN1');
    assert.equal(navigate('employees', { preserveQuery: false }).search, '');
  } finally { delete global.window; }
});

test('R7.1 actual summary client deduplicates, invalidates, separates auth and rejects stale generations', async () => {
  const api = read('frontend/src/api.ts');
  const errorHelpers = api.slice(api.indexOf('export function normalizeRequestId'), api.indexOf('function responseRequestId'))
    + api.slice(api.indexOf('export class ApiRequestError'), api.indexOf('export type ScheduleBatchChange'));
  const source = read('frontend/src/approval-center-client.ts').replace(/^import .*;\n/m, '').replace('import.meta.env.VITE_API_BASE_URL', 'undefined');
  global.document = { cookie: '' };
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let count = 0;
  let settle;
  global.fetch = async () => { count++; return { ok: true, json: async () => ({ summary: { total: count } }) }; };
  try {
    const client = await load(errorHelpers + source);
    await Promise.all([client.getApprovalCenterSummary('a'), client.getApprovalCenterSummary('a')]);
    await client.getApprovalCenterSummary('a');
    assert.equal(count, 1);
    client.invalidateApprovalCenterSummary();
    await client.getApprovalCenterSummary('a');
    assert.equal(count, 2);
    await client.getApprovalCenterSummary('b');
    assert.equal(count, 3);
    client.invalidateApprovalCenterSummary();
    global.fetch = () => { count++; return new Promise(resolve => { settle = resolve; }); };
    const old = client.getApprovalCenterSummary('b');
    global.fetch = async () => { count++; return { ok: true, json: async () => ({ summary: { total: 5 } }) }; };
    await client.getApprovalCenterSummary('b', { forceRefresh: true });
    settle({ ok: true, json: async () => ({ summary: { total: 4 } }) });
    assert.equal((await old).summary.total, 5);
    assert.equal((await client.getApprovalCenterSummary('b')).summary.total, 5);
    assert.equal(count, 5);
    Date.now = () => originalNow() + 2001;
    await client.getApprovalCenterSummary('b');
    assert.equal(count, 6);
    Date.now = originalNow;
    client.invalidateApprovalCenterSummary();
    global.fetch = async () => { count++; throw new Error('fixture network failure'); };
    await assert.rejects(client.getApprovalCenterSummary('b'), /fixture network failure/);
    global.fetch = async () => { count++; return { ok: true, json: async () => ({ summary: { total: 8 } }) }; };
    await client.getApprovalCenterSummary('b');
    assert.equal(count, 8);
  } finally { global.fetch = originalFetch; Date.now = originalNow; delete global.document; }
});

function contrast(foreground, background) {
  const luminance = hex => {
    const rgb = hex.match(/[\da-f]{2}/gi).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('R7.1 semantic CSS source contracts and dark token contrast are AA', () => {
  const css = read('frontend/src/styles/r71-theme-contrast.css');
  for (const selector of ['.dashboard-quick-actions__grid button small', '.rule-summary-grid strong', '.topbar-profile small', '.month-filter']) assert.ok(css.includes(selector));
  assert.ok(css.includes('var(--color-text-secondary) !important'));
  assert.ok(css.includes('var(--color-text) !important'));
  const audit = read('frontend/src/styles/audit-compliance.css');
  for (const rule of audit.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/audit-(action|module|role)-badge/.test(rule[1]) || !/background:/.test(rule[2])) continue;
    for (const property of ['color', 'background', 'border']) assert.match(rule[2], new RegExp(`(?:^|;)${property}:[^;]*var\\(--color-`));
  }
  const tokens = read('frontend/src/styles/tokens.css').slice(read('frontend/src/styles/tokens.css').indexOf('--color-text: #f3f5fb'));
  const token = name => tokens.match(new RegExp(`--color-${name}: (#[0-9a-f]+)`))[1];
  for (const background of ['#061421', '#071725', '#0f1d2a', '#161e30', '#1b2334']) {
    assert.ok(contrast(token('text-secondary'), background) >= 4.5);
    assert.ok(contrast(token('text'), background) >= 4.5);
  }
  for (const tone of ['success', 'info']) assert.ok(contrast(token(tone), token(tone + '-soft')) >= 4.5);
  const main = read('frontend/src/main.tsx');
  assert.ok(main.indexOf("import './styles/r71-theme-contrast.css'") > main.indexOf("import './styles/operational-layer.css'"));
  const page = read('frontend/src/pages/approvals/ApprovalCenterPage.tsx');
  assert.ok(page.includes('getApprovalCenter(token, { forceRefresh })'));
  assert.ok(page.includes('getApprovalCenterSummary(token, { forceRefresh })'));
  assert.ok(page.includes('await loadQueue(true)'));
  assert.ok(page.includes('onClick={() => void loadQueue(true)}'));
  assert.ok(page.includes('onSummaryLoaded?.(authoritativeSummary?.summary)'));
  assert.ok(main.includes('onSummaryLoaded='));
  assert.ok(main.includes('invalidateApprovalCenter()'));
});
