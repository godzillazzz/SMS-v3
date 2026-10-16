'use strict';
const fs = require('node:fs');
const { API_CHECKS } = require('./api-diagnostics');
const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
const STAGES = Object.freeze(['BROWSER_LOGIN', 'API_AUTHORIZATION', 'NAVIGATION', 'UNKNOWN']);
const TEST_STATUSES = Object.freeze(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']);
const BROWSER_CHECKS = Object.freeze(['BROWSER_PAGE_READY', 'BROWSER_CREDENTIAL_INPUTS',
  'BROWSER_LOGIN_REQUEST', 'BROWSER_LOGIN_IDENTITY', 'BROWSER_AUTH_TRANSITION',
  'BROWSER_READONLY_GUARD']);
const SAFE_CHECKS = Object.freeze([...BROWSER_CHECKS, ...API_CHECKS]);
const ERROR_CATEGORIES = Object.freeze(['NONE', 'TEST_TIMEOUT', 'ROUTE_AFTER_CLOSE', 'UNHANDLED_ERROR', 'OTHER']);
function classifyResultErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return 'OTHER';
  const text = errors.map((error) => typeof error?.message === 'string' ? error.message : '').join(' ');
  if (/timeout|timed out/i.test(text)) return 'TEST_TIMEOUT';
  if (/target page, context or browser has been closed|page closed|context closed/i.test(text)) return 'ROUTE_AFTER_CLOSE';
  if (/unhandled|unhandled rejection/i.test(text)) return 'UNHANDLED_ERROR';
  return 'OTHER';
}
function firstFailedAllowlistedStep(steps) {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (SAFE_CHECKS.includes(step?.title) && step.error) return step;
    const nested = firstFailedAllowlistedStep(step?.steps);
    if (nested) return nested;
  }
  return null;
}
function safeFailureCheck(steps) {
  return firstFailedAllowlistedStep(steps)?.title || 'UNCLASSIFIED';
}
function safeApiFailureReason(steps) {
  const step = firstFailedAllowlistedStep(steps);
  if (!step || !API_CHECKS.includes(step.title)) return 'UNCLASSIFIED';
  // Only interpret exact, harness-owned codes. Raw errors never reach reports or logs.
  const message = typeof step.error?.message === 'string'
    ? step.error.message.split(/\r?\n/, 1)[0].replace(/^Error:\s*/, '').trim() : '';
  if (step.title === 'API_CONTEXT_CREATE' && message === 'UAT_API_CONTEXT_CREATE_FAILED') return 'CONTEXT_CREATE_FAILED';
  if (step.title === 'API_CONTEXT_DISPOSE' && message === 'UAT_API_CONTEXT_DISPOSE_FAILED') return 'CONTEXT_DISPOSE_FAILED';
  if (message === 'UAT_API_REQUEST_FAILED') return 'REQUEST_FAILED';
  if (message === 'UAT_API_STATUS_UNVERIFIED') return 'STATUS_UNVERIFIED';
  const status = /^UAT_API_HTTP_MISMATCH_EXPECTED_([1-5][0-9]{2})_ACTUAL_([1-5][0-9]{2})$/.exec(message);
  return status ? 'HTTP_' + status[2] + '_EXPECTED_' + status[1] : 'UNCLASSIFIED';
}
function safeLastCheck(steps) {
  if (!Array.isArray(steps)) return 'NONE';
  let last = 'NONE';
  for (const step of steps) {
    if (SAFE_CHECKS.includes(step?.title)) last = step.title;
    const nested = safeLastCheck(step?.steps);
    if (nested !== 'NONE') last = nested;
  }
  return last;
}
function browserFailure(steps) {
  const step = firstFailedAllowlistedStep(steps);
  if (!step || step.title !== 'BROWSER_LOGIN_IDENTITY') return { reason: 'UNCLASSIFIED' };
  const message = typeof step.error?.message === 'string'
    ? step.error.message.split(/\r?\n/, 1)[0].replace(/^Error:\s*/, '').trim() : '';
  const identity = /^UAT_LOGIN_(ROLE_MISMATCH|ID_MISMATCH|BODY_UNREADABLE)$/.exec(message);
  if (identity) return { reason: 'LOGIN_' + identity[1] };
  const http = /^UAT_LOGIN_HTTP_([1-5][0-9]{2})(?:_RETRY_AFTER_([0-9]+))?$/.exec(message);
  if (http) return { reason: 'LOGIN_HTTP_' + http[1], retry_after: Number(http[2]) };
  return { reason: 'UNCLASSIFIED' };
}
function safeFailureReason(value) {
  if (['NONE', 'UNCLASSIFIED', 'REQUEST_FAILED', 'STATUS_UNVERIFIED',
    'CONTEXT_CREATE_FAILED', 'CONTEXT_DISPOSE_FAILED', 'OUTSIDE_CHECK',
    'LOGIN_ROLE_MISMATCH', 'LOGIN_ID_MISMATCH', 'LOGIN_BODY_UNREADABLE'].includes(value)) return value;
  return typeof value === 'string' && (/^LOGIN_HTTP_[1-5][0-9]{2}$/.test(value)
    || /^HTTP_[1-5][0-9]{2}_EXPECTED_[1-5][0-9]{2}$/.test(value))
    ? value : 'UNCLASSIFIED';
}

