const { test: base, expect } = require('@playwright/test');
const { automationBypassHeaders } = require('./technical-smoke');
const { sanitizeUatDiagnostic } = require('./uat-v3-security');
const { createHeavyReadSafetyTracker } = require('./uat-heavy-read-v3');

function authenticatedMode() {
  return String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
}

function sanitizeFailureErrors(testInfo) {
  if (!authenticatedMode()) return;
  for (const error of testInfo.errors || []) {
    if (typeof error.message === 'string') error.message = sanitizeUatDiagnostic(error.message);
    error.stack = undefined;
    error.errorContext = undefined;
  }
}

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
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

    const summaryAtTestEnd = heavySafety.summary();
    const safetyWaitStartedAt = Date.now();
    try {
      await heavySafety.assertNormalCompletion();
    } catch (error) {
      safetyError = error;
    } finally {
      const exceptionalDrainCount = summaryAtTestEnd.outstanding > 0 ? 1 : 0;
      const exceptionalDrainWaitMs = exceptionalDrainCount ? Math.max(0, Date.now() - safetyWaitStartedAt) : 0;
      await testInfo.attach('heavy-read-safety.json', {
        body: JSON.stringify({
          testsFinishingWithOutstandingHeavyReads: summaryAtTestEnd.outstanding > 0 ? 1 : 0,
          exceptionalHeavyDrainCount: exceptionalDrainCount,
          exceptionalHeavyDrainWaitMs: exceptionalDrainWaitMs,
          realHeavyStarts: summaryAtTestEnd.realHeavyStarts,
          preventedHeavyStarts: summaryAtTestEnd.preventedStarts,
          outstandingHeavyReads: summaryAtTestEnd.outstandingHeavyReads
        }),
        contentType: 'application/json'
      });
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
