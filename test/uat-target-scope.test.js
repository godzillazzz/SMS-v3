const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TARGETED_AUTH_RETRY_SCOPE,
  TARGETED_AUTH_RETRY_TEST_TITLES,
  getUatScopeGrep,
  getUatScopeTestTitles
} = require('../e2e/helpers/uat-config');

const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
const playwrightConfig = fs.readFileSync(path.resolve(__dirname, '../playwright.config.js'), 'utf8');

test('targeted Auth scope selects exactly the approved eight tests', () => {
  const titles = getUatScopeTestTitles({ UAT_MODE: 'authenticated', UAT_SCOPE: TARGETED_AUTH_RETRY_SCOPE });
  assert.deepEqual(titles, TARGETED_AUTH_RETRY_TEST_TITLES);
  assert.equal(titles.length, 8);
  assert.equal(titles.filter((title) => title.includes('VIEWER')).length, 0);
  assert.equal(titles.filter((title) => title.includes('disposable')).length, 0);
  assert.equal(titles.filter((title) => title.includes('performance')).length, 0);
  assert.deepEqual(titles.filter((title) => title.includes('License') || title.includes('Report Center exact')), [
    'V3 ADMIN: License initial-load network contract',
    'V3 ADMIN: Report Center exact network contract'
  ]);
});

test('targeted Auth scope grep matches only the fixed test-title allowlist', () => {
  const grep = getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: TARGETED_AUTH_RETRY_SCOPE });
  assert.ok(grep instanceof RegExp);
  for (const title of TARGETED_AUTH_RETRY_TEST_TITLES) {
    assert.equal(grep.test('authenticated-v3.spec.js › ' + title), true, title);
  }
  assert.equal(grep.test('authenticated-v3.spec.js › V3 VIEWER: navigation shell'), false);
  assert.equal(grep.test('performance-validation.spec.js › V3 PERFORMANCE: matched strictly-sequential canonical versus candidate benchmark'), false);
  assert.equal(grep.test('authenticated-v3.spec.js › V3 ADMIN: navigation shell extra'), false);
  assert.equal(grep.test('authenticated-v3.spec.js › V3 ADMIN: navigation shell|.*'), false);
});

test('full, Report Center diagnostic, and technical scopes do not inherit targeted grep', () => {
  assert.equal(getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: 'full' }), undefined);
  assert.equal(getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: 'report-center-diagnostic' }), undefined);
  assert.equal(getUatScopeGrep({ UAT_MODE: 'technical', UAT_SCOPE: 'full' }), undefined);
  assert.equal(getUatScopeGrep({ UAT_MODE: 'technical', UAT_SCOPE: 'report-center-diagnostic' }), undefined);
});

test('unknown scope cannot become a Playwright selector or command fragment', () => {
  assert.throws(() => getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: 'admin-rbac-targeted-retry|.*' }), { code: 'UAT_SCOPE_NOT_APPROVED' });
  assert.throws(() => getUatScopeTestTitles({ UAT_MODE: 'authenticated', UAT_SCOPE: '--grep' }), { code: 'UAT_SCOPE_NOT_APPROVED' });
});

test('workflow exposes the fixed targeted scope and binds technical identity secrets', () => {
  const technicalJob = workflow.slice(workflow.indexOf('technical-smoke:'), workflow.indexOf('authenticated-uat:'));
  assert.equal((workflow.match(/- admin-rbac-targeted-retry/g) || []).length, 1);
  assert.match(workflow, /UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/);
  assert.match(playwrightConfig, /getUatScopeGrep/);
  assert.doesNotMatch(workflow, /grep:\s*\$\{\{ inputs\.uat_scope \}\}/);
  assert.match(technicalJob, /environment: production-sms-v3-staging/);
});
