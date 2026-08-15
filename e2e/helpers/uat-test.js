const fs = require('node:fs');
const { test: base, expect } = require('@playwright/test');
const { automationBypassHeaders } = require('./technical-smoke');
const { sanitizeUatDiagnostic } = require('./uat-v3-security');
const {
  createHeavyReadSafetyTracker,
  installSafetySummaryExitLog
} = require('./uat-heavy-read-v3');

function authenticatedMode() {
  return String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
}

function appendHeavyReadSafetyDiagnostic({ outstandingAtTestEnd, exceptionalDrainCount, exceptionalDrainWaitMs }) {
  const filePath = process.env.UAT_STAGE_DIAGNOSTIC_FILE;
  if (!authenticatedMode() || !filePath) return;
  fs.appendFileSync(filePath, `${JSON.stringify({
    role: 'SYSTEM',
    testCode: 'HEAVY_READ_SAFETY',
    currentStage: 'TEST_END',
    state: outstandingAtTestEnd === 0 ? 'PASS' : 'FAIL',
    safeApiPath: null,
    durationBucket: exceptionalDrainWaitMs === 0 ? '<1s' : 'exceptional',
    safeErrorCode: outstandingAtTestEnd === 0 ? null : 'UAT_UNEXPECTED_OUTSTANDING_HEAVY_READ',
    outstandingHeavyReadsAtTestEnd: outstandingAtTestEnd,
    exceptionalDrainCount,
    exceptionalDrainWaitMs
  })}\n`, 'utf8');
}
function sanitizeFailureErrors(testInfo) {
  if (!authenticatedMode()) return;
  for (const error of testInfo.errors || []) {
    if (typeof error.message === 'string') error.message = sanitizeUatDiagnostic(error.message);
    error.stack = undefined;
    error.errorContext = undefined;
  }
}

if (authenticatedMode()) installSafetySummaryExitLog();

const test = base.extend({
  page: async ({ page }, use) => {
    const targetUrl = process.env.UAT_BASE_URL;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const headers = automationBypassHeaders(
        process.env,
        targetUrl,
        request.url(),
        { setBypassCookie: true }
      );
      const requestHeaders = { ...request.headers() };
      delete requestHeaders['x-vercel-protection-bypass'];
      delete requestHeaders['x-vercel-set-bypass-cookie'];
      await route.continue({ headers: { ...requestHeaders, ...headers } });
    });

    const heavySafety = createHeavyReadSafetyTracker(page);
    let testError;
    let safetyError;
    try {
      await use(page);
    } catch (error) {
      testError = error;
    }

    const outstandingAtTestEnd = heavySafety.summary().outstanding;
    const safetyWaitStartedAt = Date.now();
    try {
      await heavySafety.assertNormalCompletion();
    } catch (error) {
      safetyError = error;
    } finally {
      const exceptionalDrainCount = outstandingAtTestEnd > 0 ? 1 : 0;
      const exceptionalDrainWaitMs = exceptionalDrainCount ? Math.max(0, Date.now() - safetyWaitStartedAt) : 0;
      appendHeavyReadSafetyDiagnostic({ outstandingAtTestEnd, exceptionalDrainCount, exceptionalDrainWaitMs });
      heavySafety.stop();
    }

    if (safetyError) throw safetyError;
    if (testError) throw testError;
  }
});

test.afterEach(async ({}, testInfo) => {
  sanitizeFailureErrors(testInfo);
});

module.exports = { expect, test };
