'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { readRoleSession } = require('../../e2e/helpers/uat-session');

const APP_ROOT = process.env.UAT_APPLICATION_ROOT || path.resolve('application-under-test');
const BASE_URL = String(process.env.UAT_BASE_URL || '');
const BYPASS = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '');
const ROLES = ['ADMIN', 'MANAGER', 'VIEWER'];

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const source = (relativePath) => fs.readFileSync(path.join(APP_ROOT, relativePath), 'utf8');

function assertStaticContract() {
  const auth = source('src/routes/auth.routes.js');
  const review = source('src/routes/registration-requests.routes.js');
  const service = source('src/services/registration-request.service.js');
  const panel = source('frontend/src/pages/access-management/RegistrationReviewPanel.tsx');
  const accessPage = source('frontend/src/pages/access-management/AccessManagementPage.tsx');

  const publicSchema = (auth.match(/const registrationRequestSchema\s*=\s*([^;]+);/) || [])[1] || '';
  if (!publicSchema.includes('.strict()')) fail('G04_PUBLIC_SCHEMA_NOT_STRICT');
  for (const field of ['employeeId', 'matchedEmployeeId', 'role', 'status', 'approved', 'reviewedBy']) {
    if (new RegExp(`\\b${field}\\b`).test(publicSchema)) fail(`G04_PUBLIC_AUTHORITY_FIELD_${field}`);
  }
  if (auth.includes('available-employees')) fail('G04_OLD_ANONYMOUS_DIRECTORY_ROUTE_SOURCE_PRESENT');
  if (!review.includes('router.use(authenticate)') || !review.includes("router.use(authorize('ADMIN', 'MANAGER'))")) fail('G04_PRIVATE_REVIEW_GUARD_MISSING');
  if (!review.includes('pageSize: z.coerce.number().int().min(1).max(20).default(20)')) fail('G04_CANDIDATE_BOUND_MISSING');
  if (!review.includes('const approveSchema = z.object({}).strict()')) fail('G04_APPROVAL_SCHEMA_NOT_STRICT_EMPTY');
  if (!/role\s*:\s*'VIEWER'/.test(service)) fail('G04_APPROVAL_VIEWER_HARDCODE_MISSING');

  const searchStart = service.indexOf('async function searchCandidates');
  const matchStart = service.indexOf('async function match');
  if (searchStart < 0 || matchStart <= searchStart) fail('G04_SEARCH_FUNCTION_BOUNDARY_MISSING');
  const searchBlock = service.slice(searchStart, matchStart);
  for (const required of [
    "deletedAt: null",
    "isActive: true",
    "user: { is: null }",
    'prismaClient.employee.count',
    'prismaClient.employee.findMany',
    "'EMPLOYEE_NOT_FOUND'"
  ]) if (!searchBlock.includes(required)) fail('G04_EMPLOYEE_CANDIDATE_SOURCE_CONTRACT_MISSING');
  if (/registrationRequest\.(?:create|update|updateMany|delete|deleteMany|upsert)|employee\.(?:create|update|updateMany|delete|deleteMany|upsert)/.test(searchBlock)) fail('G04_CANDIDATE_SEARCH_MUTATION_PRESENT');
  if (/\b(?:prismaClient|tx)\.employee\.(?:create|update|updateMany|delete|deleteMany|upsert)\b/.test(service)) fail('G04_EMPLOYEE_MASTER_MUTATION_PATH_PRESENT');
  if (/<select\b/i.test(panel)) fail('G04_REGISTRATION_PANEL_ROLE_SELECTOR_PRESENT');
  if (!panel.includes('ไม่มี role picker') || !panel.includes('อนุมัติเป็น VIEWER')) fail('G04_REGISTRATION_PANEL_VIEWER_ONLY_COPY_MISSING');
  if (!accessPage.includes('แก้ไขบัญชีและสิทธิ์') || !accessPage.includes("['ADMIN', 'MANAGER', 'VIEWER']")) fail('G04_SEPARATE_ROLE_MANAGEMENT_FLOW_MISSING');

  console.log('G04_STATIC_APPROVAL_ROLE=VIEWER_ONLY');
  console.log('G04_STATIC_PRIVILEGE_ELEVATION_THROUGH_G04=NO');
  console.log('G04_STATIC_EMPLOYEE_SOURCE=EMPLOYEE_MASTER_ONLY');
  console.log('G04_STATIC_AUTO_MATCH=NO');
  console.log('G04_STATIC_REGISTRATION_CREATES_EMPLOYEE=NO');
  console.log('G04_STATIC_REGISTRATION_MODIFIES_EMPLOYEE=NO');
  console.log('G04_STATIC_NO_MATCH=PENDING_EMPLOYEE_NOT_FOUND');
  console.log('G04_STATIC_ROLE_MANAGEMENT=SEPARATE_FLOW');
  console.log('G04_STATIC_APPLICANT_ROLE_AUTHORITY=0');
  console.log('G04_STATIC_APPLICANT_EMPLOYEE_ID_AUTHORITY=0');
}

