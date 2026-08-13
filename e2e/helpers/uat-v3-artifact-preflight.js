const fs = require('node:fs');
const path = require('node:path');
const UatSummaryReporter = require('../uat-reporter');
const { scanArtifact } = require('./uat-v3-security');

const authenticatedArtifactAllowlist = [
  'uat-summary.md',
  'uat-results.json',
  'uat-v3-account-preflight.json',
  'uat-v3-artifact-summary.json'
];

function relativeArtifactPath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      stack.push(...fs.readdirSync(current).map((entry) => path.join(current, entry)));
    } else {
      files.push(current);
    }
  }
  return files;
}

function createAuthenticatedArtifactFixture(root) {
  const resultsDirectory = path.join(root, 'test-results');
  const screenshotsDirectory = path.join(resultsDirectory, 'playwright');
  fs.mkdirSync(screenshotsDirectory, { recursive: true });

  const reporter = new UatSummaryReporter({
    mode: 'authenticated',
    outputFile: path.join(resultsDirectory, 'uat-summary.md'),
    jsonOutputFile: path.join(resultsDirectory, 'uat-results.json')
  });
  reporter.onTestEnd(
    { titlePath: () => ['root', 'ADMIN authenticated V3', 'V3 ADMIN: login and role identity'] },
    {
      status: 'passed',
      duration: 42,
      attachments: [{
        name: 'v3-role-status.json',
        body: Buffer.from(JSON.stringify({ role: 'ADMIN', login: 'PASS' }))
      }]
    }
  );
  reporter.onTestEnd(
    { titlePath: () => ['root', 'ADMIN authenticated V3', 'V3 ADMIN: read-only API authorization and scope'] },
    {
      status: 'failed',
      duration: 84,
      errors: [{ message: 'ADMIN Schedule expected 200, received 403; Authorization: Bearer FAKE_UAT_TOKEN_123456789 password=FAKE_UAT_PASSWORD_123' }],
      attachments: []
    }
  );
  reporter.onEnd({ status: 'failed' });

  fs.writeFileSync(path.join(resultsDirectory, 'uat-v3-account-preflight.json'), JSON.stringify({
    mode: 'authenticated',
    roles: { ADMIN: 'YES', MANAGER: 'YES', VIEWER: 'YES' }
  }));
  fs.writeFileSync(path.join(resultsDirectory, 'uat-v3-artifact-summary.json'), JSON.stringify({ leakCount: 0, findings: [] }));
  fs.writeFileSync(path.join(screenshotsDirectory, 'v3-admin-390.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
  return root;
}

function scanGeneratedArtifacts(root, options = {}) {
  const findings = [];
  for (const filePath of collectFiles(root)) {
    const relativePath = relativeArtifactPath(root, filePath);
    const finding = scanArtifact(relativePath, fs.readFileSync(filePath), options);
    if (!finding.safe) findings.push(finding);
  }
  return findings;
}

module.exports = {
  authenticatedArtifactAllowlist,
  collectFiles,
  createAuthenticatedArtifactFixture,
  scanGeneratedArtifacts
};
