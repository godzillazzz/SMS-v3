const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  G03_READONLY_SCOPE,
  G03_READONLY_TEST_TITLES,
  getUatConfig,
  getUatScopeGrep,
  getUatScopeTestTitles,
  isG03ReadonlyTargeted,
  normalizeUatScope
} = require('../e2e/helpers/uat-config');
const {
  classifyG03BusinessMutation,
  emptyMutationCounts,
  safeApiPath,
  summarizeSelectorOptions
} = require('../e2e/helpers/uat-g03-readonly');

const specSource = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/g03-readonly.spec.js'), 'utf8');
const configuredEnvironment = {
  UAT_BASE_URL: 'https://candidate.example.test',
  UAT_MODE: 'authenticated',
  UAT_SCOPE: G03_READONLY_SCOPE,
  UAT_ADMIN_EMAIL: 'admin@example.test',
  UAT_ADMIN_PASSWORD: 'admin-password',
  UAT_MANAGER_EMAIL: 'manager@example.test',
  UAT_MANAGER_PASSWORD: 'manager-password',
  UAT_VIEWER_EMAIL: 'viewer@example.test',
  UAT_VIEWER_PASSWORD: 'viewer-password'
};

test('G03 fixed scope resolves to exactly the three approved read-only tests', () => {
  assert.equal(normalizeUatScope(G03_READONLY_SCOPE), G03_READONLY_SCOPE);
  assert.equal(isG03ReadonlyTargeted(configuredEnvironment), true);
  assert.deepEqual(getUatScopeTestTitles(configuredEnvironment), G03_READONLY_TEST_TITLES);
  assert.deepEqual(G03_READONLY_TEST_TITLES, [
    'G03 ADMIN: leave quota provisioning read-only contract',
    'G03 MANAGER: leave quota provisioning control is absent',
    'G03 VIEWER: leave quota provisioning control is absent'
  ]);
  assert.equal(getUatConfig(configuredEnvironment).scope, G03_READONLY_SCOPE);
});

test('G03 scope grep is a fixed title allowlist and unknown scopes fail closed', () => {
  const grep = getUatScopeGrep(configuredEnvironment);
  assert.ok(grep instanceof RegExp);
  for (const title of G03_READONLY_TEST_TITLES) {
    assert.equal(grep.test(`g03-readonly.spec.js › ${title}`), true, title);
  }
  assert.equal(grep.test('g03-readonly.spec.js › G03 ADMIN: leave quota provisioning read-only contract extra'), false);
  assert.equal(grep.test('authenticated-v3.spec.js › V3 ADMIN: navigation shell'), false);
  assert.equal(grep.test('performance-validation.spec.js › V3 PERFORMANCE: matched strictly-sequential canonical versus candidate benchmark'), false);
  assert.throws(() => normalizeUatScope('g03-readonly-targeted|.*'), { code: 'UAT_SCOPE_NOT_APPROVED' });
  assert.throws(() => getUatScopeTestTitles({ ...configuredEnvironment, UAT_SCOPE: '--grep' }), { code: 'UAT_SCOPE_NOT_APPROVED' });
  assert.throws(
    () => getUatConfig({ ...configuredEnvironment, UAT_MODE: 'technical' }),
    { code: 'UAT_SCOPE_MODE_INVALID' }
  );
});

test('G03 mutation classifier allows authentication mechanics and rejects business writes by category', () => {
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/auth/login'), undefined);
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/auth/refresh'), undefined);
  assert.equal(classifyG03BusinessMutation('GET', '/api/v1/leave-quotas'), undefined);
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/leave-quotas'), 'leaveQuotaPost');
  assert.equal(classifyG03BusinessMutation('PUT', '/api/v1/leave-quotas/quota-id'), 'leaveQuotaPut');
  assert.equal(classifyG03BusinessMutation('PUT', '/api/v1/leave-quotas/quota-id/link'), 'leaveQuotaLink');
  assert.equal(classifyG03BusinessMutation('DELETE', '/api/v1/leave-quotas/quota-id'), 'leaveQuotaDelete');
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/employees'), 'employeeMutation');
  assert.equal(classifyG03BusinessMutation('PATCH', '/api/v1/employees/employee-id'), 'employeeMutation');
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/leave-requests'), 'leaveMutation');
  assert.equal(classifyG03BusinessMutation('PUT', '/api/v1/schedule-approvals/id'), 'scheduleMutation');
  assert.equal(classifyG03BusinessMutation('POST', '/api/v1/licenses'), 'licenseMutation');
  assert.equal(classifyG03BusinessMutation('PUT', '/api/v1/system-settings'), 'unexpectedBusinessWrites');
  assert.deepEqual(emptyMutationCounts(), {
    leaveQuotaPost: 0,
    leaveQuotaPut: 0,
    leaveQuotaLink: 0,
    leaveQuotaDelete: 0,
    employeeMutation: 0,
    leaveMutation: 0,
    scheduleMutation: 0,
    licenseMutation: 0,
    unexpectedBusinessWrites: 0
  });
});

