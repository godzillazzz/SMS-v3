const test = require('node:test');
const assert = require('node:assert/strict');
const { apiFailureCode, apiResponseTimeoutCode } = require('../e2e/helpers/uat-observe');
const { createStageTracker, durationBucket, safeApiPath, stageCodes } = require('../e2e/helpers/uat-stage');
const { artifactLeakReasons } = require('../e2e/helpers/uat-v3-security');

function testInfoFor(attachments) {
  return {
    async attach(name, attachment) {
      attachments.push({ name, value: JSON.parse(attachment.body.toString('utf8')) });
    }
  };
}

test('UAT stage registry and duration buckets are deterministic', () => {
  assert.ok(stageCodes.includes('RC03_EXEC_REQUEST'));
  assert.ok(stageCodes.includes('RC07_DETAILS_RESPONSE'));
  assert.equal(durationBucket(0), '<1s');
  assert.equal(durationBucket(4999), '1-5s');
  assert.equal(durationBucket(60000), '>=60s');
  assert.equal(safeApiPath('/api/v1/executive-report?year=2026&month=8'), '/api/v1/executive-report');
  assert.equal(safeApiPath('/api/v1/dashboard'), '/api/v1/dashboard');
  assert.equal(safeApiPath('/not-an-api-path'), undefined);
});

test('UAT stage artifact is allowlisted and strips sensitive values', async () => {
  const attachments = [];
  const tracker = createStageTracker({ role: 'ADMIN', testCode: 'REPORT_CENTER', testInfo: testInfoFor(attachments) });
  await tracker.run('RC03_EXEC_REQUEST', async () => ({ status: () => 200 }), {
    safeApiPath: '/api/v1/executive-report?token=not-safe'
  });
  await tracker.attach();
  assert.equal(attachments.length, 1);
  const stage = attachments[0].value;
  assert.deepEqual(Object.keys(stage).sort(), [
    'currentStage', 'durationBucket', 'lastCompletedStage', 'role', 'safeApiPath', 'safeErrorCode', 'safeStatus', 'state', 'testCode'
  ].sort());
  assert.equal(stage.safeApiPath, '/api/v1/executive-report');
  assert.equal(JSON.stringify(stage).includes('token'), false);
});

test('UAT stage failure preserves explicit runtime code without raw error text', async () => {
  const attachments = [];
  const tracker = createStageTracker({ role: 'MANAGER', testCode: 'DASHBOARD_DIAGNOSTIC', testInfo: testInfoFor(attachments) });
  await assert.rejects(
    tracker.run('NAV03_DASHBOARD', async () => {
      const error = new Error('Authorization: Bearer secret must never appear');
      error.code = 'UAT_RUNTIME_DASHBOARD_504';
      error.status = 504;
      throw error;
    }, { safeApiPath: '/api/v1/dashboard' }),
    /Authorization/
  );
  await tracker.attach();
  assert.equal(attachments[0].value.safeErrorCode, 'UAT_RUNTIME_DASHBOARD_504');
  assert.equal(JSON.stringify(attachments[0].value).includes('Bearer'), false);
  assert.equal(attachments[0].value.safeStatus, 504);
});

test('UAT API failures distinguish runtime 504 and response timeout', () => {
  assert.equal(apiFailureCode('/api/v1/dashboard', 504), 'UAT_RUNTIME_DASHBOARD_504');
  assert.equal(apiFailureCode('/api/v1/reports/summary', 503), 'UAT_RUNTIME_REPORT_SUMMARY_HTTP_503');
  assert.equal(apiResponseTimeoutCode('/api/v1/executive-report'), 'UAT_RUNTIME_EXECUTIVE_REPORT_RESPONSE_TIMEOUT');
});

test('UAT stage registry rejects unknown stages and scanner blocks injected auth material', () => {
  const attachments = [];
  const tracker = createStageTracker({ role: 'ADMIN', testCode: 'REPORT_CENTER', testInfo: testInfoFor(attachments) });
  assert.rejects(tracker.run('UNKNOWN_STAGE', async () => undefined), { code: 'UAT_STAGE_CODE_INVALID' });
  assert.deepEqual(
    artifactLeakReasons('test-results/uat-stage.json', 'Authorization: Bearer FAKE_AUTH_TOKEN_12345678901234567890'),
    ['AUTHORIZATION_HEADER']
  );
});
