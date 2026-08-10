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
    const failed = this.results.filter((entry) => entry.status !== 'passed').length;
    const lines = [
      '### Automated UAT',
      `- Target: ${process.env.UAT_BASE_URL || 'not configured'}`,
      `- Passed: ${passed}`,
      `- Failed: ${failed}`,
      `- Result: ${result.status.toUpperCase()}`
    ];
    for (const entry of this.results) lines.push(`- ${entry.status.toUpperCase()}: ${entry.title}`);
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\n')}\n`);
  }
}

module.exports = UatSummaryReporter;
