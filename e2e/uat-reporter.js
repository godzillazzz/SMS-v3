const fs = require('node:fs');
const path = require('node:path');

class UatSummaryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'test-results/uat-summary.md';
    this.results = [];
    this.technicalSummary = undefined;
    this.regressionSummary = {};
  }

  onTestEnd(test, result) {
    const title = test.titlePath().slice(1).join(' › ');
    this.results.push({ title, status: result.status });
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
      const roleResults = this.results.filter((entry) => entry.title.includes(`${role}:`));
      if (!roleResults.length || roleResults.every((entry) => entry.status === 'skipped')) return 'SKIPPED';
      if (roleResults.some((entry) => !['passed', 'skipped'].includes(entry.status))) return 'FAIL';
      return roleResults.every((entry) => entry.status === 'passed') ? 'PASS' : 'PARTIAL';
    };
    const statusForTitle = (pattern) => {
      const entries = this.results.filter((entry) => entry.title.includes(pattern));
      if (!entries.length || entries.every((entry) => entry.status === 'skipped')) return 'SKIPPED';
      return entries.every((entry) => entry.status === 'passed') ? 'PASS' : 'FAIL';
    };
    const responsiveStatus = (section, viewport) => this.regressionSummary[section]?.[viewport] || statusForTitle(`REGRESSION: ${section === 'dataQuality' ? 'Data Quality' : 'Audit Log'} responsive`);
    const ready = this.technicalSummary?.ready || [];
    const lines = [
      '### Automated Technical Smoke V2',
      `- Target: ${process.env.UAT_BASE_URL || 'not configured'}`,
      `- Source SHA: ${this.technicalSummary?.sourceSha || process.env.UAT_SOURCE_SHA || 'not supplied'}`,
      '',
      '#### HTTP',
      `- Root: ${this.technicalSummary?.root || 'NOT RUN'}`,
      `- Login: ${this.technicalSummary?.login || 'NOT RUN'}`,
      `- Health: ${this.technicalSummary?.health || 'NOT RUN'}`,
      `- Ready #1: ${ready[0] || 'NOT RUN'}`,
      `- Ready #2: ${ready[1] || 'NOT RUN'}`,
      `- Ready #3: ${ready[2] || 'NOT RUN'}`,
      '',
      '#### ARTIFACT',
      `- Vite assets: ${this.technicalSummary?.viteAssets || 'NOT RUN'}`,
      `- Unexpected /_next/: ${this.technicalSummary?.unexpectedNext || 'NOT RUN'}`,
      '',
      '#### AUTH BOUNDARY',
      `- Audit API 401: ${this.technicalSummary?.auditAuthorization || 'NOT RUN'}`,
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
      `- Healthy warning state: ${this.regressionSummary.dashboard?.healthyWarning || statusForTitle('REGRESSION: source contracts')}`,
      `- Partial warning state: ${this.regressionSummary.dashboard?.partialWarning || statusForTitle('REGRESSION: source contracts')}`,
      '',
      '#### ORIGIN',
      `- ${this.technicalSummary?.origin || 'UNKNOWN'}`,
      '',
      '#### AUTHENTICATED',
      `- Authenticated ADMIN: ${roleStatus('ADMIN')}`,
      `- Authenticated MANAGER: ${roleStatus('MANAGER')}`,
      `- Authenticated VIEWER: ${roleStatus('VIEWER')}`,
      '',
      `- Passed tests: ${passed}`,
      `- Skipped tests: ${skipped}`,
      `- Failed tests: ${failed}`,
      `- Overall: ${result.status.toUpperCase()}`
    ];
    for (const entry of this.results) lines.push(`- ${entry.status.toUpperCase()}: ${entry.title}`);
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\n')}\n`);
  }
}

module.exports = UatSummaryReporter;
