const { expect } = require('@playwright/test');
const { getNavigationItem } = require('./uat-v3-role-matrix');
const { sanitizeUatDiagnostic } = require('./uat-v3-security');

const harmlessConsoleMessages = [/ResizeObserver loop limit exceeded/i];
const harmlessRequestFailures = [/net::ERR_ABORTED/i];

function apiPath(response) {
  try {
    return new URL(response.url()).pathname;
  } catch {
    return '';
  }
}

const sanitizeDiagnostic = sanitizeUatDiagnostic;

function requestTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[INVALID_URL]';
  }
}

function requestPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isHarmlessConsoleError(message) {
  if (message.type() !== 'error') return false;
  const location = message.location();
  const isUnauthenticatedRefresh = requestPath(location.url) === '/api/v1/auth/refresh'
    && /Failed to load resource: the server responded with a status of 403/i.test(message.text());
  return isUnauthenticatedRefresh || harmlessConsoleMessages.some((pattern) => pattern.test(message.text()));
}

function matchesApiResponseRule(response, rule) {
  const pathMatches = rule?.path instanceof RegExp
    ? rule.path.test(response.path)
    : response.path === rule?.path;
  const methodMatches = rule?.method === undefined || response.method === rule.method;
  const statusMatches = rule?.status === undefined || response.status === rule.status;
  return pathMatches && methodMatches && statusMatches;
}

