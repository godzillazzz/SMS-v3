const { getNavigationItem, getRoleApiMatrix, getRoleNavigationContract, roles } = require('./uat-v3-role-matrix');

const previousFailureContracts = Object.freeze([
  { id: 'schedule-legacy-label', class: 'STALE_SELECTOR', expected: 'schedule' },
  { id: 'duplicate-primary-navigation', class: 'NAVIGATION_AMBIGUITY', expected: 'primary-nav-only' },
  { id: 'unified-report-center-navigation', class: 'STALE_SELECTOR', expected: 'reportCenter' },
  { id: 'dashboard-response-race', class: 'DASHBOARD_SYNC', expected: 'payload-before-warning-assertion' },
  { id: 'role-api-old-path', class: 'WRONG_ROUTE', expected: 'role-matrix-source' },
  { id: 'viewer-schedule-contract', class: 'WRONG_RBAC_EXPECTATION', expected: 200 },
  { id: 'wrong-target-timeout', class: 'REQUEST_SYNCHRONIZATION', expected: 'bounded-wait' },
  { id: 'responsive-repeated-login', class: 'LOGIN_REPETITION', expected: 'one-session-per-role' },
  { id: 'opaque-artifact-diagnostic', class: 'ARTIFACT_FALSE_POSITIVE', expected: 'path-and-category' },
  { id: 'redacted-placeholder', class: 'ARTIFACT_FALSE_POSITIVE', expected: 'allowed' }
]);

function dashboardWarningState(summary, error) {
  if (error) return 'ERROR';
  const partialErrors = Array.isArray(summary?.partialErrors) ? summary.partialErrors : [];
  return partialErrors.length > 0 ? 'PARTIAL_WARNING' : 'HEALTHY_COMPLETE';
}

function navigationContract(role) {
  const contract = getRoleNavigationContract(role);
  return {
    required: contract.required.map(({ id, label }) => ({ id, label })),
    forbidden: contract.forbidden.map(({ id, label }) => ({ id, label }))
  };
}

function roleApiContract(role, month = '2026-08') {
  return getRoleApiMatrix(role, month).map(({ label, path, expectedStatus, source, guard }) => ({
    label,
    path,
    expectedStatus,
    source,
    guard,
    readOnly: true
  }));
}

function buildSafeUatSummary({
  mode,
  sourceSha,
  target,
  roles: roleResults = {},
  errors = {},
  artifactLeakCount = 0,
  tests = {}
} = {}) {
  return {
    mode: String(mode || 'technical').toUpperCase(),
    sourceSha: String(sourceSha || 'not supplied'),
    target: String(target || 'not configured'),
    roles: Object.fromEntries(roles.map((role) => [role, {
      loginReady: roleResults[role]?.loginReady || 'NOT RUN',
      api: roleResults[role]?.api || 'NOT RUN',
      navigation: roleResults[role]?.navigation || 'NOT RUN',
      responsive: roleResults[role]?.responsive || 'NOT RUN'
    }])),
    errors: {
      page: Number(errors.page || 0),
      console: Number(errors.console || 0),
      network: Number(errors.network || 0)
    },
    artifactLeakCount: Number(artifactLeakCount),
    tests: {
      passed: Number(tests.passed || 0),
      skipped: Number(tests.skipped || 0),
      failed: Number(tests.failed || 0)
    }
  };
}

function navigationTarget(id) {
  return getNavigationItem(id);
}

module.exports = {
  buildSafeUatSummary,
  dashboardWarningState,
  navigationContract,
  navigationTarget,
  previousFailureContracts,
  roleApiContract
};
