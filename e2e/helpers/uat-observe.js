const { expect } = require('@playwright/test');

const harmlessConsoleMessages = [/ResizeObserver loop limit exceeded/i];
const harmlessRequestFailures = [/net::ERR_ABORTED/i];

function apiPath(response) {
  try {
    return new URL(response.url()).pathname;
  } catch {
    return '';
  }
}

function sanitizeDiagnostic(value) {
  return String(value || '')
    .replace(/(authorization|cookie|password|secret|token|otp|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
}

function requestTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[INVALID_URL]';
  }
}

function startPageMonitor(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const responses = [];

  page.on('pageerror', (error) => pageErrors.push(sanitizeDiagnostic(error.message)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (!harmlessConsoleMessages.some((pattern) => pattern.test(message.text()))) consoleErrors.push(sanitizeDiagnostic(message.text()));
  });
  page.on('requestfailed', (request) => {
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return;
    const failure = request.failure()?.errorText || 'unknown request failure';
    if (!harmlessRequestFailures.some((pattern) => pattern.test(failure))) requestFailures.push(`${request.method()} ${requestTarget(request.url())} ${sanitizeDiagnostic(failure)}`);
  });
  page.on('response', (response) => {
    const path = apiPath(response);
    if (path.startsWith('/api/v1/')) responses.push({ path, status: response.status(), method: response.request().method() });
  });

  return {
    responses,
    assertClean() {
      expect(pageErrors, 'Unexpected page errors.').toEqual([]);
      expect(consoleErrors, 'Unexpected console errors.').toEqual([]);
      expect(requestFailures, 'Unexpected document/XHR/fetch failures.').toEqual([]);
    }
  };
}

async function navigateTo(page, label) {
  const menuButton = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
  await page.getByRole('button', { name: new RegExp(label) }).click();
}

async function expectApiSuccess(page, path, trigger) {
  const responsePromise = page.waitForResponse((response) => apiPath(response) === path && response.request().method() === 'GET');
  await trigger();
  const response = await responsePromise;
  expect(response.status(), `${path} must respond successfully.`).toBeGreaterThanOrEqual(200);
  expect(response.status(), `${path} must respond successfully.`).toBeLessThan(300);
}

async function assertNoHorizontalOverflow(page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow, 'Page-level horizontal overflow is not allowed.').toBe(false);
}

async function captureScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

module.exports = { assertNoHorizontalOverflow, captureScreenshot, expectApiSuccess, navigateTo, requestTarget, sanitizeDiagnostic, startPageMonitor };