function safePreflight(value) {
  if (value && typeof value === 'object') return safePreflight(value.code);
  if (typeof value !== 'string') return 'NOT_RUN';
  if (['NOT_RUN', 'READY', 'REQUEST_ERROR', 'ACCOUNT_NOT_READY', 'ROLE_SESSION_INVALID'].includes(value)) return value;
  if (/^HTTP_[1-5][0-9]{2}$/.test(value)) return value;
  return 'REQUEST_ERROR';
}
function safeStage(title) {
  if (typeof title !== 'string') return 'UNKNOWN';
  if (/^(ADMIN|MANAGER|SUPERVISOR|VIEWER): real browser login and exact identity$/.test(title)) return 'BROWSER_LOGIN';
  if (/^(ADMIN|MANAGER|SUPERVISOR|VIEWER): API authorization and expected denial$/.test(title)) return 'API_AUTHORIZATION';
  if (/^(ADMIN|MANAGER|SUPERVISOR|VIEWER): (desktop|mobile) (light|dark) navigation and approval visibility$/.test(title)) return 'NAVIGATION';
  return 'UNKNOWN';
}
function safeStatus(status) {
  return TEST_STATUSES.includes(status) ? status : 'failed';
}
function makeSafeSummary(results, preflight = {}, meta = {}) {
  const tests = (Array.isArray(results) ? results : []).map((entry) => ({
    role: ROLES.includes(entry?.role) ? entry.role : 'UNKNOWN',
    phase: STAGES.includes(entry?.phase) ? entry.phase : 'UNKNOWN',
    status: safeStatus(entry?.status),
    failure_check: SAFE_CHECKS.includes(entry?.failure_check) ? entry.failure_check : 'UNCLASSIFIED',
    failure_reason: safeFailureReason(entry?.failure_reason),
    retry_after: Number.isSafeInteger(entry?.retry_after) && entry.retry_after >= 0 ? entry.retry_after : undefined,
    last_check: [...SAFE_CHECKS, 'NONE'].includes(entry?.last_check) ? entry.last_check : 'NONE',
    error_category: ERROR_CATEGORIES.includes(entry?.error_category) ? entry.error_category : 'OTHER'
  }));
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const entry of tests) {
    if (entry.status === 'passed') counts.passed++;
    else if (entry.status === 'skipped') counts.skipped++;
    else counts.failed++;
  }
  const roles = Object.fromEntries(ROLES.map((role) => {
    const own = tests.filter((t) => t.role === role);
    const passed = own.filter((t) => t.status === 'passed').length;
    const failed = own.filter((t) => t.status !== 'passed' && t.status !== 'skipped');
    const skipped = own.filter((t) => t.status === 'skipped').length;
    const preflightCode = safePreflight(preflight?.[role]);
    const state = preflightCode !== 'READY' ? 'BLOCKED_PREFLIGHT'
      : failed.length ? 'FAILED_TEST'
      : passed === 6 && skipped === 0 ? 'PASS'
      : 'INCOMPLETE';
    const details = preflight?.[role] && typeof preflight[role] === 'object' ? preflight[role] : {};
    return [role, { preflight: preflightCode, login: preflightCode === 'READY',
      role_match: details.roleMatch === true, active: details.active === true,
      distinct: details.distinct === true, employee_linked: details.employeeLinked === 'UNVERIFIED' ? 'UNVERIFIED' : false,
      error_category: own.length ? own.find((entry) => entry.status !== 'passed')?.error_category || 'NONE' : 'NONE',
      state, passed, failed: failed.length,
      skipped, failed_phase: failed.length ? failed[0].phase : 'NONE',
      failed_check: failed.length ? failed[0].failure_check : 'NONE',
      failed_reason: failed.length ? failed[0].failure_reason : 'NONE',
      retry_after: failed.length ? failed[0].retry_after : undefined,
      last_check: failed.length ? failed[0].last_check : 'NONE' }];
  }));
  return {
    status: meta.status === 'passed' ? 'passed' : 'failed',
    coverage: 'HOSTED_READONLY_AUTHENTICATED',
    source_sha: meta.source_sha,
    harness_sha: meta.harness_sha,
    deployment_id: meta.deployment_id,
    counts, roles, tests,
    login_attempts_total: Number.isSafeInteger(meta.login_attempts_total) && meta.login_attempts_total >= 0 ? meta.login_attempts_total : 0
  };
}
function diagnosticLines(summary) {
  // Never interpolate exception messages, test titles, API payloads, or credential values.
  if (!summary || typeof summary !== 'object') return ['UAT_DIAGNOSTIC_REPORT=INVALID'];
  const lines = [];
  for (const role of ROLES) {
    const value = summary.roles?.[role] || {};
    const state = ['BLOCKED_PREFLIGHT', 'FAILED_TEST', 'PASS', 'INCOMPLETE'].includes(value.state)
      ? value.state : 'INCOMPLETE';
    const phase = [...STAGES, 'NONE'].includes(value.failed_phase) ? value.failed_phase : 'UNKNOWN';
    lines.push('UAT_PREFLIGHT_' + role + '=' + safePreflight(value.preflight));
    lines.push('UAT_PREFLIGHT_' + role + '_LOGIN=' + (value.login === true ? 'true' : 'false'));
    lines.push('UAT_PREFLIGHT_' + role + '_ROLE_MATCH=' + (value.role_match === true ? 'true' : 'false'));
    lines.push('UAT_PREFLIGHT_' + role + '_ACTIVE=' + (value.active === true ? 'true' : 'false'));
    lines.push('UAT_PREFLIGHT_' + role + '_DISTINCT=' + (value.distinct === true ? 'true' : 'false'));
    lines.push('UAT_PREFLIGHT_' + role + '_EMPLOYEE_LINKED=' + (value.employee_linked === 'UNVERIFIED' ? 'UNVERIFIED' : 'false'));
    lines.push('UAT_ERROR_CATEGORY_' + role + '=' + (ERROR_CATEGORIES.includes(value.error_category) ? value.error_category : 'OTHER'));
    lines.push('UAT_ROLE_' + role + '=' + state);
    lines.push('UAT_FAILED_PHASE_' + role + '=' + phase);
    const check = [...SAFE_CHECKS, 'NONE'].includes(value.failed_check) ? value.failed_check : 'UNCLASSIFIED';
    lines.push('UAT_FAILED_CHECK_' + role + '=' + check);
    lines.push('UAT_FAILED_REASON_' + role + '=' + safeFailureReason(value.failed_reason));
    if (Number.isSafeInteger(value.retry_after) && value.retry_after >= 0) lines.push('UAT_LOGIN_RETRY_AFTER_' + role + '=' + value.retry_after);
    const lastCheck = [...SAFE_CHECKS, 'NONE'].includes(value.last_check) ? value.last_check : 'NONE';
    lines.push('UAT_LAST_CHECK_' + role + '=' + lastCheck);
  }
  lines.push('UAT_LOGIN_ATTEMPTS_TOTAL=' + (Number.isSafeInteger(summary.login_attempts_total) && summary.login_attempts_total >= 0 ? summary.login_attempts_total : 'UNVERIFIED'));
  for (const field of ['passed', 'failed', 'skipped']) {
    const count = summary.counts?.[field];
    lines.push('UAT_COUNT_' + field.toUpperCase() + '='
      + (Number.isSafeInteger(count) && count >= 0 && count <= 24 ? count : 'UNVERIFIED'));
  }
  return lines;
}
class SafeReporter {
  constructor() { this.results = []; }
  onTestEnd(test, result) {
    const role = /^(ADMIN|MANAGER|SUPERVISOR|VIEWER):/.exec(test.title)?.[1] || 'UNKNOWN';
    const phase = safeStage(test.title);
    const status = safeStatus(result.status);
    const stepCheck = safeFailureCheck(result.steps);
    const outsideApiCheck = phase === 'API_AUTHORIZATION' && status !== 'passed'
      && stepCheck === 'UNCLASSIFIED';
    const browser = phase === 'BROWSER_LOGIN' ? browserFailure(result.steps) : { reason: 'UNCLASSIFIED' };
    const loginAttempted = phase === 'BROWSER_LOGIN' && Array.isArray(result.steps) && result.steps.some((step) => step.title === 'BROWSER_LOGIN_REQUEST');
    this.results.push({ role, phase, status, error_category: classifyResultErrors(result.errors),
      failure_check: outsideApiCheck ? 'API_OUTSIDE_CHECK' : stepCheck,
      failure_reason: outsideApiCheck ? 'OUTSIDE_CHECK' : phase === 'BROWSER_LOGIN' ? browser.reason : safeApiFailureReason(result.steps),
      retry_after: browser.retry_after,
      login_attempted: loginAttempted,
      last_check: safeLastCheck(result.steps)
    });
  }
  onEnd(result) {
    let preflight = {};
    try { preflight = JSON.parse(fs.readFileSync('test-results/uat-v3-safe/preflight.json', 'utf8')); }
    catch { /* Missing diagnostics are NOT_RUN, never PASS. */ }
    const preflightAttempts = Number.isSafeInteger(preflight.__login_attempts_total) ? preflight.__login_attempts_total : 0;
    const browserAttempts = this.results.filter((entry) => entry.login_attempted).length;
    const summary = makeSafeSummary(this.results, preflight, {
      status: result.status,
      source_sha: process.env.UAT_SOURCE_SHA,
      harness_sha: process.env.GITHUB_SHA,
      deployment_id: process.env.UAT_EXPECTED_DEPLOYMENT_ID,
      login_attempts_total: preflightAttempts + browserAttempts
    });
    fs.mkdirSync('test-results/uat-v3-safe', { recursive: true });
    fs.writeFileSync('test-results/uat-v3-safe/results.json', JSON.stringify(summary));
  }
}
module.exports = SafeReporter;
module.exports.makeSafeSummary = makeSafeSummary;
module.exports.diagnosticLines = diagnosticLines;
module.exports.safePreflight = safePreflight;
module.exports.safeStage = safeStage;
module.exports.safeFailureCheck = safeFailureCheck;
module.exports.safeApiFailureReason = safeApiFailureReason;
module.exports.safeFailureReason = safeFailureReason;
module.exports.browserFailure = browserFailure;
module.exports.safeLastCheck = safeLastCheck;
module.exports.ERROR_CATEGORIES = ERROR_CATEGORIES;
module.exports.classifyResultErrors = classifyResultErrors;
