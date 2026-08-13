const fs = require('node:fs');
const path = require('node:path');
const { sanitizeUatDiagnostic } = require('./helpers/uat-v3-security');

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

class UatSummaryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'test-results/uat-summary.md';
    this.jsonOutputFile = options.jsonOutputFile || 'test-results/uat-results.json';
    this.mode = options.mode || String(process.env.UAT_MODE || 'technical').toLowerCase();
    this.results = [];
    this.technicalSummary = undefined;
    this.regressionSummary = {};
  }

  onTestEnd(test, result) {
    const title = test.titlePath().slice(1).join(' › ');
    this.results.push({
      testName: sanitizeUatDiagnostic(title),
      role: roleFromTitle(title),
      status: result.status,
      duration: Number.isFinite(result.duration) ? result.duration : 0,
      safeErrorCode: safeErrorCode(result)
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
      `- Passed tests: ${passed}`,
      `- Skipped tests: ${skipped}`,
      `- Failed tests: ${failed}`,
      `- Overall: ${safeReportValue(String(result.status || '').toUpperCase())}`
    ];
    for (const entry of this.results) lines.push(`- ${entry.status.toUpperCase()}: ${entry.testName}`);
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\n')}\n`);
    const safeResults = this.results.map(({ testName, role, status, duration, safeErrorCode }) => ({
      testName,
      ...(role ? { role } : {}),
      status,
      duration,
      ...(safeErrorCode ? { safeErrorCode } : {})
    }));
    fs.mkdirSync(path.dirname(this.jsonOutputFile), { recursive: true });
    fs.writeFileSync(this.jsonOutputFile, JSON.stringify({
      mode: this.mode,
      tests: safeResults,
      totals: { passed, skipped, failed },
      overall: String(result.status || '').toUpperCase()
    }, null, 2) + '\n');
  }
}

module.exports = UatSummaryReporter;