function session(role) {
  if (!ROLES.includes(role)) fail('G04_AUTH_ROLE_INVALID');
  const value = readRoleSession(role);
  if (!value?.accessToken || value.user?.role !== role) fail(`G04_AUTH_${role}_SESSION_MISSING`);
  return value;
}

function bypassHeaders() {
  if (!BYPASS) fail('G04_AUTH_BYPASS_SECRET_MISSING');
  return {
    'x-vercel-protection-bypass': BYPASS
  };
}

async function api(pathname, { role, method = 'GET', data } = {}) {
  const headers = { Accept: 'application/json', ...bypassHeaders() };
  if (role) headers.Authorization = `Bearer ${session(role).accessToken}`;
  const body = data === undefined ? null : Buffer.from(JSON.stringify(data), 'utf8');
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(body.length);
  }
  const url = new URL(pathname, BASE_URL);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, timeout: 30_000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: Number(response.statusCode || 0),
          json: async () => raw ? JSON.parse(raw) : null
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('G04_API_TIMEOUT')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function assertStatus(label, response, expected) {
  if (response.status !== expected) fail(`${label}_HTTP_${response.status}_EXPECTED_${expected}`);
}

async function apiRbacChecks() {
  for (const role of ['ADMIN', 'MANAGER']) {
    const list = await api('/api/v1/registration-requests?page=1&pageSize=50', { role });
    await assertStatus(`G04_${role}_REVIEW_LIST`, list, 200);
    const payload = await list.json().catch(() => null);
    if (!Array.isArray(payload?.data) || payload.data.length !== 0 || Number(payload?.meta?.total || 0) !== 0) fail(`G04_${role}_REVIEW_LIST_NOT_EMPTY`);
    console.log(`G04_${role}_REVIEW_API=200_EMPTY`);
  }

  const requestId = crypto.randomUUID();
  const search = `G04-UAT-NO-MATCH-${crypto.randomBytes(8).toString('hex')}`;
  const candidatePath = `/api/v1/registration-requests/${requestId}/candidates?search=${encodeURIComponent(search)}&page=1&pageSize=20`;
  for (const role of ['ADMIN', 'MANAGER']) {
    const response = await api(candidatePath, { role });
    await assertStatus(`G04_${role}_CANDIDATE_AUTHZ`, response, 404);
    console.log(`G04_${role}_CANDIDATE_SEARCH_AUTHORIZATION=ALLOWED_RESOURCE_404`);
  }

  const viewerChecks = [
    ['REVIEW', '/api/v1/registration-requests?page=1&pageSize=50', 'GET'],
    ['CANDIDATES', candidatePath, 'GET'],
    ['MATCH', `/api/v1/registration-requests/${requestId}/match`, 'POST', { employeeId: crypto.randomUUID() }],
    ['APPROVE', `/api/v1/registration-requests/${requestId}/approve`, 'POST', {}],
    ['REJECT', `/api/v1/registration-requests/${requestId}/reject`, 'POST', { reason: 'g04-uat-denied' }]
  ];
  for (const [label, pathname, method, data] of viewerChecks) {
    const response = await api(pathname, { role: 'VIEWER', method, data });
    await assertStatus(`G04_VIEWER_${label}`, response, 403);
  }
  console.log('G04_VIEWER_REVIEW_API=403');
  console.log('G04_VIEWER_CANDIDATE_SEARCH=403');
  console.log('G04_VIEWER_MUTATION_ENDPOINTS=403');

  for (const [label, pathname, method, data] of viewerChecks) {
    const response = await api(pathname, { method, data });
    await assertStatus(`G04_ANONYMOUS_${label}`, response, 401);
  }
  console.log('G04_ANONYMOUS_REVIEW_API=401');
  console.log('G04_ANONYMOUS_CANDIDATE_SEARCH=401');
  console.log('G04_ANONYMOUS_MUTATION_ENDPOINTS=401');

  const oldDirectory = await api('/api/v1/auth/register/available-employees');
  if (![401, 403, 404].includes(oldDirectory.status)) fail(`G04_ANONYMOUS_DIRECTORY_HTTP_${oldDirectory.status}`);
  console.log(`G04_ANONYMOUS_OLD_DIRECTORY=${oldDirectory.status}_NON_ENUMERATING`);
}

