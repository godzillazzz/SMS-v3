'use strict';
const fs = require('node:fs');
class SafeReporter {
  constructor() { this.results = []; }
  onTestEnd(test, result) {
    const role = /^(ADMIN|MANAGER|SUPERVISOR|VIEWER):/.exec(test.title)?.[1];
    this.results.push({ role: role || 'UNKNOWN', title: test.title, status: result.status });
  }
  onEnd(result) {
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const r of this.results) r.status === 'passed' ? counts.passed++ : r.status === 'skipped' ? counts.skipped++ : counts.failed++;
    fs.mkdirSync('test-results/uat-v3-safe', { recursive: true });
    fs.writeFileSync('test-results/uat-v3-safe/results.json', JSON.stringify({ status: result.status, coverage: 'HOSTED_READONLY_AUTHENTICATED', source_sha: process.env.UAT_SOURCE_SHA, harness_sha: process.env.GITHUB_SHA, deployment_id: process.env.UAT_EXPECTED_DEPLOYMENT_ID, counts, tests: this.results }));
  }
}
module.exports = SafeReporter;