function normalizeAllowedApiResponseRule(rule) {
  const path = typeof rule?.path === 'string' ? rule.path : '';
  const method = String(rule?.method || '').toUpperCase();
  const status = Number(rule?.status);
  if (!/^\/api\/v1\/[A-Za-z0-9._~!$&'()+,;=:@%\/-]+$/.test(path)) throw new Error('UAT_ALLOWED_API_RULE_PATH_INVALID');
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('UAT_ALLOWED_API_RULE_METHOD_REQUIRED');
  if (!Number.isInteger(status) || status < 400 || status > 599) throw new Error('UAT_ALLOWED_API_RULE_STATUS_REQUIRED');
  return { path, method, status };
}

function startPageMonitor(page, { allowedApiResponses = [] } = {}) {
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const responses = [];
  const allowedResponseRules = [
    { path: '/api/v1/auth/refresh' },
    ...allowedApiResponses.map(normalizeAllowedApiResponseRule)
  ];

  page.on('pageerror', (error) => pageErrors.push(sanitizeDiagnostic(error.message)));
  page.on('console', (message) => {
    if (!isHarmlessConsoleError(message)) {
      consoleErrors.push({
        text: sanitizeDiagnostic(message.text()),
        authorizationFailure: /Failed to load resource: the server responded with a status of 403/i.test(message.text())
      });
    }
  });
  page.on('requestfailed', (request) => {
    if (!['document', 'xhr', 'fetch', 'script', 'stylesheet'].includes(request.resourceType())) return;
    const failure = request.failure()?.errorText || 'unknown request failure';
    if (!harmlessRequestFailures.some((pattern) => pattern.test(failure))) requestFailures.push(`${request.method()} ${requestTarget(request.url())} ${sanitizeDiagnostic(failure)}`);
  });
  page.on('response', (response) => {
    const path = apiPath(response);
    if (path.startsWith('/api/v1/')) responses.push({ path, status: response.status(), method: response.request().method() });
  });

  const unexpectedApiResponses = () => responses
    .filter((response) => response.status >= 400 && !allowedResponseRules.some((rule) => matchesApiResponseRule(response, rule)))
    .map((response) => ({ path: response.path, method: response.method, status: response.status, classification: 'UNEXPECTED_API_RESPONSE' }));

  const safeEvidence = () => ({
    secondaryApiFailures: unexpectedApiResponses(),
    pageErrorCount: pageErrors.length,
    consoleErrorCount: consoleErrors.filter((error) => !error.authorizationFailure).length,
    requestFailureCount: requestFailures.length
  });

  return {
    responses,
    safeEvidence,
    safeUnexpectedApiResponses: unexpectedApiResponses,
    assertClean() {
      const remainingRules = [...allowedResponseRules];
      const unexpectedConsoleErrors = consoleErrors.filter((error) => {
        if (!error.authorizationFailure) return true;
        const ruleIndex = remainingRules.findIndex((rule) => responses.some((response) => matchesApiResponseRule(response, rule)));
        if (ruleIndex < 0) return true;
        remainingRules.splice(ruleIndex, 1);
        return false;
      }).map((error) => error.text);
      const unexpectedApiResponseLines = unexpectedApiResponses().map((response) => `${response.method} ${response.path} ${response.status}`);
      const runtimeFailure = responses.find((response) => response.status >= 500 && !allowedResponseRules.some((rule) => matchesApiResponseRule(response, rule)));
      if (runtimeFailure) {
        throw safeApiError(apiFailureCode(runtimeFailure.path, runtimeFailure.status), runtimeFailure.status);
      }
      expect(pageErrors, 'Unexpected page errors.').toEqual([]);
      expect(unexpectedApiResponseLines, 'Unexpected API responses.').toEqual([]);
      expect(unexpectedConsoleErrors, 'Unexpected console errors.').toEqual([]);
      expect(requestFailures, 'Unexpected document/XHR/fetch failures.').toEqual([]);
    }
  };
}

function primaryNavigation(page) {
  return page.locator('nav.nav-menu').first().locator('button.nav-item:visible');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function primaryNavigationItem(page, navigationId) {
  const item = getNavigationItem(navigationId);
  return primaryNavigationItemByLabel(page, item.label);
}

function primaryNavigationItemByLabel(page, label) {
  const escapedLabel = escapeRegExp(label);
  return primaryNavigation(page).filter({ hasText: new RegExp(`${escapedLabel}\\s*\\d*$`) });
}

async function openPrimaryNavigation(page) {
  const menuButton = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
  await expect(page.locator('nav.nav-menu').first(), 'Primary navigation must be visible.').toBeVisible();
}

async function expectPrimaryNavigationItem(page, navigationId) {
  const item = getNavigationItem(navigationId);
  const navigationItem = primaryNavigationItem(page, navigationId);
  await expect(navigationItem, `Primary navigation must expose exactly one ${item.label}.`).toHaveCount(1);
  await expect(navigationItem, `Primary navigation must expose ${item.label}.`).toBeVisible();
}

async function navigateTo(page, navigationId) {
  const item = getNavigationItem(navigationId);
  await openPrimaryNavigation(page);
  const navigationItem = primaryNavigationItem(page, navigationId);
  await expect(navigationItem, `Primary navigation must expose exactly one ${item.label}.`).toHaveCount(1);
  await navigationItem.click();
}

const reportCenterTabLabels = Object.freeze({
  executive: 'ภาพรวมผู้บริหาร',
  details: 'รายงานรายละเอียด',
  export: 'Export'
});

function reportCenterPage(page) {
  return page.locator('section.report-center-page[aria-label="ศูนย์รายงานและวิเคราะห์"]').first();
}

async function navigateToReportCenter(page, tab = 'executive') {
  const tabLabel = reportCenterTabLabels[tab];
  if (!tabLabel) throw new Error(`Unsupported UAT report center tab: ${tab}`);
  await navigateTo(page, 'reportCenter');
  const center = reportCenterPage(page);
  await expect(center, 'Unified Report Center must be visible.').toBeVisible();
  const tabButton = center.getByRole('tab', { name: tabLabel, exact: true });
  await expect(tabButton, `Report Center must expose ${tabLabel}.`).toHaveCount(1);
  if (await tabButton.getAttribute('aria-selected') !== 'true') await tabButton.click();
  await expect(tabButton).toHaveAttribute('aria-selected', 'true');
  return center;
}

function apiRouteCode(path) {
  if (path === '/api/v1/dashboard') return 'DASHBOARD';
  if (path === '/api/v1/executive-report') return 'EXECUTIVE_REPORT';
  if (path === '/api/v1/reports/summary') return 'REPORT_SUMMARY';
  return 'API';
}

function apiFailureCode(path, status) {
  const suffix = status === 504 ? '504' : `HTTP_${status}`;
  return `UAT_RUNTIME_${apiRouteCode(path)}_${suffix}`;
}

function apiResponseTimeoutCode(path) {
  return `UAT_RUNTIME_${apiRouteCode(path)}_RESPONSE_TIMEOUT`;
}

function safeApiError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

async function observeApiResponse(page, path, trigger, { timeout = 60_000 } = {}) {
  const responsePromise = page.waitForResponse(
    (response) => apiPath(response) === path && response.request().method() === 'GET',
    { timeout }
  );
  let response;
  try {
    await trigger();
    response = await responsePromise;
  } catch (error) {
    if (error?.code?.startsWith('UAT_')) throw error;
    const code = error?.name === 'TimeoutError'
      ? apiResponseTimeoutCode(path)
      : `UAT_UI_${apiRouteCode(path)}_TRIGGER_FAILED`;
    throw safeApiError(code);
  }

  const status = response.status();
  if (status === 504) throw safeApiError(apiFailureCode(path, status), status);
  if (status >= 500) throw safeApiError(apiFailureCode(path, status), status);
  if (status < 200 || status >= 300) throw safeApiError(apiFailureCode(path, status), status);
  return response;
}

async function expectApiSuccess(page, path, trigger) {
  return observeApiResponse(page, path, trigger);
}

async function assertNoHorizontalOverflow(page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow, 'Page-level horizontal overflow is not allowed.').toBe(false);
}

async function captureScreenshot(page, testInfo, name, { allowLoginForm = false } = {}) {
  if (!allowLoginForm) {
    await expect(page.locator('form.login-form')).toHaveCount(0);
    await expect(page.locator('input[type="password"]:visible')).toHaveCount(0);
  }
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

module.exports = {
  assertNoHorizontalOverflow,
  apiFailureCode,
  apiResponseTimeoutCode,
  captureScreenshot,
  expectApiSuccess,
  observeApiResponse,
  expectPrimaryNavigationItem,
  isHarmlessConsoleError,
  navigateTo,
  navigateToReportCenter,
  normalizeAllowedApiResponseRule,
  openPrimaryNavigation,
  primaryNavigation,
  primaryNavigationItem,
  primaryNavigationItemByLabel,
  reportCenterPage,
  reportCenterTabLabels,
  requestPath,
  requestTarget,
  sanitizeDiagnostic,
  startPageMonitor
};
