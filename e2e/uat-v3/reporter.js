'use strict';
const fs = require('node:fs');
const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
const STAGES = Object.freeze(['BROWSER_LOGIN', 'API_AUTHORIZATION', 'NAVIGATION', 'UNKNOWN']);
const TEST_STATUSES = Object.freeze(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']);
const BROWSER_CHECKS = Object.freeze(['BROWSER_PAGE_READY', 'BROWSER_CREDENTIAL_INPUTS',
  'BROWSER_LOGIN_REQUEST', 'BROWSER_LOGIN_IDENTITY', 'BROWSER_AUTH_TRANSITION',
  'BROWSER_READONLY_GUARD']);
function safeFailureCheck(steps) {
  if (!Array.isArray(steps)) return 'UNCLASSIFIED';
  for (const step of steps) {
    if (BROWSER_CHECKS.includes(step?.title) && step.error) return step.title;
    const nested = safeFailureCheck(step?.steps);
    if (nested !== 'UNCLASSIFIED') return nested;
  }
  return 'UNCLASSIFIED';
}

function safePreflight(value) {
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
    failure_check: BROWSER_CHECKS.includes(entry?.failure_check) ? entry.failure_check : 'UNCLASSIFIED'
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
    return [role, { preflight: preflightCode, state, passed, failed: failed.length,
      skipped, failed_phase: failed.length ? failed[0].phase : 'NONE',
      failed_check: failed.length ? failed[0].failure_check : 'NONE' }];
  }));
  return {
    status: meta.status === 'passed' ? 'passed' : 'failed',
    coverage: 'HOSTED_READONLY_AUTHENTICATED',
    source_sha: meta.source_sha,
    harness_sha: meta.harness_sha,
    deployment_id: meta.deployment_id,
    counts, roles, tests
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
    lines.push('UAT_ROLE_' + role + '=' + state);
    lines.push('UAT_FAILED_PHASE_' + role + '=' + phase);
    const check = [...BROWSER_CHECKS, 'NONE'].includes(value.failed_check) ? value.failed_check : 'UNCLASSIFIED';
    lines.push('UAT_FAILED_CHECK_' + role + '=' + check);
  }
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
    this.results.push({ role, phase: safeStage(test.title),
      status: safeStatus(result.status), failure_check: safeFailureCheck(result.steps) });
  }
  onEnd(result) {
    let preflight = {};
    try { preflight = JSON.parse(fs.readFileSync('test-results/uat-v3-safe/preflight.json', 'utf8')); }
    catch { /* Missing diagnostics are NOT_RUN, never PASS. */ }
    const summary = makeSafeSummary(this.results, preflight, {
      status: result.status,
      source_sha: process.env.UAT_SOURCE_SHA,
      harness_sha: process.env.GITHUB_SHA,
      deployment_id: process.env.UAT_EXPECTED_DEPLOYMENT_ID
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
