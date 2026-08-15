const { test: base, expect } = require('@playwright/test');
const { automationBypassHeaders } = require('./technical-smoke');
const { installHeavyReadSettlement } = require('./uat-heavy-read-settlement');
const { sanitizeUatDiagnostic } = require('./uat-v3-security');

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
    await use(page);
  },
  heavyReadSettlement: [async ({ page }, use) => {
    const tracker = installHeavyReadSettlement(page);
    try {
      await use();
    } finally {
      try {
        await tracker.drain();
      } finally {
        tracker.stop();
      }
    }
  }, { auto: true, timeout: 70_000 }]
});

test.afterEach(async ({}, testInfo) => {
  sanitizeFailureErrors(testInfo);
});

module.exports = { expect, test };