async function newRoleContext(browser, role) {
  const cached = session(role);
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: bypassHeaders()
  });
  const page = await context.newPage();
  await page.route('**/api/v1/auth/refresh**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: cached.accessToken, tokenType: 'Bearer', user: cached.user })
    });
  });
  await page.route('**/api/v1/dashboard**', async (route) => {
    if (route.request().method() === 'GET') return route.abort('aborted');
    return route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('nav.nav-menu').first().waitFor({ state: 'visible', timeout: 15_000 });
  return { context, page };
}

async function uiRoleCheck(browser, role) {
  const { context, page } = await newRoleContext(browser, role);
  const employeeRequests = [];
  const candidateRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/employees') employeeRequests.push(pathname);
    if (/^\/api\/v1\/registration-requests\/[^/]+\/candidates$/.test(pathname)) candidateRequests.push(pathname);
  });
  try {
    if (['ADMIN', 'MANAGER'].includes(role)) {
      await page.route('**/api/v1/users**', async (route) => {
        if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      });
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/v1/registration-requests' && response.request().method() === 'GET';
      }, { timeout: 15_000 });
      const nav = page.locator('nav.nav-menu').first().getByRole('button', { name: /ผู้ใช้และสิทธิ์/ }).first();
      await nav.click();
      const response = await responsePromise;
      if (response.status() !== 200) fail(`G04_${role}_UI_REVIEW_API_${response.status()}`);
      const panel = page.locator('section.registration-review');
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      await panel.getByRole('heading', { name: 'คำขอลงทะเบียนแบบส่วนตัว', exact: true }).waitFor({ state: 'visible' });
      await panel.getByText('ยังไม่มีคำขอที่ยืนยันอีเมลแล้ว', { exact: true }).waitFor({ state: 'visible' });
      if (await panel.locator('select').count() !== 0) fail(`G04_${role}_UI_ROLE_SELECTOR_PRESENT`);
      if (await panel.locator('[name="role"],[name="employeeId"],[name="matchedEmployeeId"]').count() !== 0) fail(`G04_${role}_UI_AUTHORITY_INPUT_PRESENT`);
      if (!(await panel.textContent())?.includes('ผู้สมัครไม่สามารถเลือก Employee หรือกำหนด Role เองได้')) fail(`G04_${role}_UI_PRIVACY_COPY_MISSING`);
      if (employeeRequests.length !== 0) fail(`G04_${role}_UI_EMPLOYEE_ROSTER_AUTOLOAD`);
      if (candidateRequests.length !== 0) fail(`G04_${role}_UI_CANDIDATE_AUTOLOAD`);
      console.log(`G04_${role}_REVIEW_UI=VISIBLE_EMPTY`);
      console.log(`G04_${role}_UI_EMPLOYEE_ROSTER_AUTOLOAD=0`);
      console.log(`G04_${role}_UI_ROLE_SELECTOR=ABSENT`);
      return;
    }

    const navCount = await page.locator('nav.nav-menu').first().getByRole('button', { name: /ผู้ใช้และสิทธิ์/ }).count();
    if (navCount !== 0) fail('G04_VIEWER_REVIEW_NAV_VISIBLE');
    if (await page.locator('section.registration-review').count() !== 0) fail('G04_VIEWER_REVIEW_PANEL_VISIBLE');
    console.log('G04_VIEWER_REVIEW_UI=ABSENT');
  } finally {
    await context.close();
  }
}

async function publicUiCheck(browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: bypassHeaders()
  });
  const page = await context.newPage();
  try {
    await page.route('**/api/v1/auth/refresh**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Authentication required.' }) }));
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('button', { name: /ส่งคำขอลงทะเบียน/ }).click();
    await page.getByRole('heading', { name: 'ส่งคำขอลงทะเบียน', exact: true }).waitFor({ state: 'visible' });
    const form = page.locator('form.login-form');
    if (await form.locator('select').count() !== 0) fail('G04_PUBLIC_UI_SELECTOR_PRESENT');
    if (await form.locator('datalist,[role="listbox"],[aria-autocomplete]').count() !== 0) fail('G04_PUBLIC_UI_AUTOCOMPLETE_PRESENT');
    if (await form.locator('[name="employeeId"],[name="matchedEmployeeId"],[name="role"]').count() !== 0) fail('G04_PUBLIC_UI_AUTHORITY_INPUT_PRESENT');
    for (const selector of ['#registration-name', '#registration-department', '#email', '#password']) {
      if (await page.locator(selector).count() !== 1) fail(`G04_PUBLIC_UI_FIELD_MISSING_${selector}`);
    }
    console.log('G04_PUBLIC_REGISTRATION_UI=PASS');
    console.log('G04_PUBLIC_EMPLOYEE_SELECTOR=ABSENT');
    console.log('G04_PUBLIC_EMPLOYEE_AUTOCOMPLETE=ABSENT');
    console.log('G04_PUBLIC_ROLE_SELECTOR=ABSENT');
    console.log('G04_PUBLIC_EMPLOYEE_ID_FIELD=ABSENT');
  } finally {
    await context.close();
  }
}

async function main() {
  if (!BASE_URL.startsWith('https://')) fail('G04_AUTH_BASE_URL_INVALID');
  assertStaticContract();
  await apiRbacChecks();
  const browser = await chromium.launch({ headless: true });
  try {
    await uiRoleCheck(browser, 'ADMIN');
    await uiRoleCheck(browser, 'MANAGER');
    await uiRoleCheck(browser, 'VIEWER');
    await publicUiCheck(browser);
  } finally {
    await browser.close();
  }
  console.log('G04_FOCUSED_AUTH_ADMIN=PASS');
  console.log('G04_FOCUSED_AUTH_MANAGER=PASS');
  console.log('G04_FOCUSED_AUTH_VIEWER=PASS');
  console.log('G04_FOCUSED_AUTH_ANONYMOUS=PASS');
}

main().catch((error) => {
  console.error('G04_FOCUSED_AUTH_RUNNER_FAILED=' + String(error.code || error.message || 'UNKNOWN'));
  process.exitCode = 1;
});