test('G03 mutation evidence uses pathname only and selector summary exposes aggregate structure without PII', () => {
  assert.equal(safeApiPath('https://candidate.example.test/api/v1/leave-quotas?employeeId=private-value'), '/api/v1/leave-quotas');
  const summary = summarizeSelectorOptions([
    { value: '', label: '— เลือก —' },
    { value: 'opaque-id-1', label: 'EMP001 · Example Person · Security' },
    { value: 'opaque-id-2', label: 'EMP002 · Another Person · Operations' }
  ]);
  assert.deepEqual(summary, {
    selectorLoaded: true,
    candidateCount: 2,
    codeRenderingPresent: true,
    nameRenderingPresent: true,
    departmentRenderingPresent: true
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /Example Person|Another Person|EMP001|EMP002|Security|Operations/);
});

test('G03 browser spec is cancel-only and contains the exact read-only UI contract', () => {
  for (const title of G03_READONLY_TEST_TITLES) assert.match(specSource, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(specSource, /navigateTo\(page, 'quota'\)/);
  assert.match(specSource, /กำหนดโควตาวันลา/);
  assert.match(specSource, /toHaveValue\('30'\)/);
  assert.match(specSource, /toHaveValue\('6'\)/);
  assert.match(specSource, /toHaveValue\('10'\)/);
  assert.match(specSource, /ตามสิทธิ์ที่กำหนด \(วัน\)/);
  assert.match(specSource, /ตามสิทธิ์ประจำปี \(วัน\)/);
  assert.match(specSource, /getByRole\('button', \{ name: 'ยกเลิก'/);
  assert.doesNotMatch(specSource, /getByRole\('button', \{ name: 'บันทึกโควตา'/);
  assert.doesNotMatch(specSource, /api\.createLeaveQuota/);
  assert.match(specSource, /runWithG03MutationGuard/);
});


test('G03 reporter aggregates only sanitized mutation/UI evidence', () => {
  const UatSummaryReporter = require('../e2e/uat-reporter');
  const reporter = new UatSummaryReporter({ outputFile: 'test-results/unused-summary.md', jsonOutputFile: 'test-results/unused-results.json' });
  const fakeTest = { titlePath: () => ['root', 'g03-readonly.spec.js', 'G03 ADMIN: leave quota provisioning read-only contract'] };
  reporter.onTestEnd(fakeTest, {
    status: 'passed',
    duration: 1,
    errors: [],
    attachments: [
      {
        name: 'g03-mutation-guard.json',
        body: Buffer.from(JSON.stringify({
          ...emptyMutationCounts(),
          blockedBusinessWrites: []
        }))
      },
      {
        name: 'g03-ui-summary.json',
        body: Buffer.from(JSON.stringify({
          role: 'ADMIN',
          quotaPageLoaded: true,
          provisionControlVisible: true,
          candidateCount: 2,
          codeRenderingPresent: true,
          nameRenderingPresent: true,
          departmentRenderingPresent: true,
          legacyWarning: 'NOT_TRIGGERED_BY_CURRENT_DATA',
          employeeName: 'must-not-survive',
          employeeEmail: 'must-not-survive@example.test'
        }))
      }
    ]
  });
  assert.equal(reporter.g03Readonly.seenTests, 1);
  assert.deepEqual(reporter.g03Readonly.mutationGuard, {
    ...emptyMutationCounts(),
    blockedBusinessWrites: []
  });
  assert.equal(reporter.g03Readonly.roles.ADMIN.candidateCount, 2);
  assert.equal(reporter.g03Readonly.roles.ADMIN.employeeName, undefined);
  assert.equal(reporter.g03Readonly.roles.ADMIN.employeeEmail, undefined);
  assert.doesNotMatch(JSON.stringify(reporter.g03Readonly), /must-not-survive/);
});
