const fs = require('node:fs');
const path = require('node:path');
const { sanitizeUatDiagnostic } = require('./helpers/uat-v3-security');
const { mergePerformanceValidation, sanitizePerformanceValidation } = require('./helpers/uat-performance');

function roleFromTitle(title) {
  const match = String(title).match(/\b(ADMIN|MANAGER|VIEWER)\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function safeErrorCode(result) {
  if (!result.errors?.length) return undefined;
  const message = sanitizeUatDiagnostic(result.errors.map((error) => error.message || '').join(' ')).toLowerCase();
  const uatCode = message.toUpperCase().match(/\bUAT_[A-Z0-9_]+\b/)?.[0];
  if (uatCode) return uatCode.slice(0, 120);
  if (/timeout|timed out/.test(message)) return 'TIMEOUT';
  if (/401|403|authorization|forbidden|unauthorized/.test(message)) return 'AUTHORIZATION';
  if (/network|econn|connection|failed to load/.test(message)) return 'NETWORK';
  if (/expect|received|expected/.test(message)) return 'ASSERTION';
  return 'TEST_FAILURE';
}

function safeReportValue(value, fallback = 'NOT RUN') {
  return sanitizeUatDiagnostic(value ?? fallback).slice(0, 200);
}

function safeStageAttachment(value) {
  if (!value || typeof value !== 'object') return undefined;
  const safe = {};
  for (const key of ['role', 'testCode', 'lastCompletedStage', 'currentStage', 'state', 'safeApiPath', 'safeStatus', 'durationBucket', 'safeErrorCode']) {
    if (value[key] === undefined || value[key] === null) continue;
    if (key === 'safeStatus') {
      const status = Number(value[key]);
      if (Number.isInteger(status) && status >= 100 && status <= 599) safe[key] = status;
      continue;
    }
    safe[key] = safeReportValue(value[key], '');
  }
  return safe;
}

function safeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeHeavyReadSafetyAttachment(value) {
  if (!value || typeof value !== 'object') return undefined;
  const outstandingHeavyReads = [];
  for (const entry of Array.isArray(value.outstandingHeavyReads) ? value.outstandingHeavyReads.slice(0, 20) : []) {
    const method = entry?.method === 'GET' ? 'GET' : undefined;
    const path = ['/api/v1/dashboard', '/api/v1/executive-report', '/api/v1/reports/summary'].includes(entry?.path) ? entry.path : undefined;
    const ageMs = safeNonNegativeInteger(entry?.ageMs);
    const state = ['LIVE', 'CLIENT_FAILED'].includes(entry?.state) ? entry.state : undefined;
    if (method && path && state) outstandingHeavyReads.push({ method, path, ageMs, state });
  }
  return {
    testsFinishingWithOutstandingHeavyReads: safeNonNegativeInteger(value.testsFinishingWithOutstandingHeavyReads),
    exceptionalHeavyDrainCount: safeNonNegativeInteger(value.exceptionalHeavyDrainCount),
    exceptionalHeavyDrainWaitMs: safeNonNegativeInteger(value.exceptionalHeavyDrainWaitMs),
    realHeavyStarts: safeNonNegativeInteger(value.realHeavyStarts),
    preventedHeavyStarts: safeNonNegativeInteger(value.preventedHeavyStarts),
    outstandingHeavyReads
  };
}

function safeAuthContractAttachment(value) {
  if (!value || typeof value !== 'object') return undefined;
  const safe = {};
  for (const key of ['loginStatus', 'dashboardStatus']) {
    const status = Number(value[key]);
    if (Number.isInteger(status) && status >= 100 && status <= 599) safe[key] = status;
  }
  for (const key of ['roleMatched', 'accessTokenPresent', 'cachedSessionPresent', 'cachedRefreshUsed', 'dashboardRequestTerminal', 'authenticatedShellVisible']) {
    if (typeof value[key] === 'boolean') safe[key] = value[key];
  }
  if (['REAL_BROWSER_LOGIN', 'CACHED_PREFLIGHT_SESSION'].includes(value.identityMode)) safe.identityMode = value.identityMode;
  if (['CANONICAL', 'IMMUTABLE'].includes(value.targetClass)) safe.targetClass = value.targetClass;
  if (value.dashboardSuppressorActiveAtHelperReturn !== undefined) safe.dashboardSuppressorActiveAtHelperReturn = safeNonNegativeInteger(value.dashboardSuppressorActiveAtHelperReturn);
  return Object.keys(safe).length ? safe : undefined;
}

function safePageMonitorAttachment(value) {
  if (!value || typeof value !== 'object') return undefined;
  const safe = {
    pageErrorCount: safeNonNegativeInteger(value.pageErrorCount),
    consoleErrorCount: safeNonNegativeInteger(value.consoleErrorCount),
    requestFailureCount: safeNonNegativeInteger(value.requestFailureCount),
    secondaryApiFailures: []
  };
  const entries = Array.isArray(value.secondaryApiFailures) ? value.secondaryApiFailures.slice(0, 20) : [];
  for (const entry of entries) {
    const entryPath = typeof entry?.path === 'string' && /^\/api\/v1\/[A-Za-z0-9._~!$&'()+,;=:@%\/-]+$/.test(entry.path) ? entry.path : undefined;
    const method = String(entry?.method || '').toUpperCase();
    const status = Number(entry?.status);
    if (!entryPath || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) continue;
    if (!Number.isInteger(status) || status < 400 || status > 599) continue;
    safe.secondaryApiFailures.push({
      path: entryPath,
      method,
      status,
      classification: entry.classification === 'UNEXPECTED_API_RESPONSE' ? 'UNEXPECTED_API_RESPONSE' : 'UNKNOWN'
    });
  }
  return safe;
}

class UatSummaryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'test-results/uat-summary.md';
    this.jsonOutputFile = options.jsonOutputFile || 'test-results/uat-results.json';
    this.mode = options.mode || String(process.env.UAT_MODE || 'technical').toLowerCase();
    this.results = [];
    this.technicalSummary = undefined;
    this.regressionSummary = {};
    this.heavyReadSafety = {
      testsFinishingWithOutstandingHeavyReads: 0,
      exceptionalHeavyDrainCount: 0,
      exceptionalHeavyDrainWaitMs: 0,
      realHeavyStarts: 0,
      preventedHeavyStarts: 0,
      outstandingHeavyReads: []
    };
  }

  onTestEnd(test, result) {
    const title = test.titlePath().slice(1).join(' › ');
    let stage;
    let authContract;
    let pageMonitor;
    for (const attachment of result.attachments || []) {
      if (!attachment.body) continue;
      try {
        const parsed = JSON.parse(attachment.body.toString('utf8'));
        if (attachment.name === 'uat-stage.json') stage = safeStageAttachment(parsed);
        if (attachment.name === 'v31-auth-contract.json') authContract = safeAuthContractAttachment(parsed);
        if (attachment.name === 'v32-page-monitor.json') pageMonitor = safePageMonitorAttachment(parsed);
      } catch {
        if (attachment.name === 'uat-stage.json') stage = undefined;
        if (attachment.name === 'v31-auth-contract.json') authContract = undefined;
        if (attachment.name === 'v32-page-monitor.json') pageMonitor = undefined;
      }
    }
    this.results.push({
      testName: sanitizeUatDiagnostic(title),
      role: roleFromTitle(title),
      status: result.status,
      duration: Number.isFinite(result.duration) ? result.duration : 0,
      safeErrorCode: safeErrorCode(result),
      ...(stage ? { stage } : {}),
      ...(authContract ? { authContract } : {}),
      ...(pageMonitor ? { pageMonitor } : {})
    });
    for (const attachment of result.attachments || []) {
      if (!attachment.body) continue;
      let parsed;
      try {
        parsed = JSON.parse(attachment.body.toString('utf8'));
      } catch {
        continue;
      }
      if (attachment.name === 'technical-summary.json') this.technicalSummary = parsed;
      if (attachment.name === 'v2-data-quality-summary.json') this.regressionSummary.dataQuality = parsed;
      if (attachment.name === 'v2-audit-summary.json') this.regressionSummary.audit = parsed;
      if (attachment.name === 'v2-dashboard-summary.json') this.regressionSummary.dashboard = parsed;
      if (attachment.name === 'performance-validation.json') this.performanceValidation = mergePerformanceValidation(this.performanceValidation, parsed);
      if (attachment.name === 'heavy-read-safety.json') {
        const metric = safeHeavyReadSafetyAttachment(parsed);
        if (metric) {
          for (const key of ['testsFinishingWithOutstandingHeavyReads', 'exceptionalHeavyDrainCount', 'exceptionalHeavyDrainWaitMs', 'realHeavyStarts', 'preventedHeavyStarts']) {
            this.heavyReadSafety[key] += metric[key];
          }
          this.heavyReadSafety.outstandingHeavyReads.push(...metric.outstandingHeavyReads);
        }
      }
    }
  }

  onEnd(result) {
    const passed = this.results.filter((entry) => entry.status === 'passed').length;
    const skipped = this.results.filter((entry) => entry.status === 'skipped').length;
    const failed = this.results.filter((entry) => !['passed', 'skipped'].includes(entry.status)).length;
    const roleStatus = (role) => {
      const roleResults = this.results.filter((entry) => entry.testName.includes(`${role}:`));
      if (!roleResults.length || roleResults.every((entry) => entry.status === 'skipped')) return 'SKIPPED';
      if (roleResults.some((entry) => !['passed', 'skipped'].includes(entry.status))) return 'FAIL';
      return roleResults.every((entry) => entry.status === 'passed') ? 'PASS' : 'PARTIAL';
    };
    const statusForTitle = (pattern) => {
      const entries = this.results.filter((entry) => entry.testName.includes(pattern));
      if (!entries.length || entries.every((entry) => entry.status === 'skipped')) return 'SKIPPED';
      return entries.every((entry) => entry.status === 'passed') ? 'PASS' : 'FAIL';
    };
    const responsiveStatus = (section, viewport) => safeReportValue(this.regressionSummary[section]?.[viewport] || statusForTitle(`REGRESSION: ${section === 'dataQuality' ? 'Data Quality' : 'Audit Log'} responsive`));
    const ready = Array.isArray(this.technicalSummary?.ready) ? this.technicalSummary.ready : [];
    const mode = String(process.env.UAT_MODE || 'technical').toUpperCase();
    let accountPreflight = {};
    try {
      accountPreflight = JSON.parse(fs.readFileSync('test-results/uat-v3-account-preflight.json', 'utf8')).roles || {};
    } catch {
      accountPreflight = {};
    }
    const lines = [
      '### Automated Technical Smoke V2',
      '### Automated UAT V3',
      `- Mode: ${mode}`,
      `- Target: ${safeReportValue(process.env.UAT_BASE_URL, 'not configured')}`,
      `- Source SHA: ${safeReportValue(this.technicalSummary?.sourceSha || process.env.UAT_SOURCE_SHA, 'not supplied')}`,
      `- Harness SHA: ${safeReportValue(this.technicalSummary?.harnessSha || process.env.UAT_HARNESS_SHA, 'not supplied')}`,
      `- Expected deployment ID: ${safeReportValue(this.technicalSummary?.expectedDeploymentId || process.env.UAT_EXPECTED_DEPLOYMENT_ID, 'not supplied')}`,
      '',
      '#### HTTP',
      `- Root: ${safeReportValue(this.technicalSummary?.root)}`,
      `- Login: ${safeReportValue(this.technicalSummary?.login)}`,
      `- Health: ${safeReportValue(this.technicalSummary?.health)}`,
      `- Ready #1: ${safeReportValue(ready[0])}`,
      `- Ready #2: ${safeReportValue(ready[1])}`,
      `- Ready #3: ${safeReportValue(ready[2])}`,
      '',
      '#### ARTIFACT',
      `- Vite assets: ${safeReportValue(this.technicalSummary?.viteAssets)}`,
      `- Unexpected /_next/: ${safeReportValue(this.technicalSummary?.unexpectedNext)}`,
      '',
      '#### AUTH BOUNDARY',
      `- Audit API 401: ${safeReportValue(this.technicalSummary?.auditAuthorization)}`,
      '',
      '#### RESPONSIVE CONTRACTS',
      `- Data Quality 390: ${responsiveStatus('dataQuality', '390')}`,
      `- Data Quality 768: ${responsiveStatus('dataQuality', '768')}`,
      `- Data Quality 1024: ${responsiveStatus('dataQuality', '1024')}`,
      `- Data Quality 1440: ${responsiveStatus('dataQuality', '1440')}`,
      `- Audit 390: ${responsiveStatus('audit', '390')}`,
      `- Audit 768: ${responsiveStatus('audit', '768')}`,
      `- Audit 1440: ${responsiveStatus('audit', '1440')}`,
      '',
      '#### DASHBOARD CONTRACT',
      `- Healthy warning state: ${safeReportValue(this.regressionSummary.dashboard?.healthyWarning || statusForTitle('REGRESSION: source contracts'))}`,
      `- Partial warning state: ${safeReportValue(this.regressionSummary.dashboard?.partialWarning || statusForTitle('REGRESSION: source contracts'))}`,
      '',
      '#### ORIGIN',
      `- ${safeReportValue(this.technicalSummary?.origin, 'UNKNOWN')}`,
      '',
      '#### AUTHENTICATED',
      `- ADMIN login readiness: ${safeReportValue(accountPreflight.ADMIN)}`,
      `- MANAGER login readiness: ${safeReportValue(accountPreflight.MANAGER)}`,
      `- VIEWER login readiness: ${safeReportValue(accountPreflight.VIEWER)}`,
      `- Authenticated ADMIN: ${roleStatus('ADMIN')}`,
      `- Authenticated MANAGER: ${roleStatus('MANAGER')}`,
      `- Authenticated VIEWER: ${roleStatus('VIEWER')}`,
      '',
      '#### HEAVY READ SAFETY',
      `- testsFinishingWithOutstandingHeavyReads: ${this.heavyReadSafety.testsFinishingWithOutstandingHeavyReads}`,
      `- exceptionalHeavyDrainCount: ${this.heavyReadSafety.exceptionalHeavyDrainCount}`,
      `- exceptionalHeavyDrainWaitMs: ${this.heavyReadSafety.exceptionalHeavyDrainWaitMs}`,
      `- realHeavyStarts: ${this.heavyReadSafety.realHeavyStarts}`,
      `- preventedHeavyStarts: ${this.heavyReadSafety.preventedHeavyStarts}`,
      `- outstandingHeavyReads: ${JSON.stringify(this.heavyReadSafety.outstandingHeavyReads)}`,
      '',
      `- Passed tests: ${passed}`,
      `- Skipped tests: ${skipped}`,
      `- Failed tests: ${failed}`,
      `- Overall: ${safeReportValue(String(result.status || '').toUpperCase())}`
    ];
    const performanceValidation = sanitizePerformanceValidation(this.performanceValidation);
    if (performanceValidation.networkContracts || performanceValidation.benchmark) {
      lines.push('', '#### PERFORMANCE VALIDATION');
      for (const section of ['license', 'reportCenter']) {
        for (const metric of performanceValidation.networkContracts?.[section] || []) {
          lines.push(`- NETWORK ${section} ${metric.endpoint} ${metric.filterCategory}: count=${metric.count ?? 'n/a'} status=${metric.status ?? 'n/a'} ${metric.classification || ''}`.trim());
        }
      }
      for (const group of performanceValidation.benchmark?.groups || []) {
        const canonical = group.stats.find((stat) => stat.targetLabel === 'canonical') || {};
        const candidate = group.stats.find((stat) => stat.targetLabel === 'candidate') || {};
        lines.push(`- BENCHMARK ${group.endpoint} ${group.role}: canonical n=${canonical.count || 0} min=${canonical.minMs ?? 'n/a'} median=${canonical.medianMs ?? 'n/a'} max=${canonical.maxMs ?? 'n/a'}; candidate n=${candidate.count || 0} min=${candidate.minMs ?? 'n/a'} median=${candidate.medianMs ?? 'n/a'} max=${candidate.maxMs ?? 'n/a'}; delta=${group.medianDeltaPercent ?? 'n/a'}%; ${group.classification}`);
      }
      if (performanceValidation.benchmark) lines.push(`- PERFORMANCE CLASSIFICATION: ${performanceValidation.benchmark.classification}`);
    }
    for (const entry of this.results) lines.push(`- ${entry.status.toUpperCase()}: ${entry.testName}`);
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\n')}\n`);
    const safeResults = this.results.map(({ testName, role, status, duration, safeErrorCode, stage, authContract, pageMonitor }) => ({
      testName,
      ...(role ? { role } : {}),
      status,
      duration,
      ...(safeErrorCode ? { safeErrorCode } : {}),
      ...(stage ? { stage } : {}),
      ...(authContract ? { authContract } : {}),
      ...(pageMonitor ? { pageMonitor } : {})
    }));
    fs.mkdirSync(path.dirname(this.jsonOutputFile), { recursive: true });
    fs.writeFileSync(this.jsonOutputFile, JSON.stringify({
      mode: this.mode,
      tests: safeResults,
      totals: { passed, skipped, failed },
      overall: String(result.status || '').toUpperCase(),
      heavyReadSafety: this.heavyReadSafety,
      ...(performanceValidation.networkContracts || performanceValidation.benchmark ? { performanceValidation } : {})
    }, null, 2) + '\n');
  }
}

module.exports = UatSummaryReporter;
