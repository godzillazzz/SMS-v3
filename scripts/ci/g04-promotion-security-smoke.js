'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { chromium } = require('@playwright/test');

const BASE_URL = String(process.env.EXPECTED_CANONICAL_URL || '');
const BYPASS = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '');
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const source = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

function staticContract() {
  const auth = source('src/routes/auth.routes.js');
  const review = source('src/routes/registration-requests.routes.js');
  const service = source('src/services/registration-request.service.js');
  const publicUi = source('frontend/src/main.tsx');
  if (auth.includes("router.get('/register/available-employees'")) fail('G04_PROMOTION_LEGACY_DIRECTORY_ROUTE_PRESENT');
  if (!review.includes("router.use(authorize('ADMIN', 'MANAGER'))")) fail('G04_PROMOTION_PRIVATE_REVIEW_GUARD_MISSING');
  if (!/const approveSchema\s*=\s*z\.object\(\{\}\)\.strict\(\)/.test(review)) fail('G04_PROMOTION_APPROVAL_SCHEMA_NOT_STRICT_EMPTY');
  if (!service.includes("role: 'VIEWER'") || !service.includes("accountStatus: 'ACTIVE'")) fail('G04_PROMOTION_VIEWER_ASSIGNMENT_MISSING');
  if (/role\s*:\s*(?:input|body|request|data)\./.test(service)) fail('G04_PROMOTION_ROLE_INPUT_AUTHORITY_PRESENT');
  if (/employeeId\s*:\s*(?:input|body|request|data)\./.test(auth)) fail('G04_PROMOTION_APPLICANT_EMPLOYEE_ID_AUTHORITY_PRESENT');
  if (publicUi.includes('available-employees')) fail('G04_PROMOTION_PUBLIC_EMPLOYEE_DIRECTORY_REFERENCE_PRESENT');
  console.log('G04_PROMOTION_STATIC_APPROVAL_ROLE=VIEWER_ONLY');
  console.log('G04_PROMOTION_STATIC_APPLICANT_ROLE_AUTHORITY=0');
  console.log('G04_PROMOTION_STATIC_APPLICANT_EMPLOYEE_ID_AUTHORITY=0');
}

function request(pathname) {
  const url = new URL(pathname, BASE_URL);
  const headers = { Accept: 'application/json' };
  if (BYPASS) headers['x-vercel-protection-bypass'] = BYPASS;
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: 30000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(Number(res.statusCode || 0)));
    });
    req.on('timeout', () => req.destroy(new Error('G04_PROMOTION_SECURITY_SMOKE_TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

async function apiSmoke() {
  const legacy = await request('/api/v1/auth/register/available-employees');
  if (legacy === 200) fail('G04_PROMOTION_ANONYMOUS_EMPLOYEE_ENUMERATION_REGRESSION');
  if (![401, 404].includes(legacy) && (legacy < 400 || legacy >= 500)) fail(`G04_PROMOTION_LEGACY_ROUTE_UNEXPECTED_${legacy}`);
  console.log(`G04_PROMOTION_ANONYMOUS_EMPLOYEE_DIRECTORY=${legacy}_NON_ENUMERATING`);

  const review = await request('/api/v1/registration-requests');
  if (review !== 401) fail(`G04_PROMOTION_PRIVATE_REVIEW_ANONYMOUS_${review}`);
  console.log('G04_PROMOTION_PRIVATE_REGISTRATION_ANONYMOUS=401_DENIED');
}

async function publicUiSmoke() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}
  });
  const page = await context.newPage();
  try {
    await page.route('**/api/v1/auth/refresh**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Authentication required.' }) }));
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: /ส่งคำขอลงทะเบียน/ }).click();
    await page.getByRole('heading', { name: 'ส่งคำขอลงทะเบียน', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    const form = page.locator('form.login-form');
    if (await form.locator('select').count() !== 0) fail('G04_PROMOTION_PUBLIC_EMPLOYEE_OR_ROLE_SELECTOR_PRESENT');
    if (await form.locator('datalist,[role="listbox"],[aria-autocomplete]').count() !== 0) fail('G04_PROMOTION_PUBLIC_EMPLOYEE_AUTOCOMPLETE_PRESENT');
    if (await form.locator('[name="employeeId"],[name="matchedEmployeeId"]').count() !== 0) fail('G04_PROMOTION_PUBLIC_EMPLOYEE_ID_FIELD_PRESENT');
    if (await form.locator('[name="role"]').count() !== 0) fail('G04_PROMOTION_PUBLIC_ROLE_FIELD_PRESENT');
    console.log('G04_PROMOTION_PUBLIC_REGISTRATION_UI=PASS');
    console.log('G04_PROMOTION_PUBLIC_EMPLOYEE_SELECTOR=ABSENT');
    console.log('G04_PROMOTION_PUBLIC_EMPLOYEE_AUTOCOMPLETE=ABSENT');
    console.log('G04_PROMOTION_PUBLIC_ROLE_SELECTOR=ABSENT');
    console.log('G04_PROMOTION_PUBLIC_EMPLOYEE_ID_FIELD=ABSENT');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  if (!BASE_URL.startsWith('https://')) fail('G04_PROMOTION_CANONICAL_URL_INVALID');
  staticContract();
  await apiSmoke();
  await publicUiSmoke();
}

main().catch((error) => {
  console.error('G04_PROMOTION_SECURITY_SMOKE_FAILED=' + String(error.code || error.message || 'UNKNOWN'));
  process.exitCode = 1;
});
