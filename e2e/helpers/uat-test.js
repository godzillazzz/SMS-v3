const { test: base, expect } = require('@playwright/test');
const { automationBypassHeaders } = require('./technical-smoke');

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
  }
});

module.exports = { expect, test };
