const test = require('node:test');
const assert = require('node:assert/strict');
const { apiFailureCode, apiResponseTimeoutCode } = require('../e2e/helpers/uat-observe');
const { createStageTracker, durationBucket, safeApiPath, stageCodes } = require('../e2e/helpers/uat-stage');
const { artifactLeakReasons } = require('../e2e/helpers/uat-v3-security');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  assert.ok(stageCodes.includes('GQ06_MODAL'));
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

test('UAT stage diagnostics persist safe running and failure states', async () => {
  const diagnosticPath = path.join(os.tmpdir(), `sms-v3-uat-stage-${process.pid}.jsonl`);
  fs.rmSync(diagnosticPath, { force: true });
  const tracker = createStageTracker({
    role: 'ADMIN',
    testCode: 'REPORT_CENTER',
    diagnosticPath
  });
  try {
    await assert.rejects(tracker.run('RC03_EXEC_REQUEST', async () => {
      const error = new Error('safe diagnostic failure');
      error.code = 'UAT_RUNTIME_EXECUTIVE_REPORT_RESPONSE_TIMEOUT';
      throw error;
    }));
    const records = fs.readFileSync(diagnosticPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(records.some((record) => record.state === 'RUNNING' && record.currentStage === 'RC03_EXEC_REQUEST'));
    assert.ok(records.some((record) => record.state === 'FAIL' && record.safeErrorCode === 'UAT_RUNTIME_EXECUTIVE_REPORT_RESPONSE_TIMEOUT'));
    assert.equal(records.some((record) => JSON.stringify(record).includes('safe diagnostic failure')), false);
  } finally {
    fs.rmSync(diagnosticPath, { force: true });
  }
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
