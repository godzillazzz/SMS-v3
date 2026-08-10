const fs = require('node:fs');
const path = require('node:path');

class UatSummaryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'test-results/uat-summary.md';
    this.results = [];
  }

  onTestEnd(test, result) {
    this.results.push({ title: test.titlePath().slice(1).join(' › '), status: result.status });
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
    const lines = [
      '### Automated Technical Smoke',
      `- Target: ${process.env.UAT_BASE_URL || 'not configured'}`,
      `- Passed: ${passed}`,
      `- Skipped: ${skipped}`,
      `- Failed: ${failed}`,
      `- Authenticated ADMIN: ${roleStatus('ADMIN')}`,
      `- Authenticated MANAGER: ${roleStatus('MANAGER')}`,
      `- Authenticated VIEWER: ${roleStatus('VIEWER')}`,
      `- Result: ${result.status.toUpperCase()}`
    ];
    for (const entry of this.results) lines.push(`- ${entry.status.toUpperCase()}: ${entry.title}`);
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\n')}\n`);
  }
}

module.exports = UatSummaryReporter;
