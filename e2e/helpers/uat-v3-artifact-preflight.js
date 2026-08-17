const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const UatSummaryReporter = require('../uat-reporter');
const { scanArtifact } = require('./uat-v3-security');

const authenticatedArtifactAllowlist = [
  'uat-summary.md',
  'uat-results.json',
  'uat-v3-account-preflight.json',
  'uat-v3-artifact-summary.json',
  'uat-v3-stage-diagnostics.jsonl'
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
      attachments: [
        { name: 'v3-role-status.json', body: Buffer.from(JSON.stringify({ role: 'ADMIN', login: 'PASS' })) },
        { name: 'v31-auth-contract.json', body: Buffer.from(JSON.stringify({ loginStatus: 200, dashboardStatus: 200, roleMatched: true, accessTokenPresent: true, cachedSessionPresent: false, cachedRefreshUsed: false, dashboardRequestTerminal: true, authenticatedShellVisible: true, dashboardSuppressorActiveAtHelperReturn: 0 })) },
        { name: 'heavy-read-safety.json', body: Buffer.from(JSON.stringify({ testsFinishingWithOutstandingHeavyReads: 0, exceptionalHeavyDrainCount: 0, exceptionalHeavyDrainWaitMs: 0, realHeavyStarts: 1, preventedHeavyStarts: 0 })) }
      ]
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
  fs.writeFileSync(path.join(resultsDirectory, 'uat-v3-stage-diagnostics.jsonl'), `${JSON.stringify({ role: 'ADMIN', testCode: 'REPORT_CENTER', currentStage: 'RC03_EXEC_REQUEST', state: 'RUNNING', safeApiPath: '/api/v1/executive-report', durationBucket: '1-5s', safeErrorCode: null })}\n`);
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

function createAuthenticatedFailureFixture(root, repositoryRoot) {
  const packagePath = path.join(repositoryRoot, 'node_modules', '@playwright', 'test');
  const helperPath = path.join(repositoryRoot, 'e2e', 'helpers', 'uat-test.js');
  const configPath = path.join(root, 'playwright.config.js');
  const testPath = path.join(root, 'failure.spec.js');
  fs.writeFileSync(testPath, `const { test, expect } = require(${JSON.stringify(helperPath)});

test('synthetic authenticated API authorization failure', async ({ page }) => {
  await page.setContent('<main>authenticated fixture</main>');
  const fakeToken = ['FAKE_AUTH_TOKEN', '123456789'].join('_');
  await expect(403, 'API authorization header: Authorization: Bearer ' + fakeToken).toBe(200);
});
`);
  fs.writeFileSync(configPath, `const { defineConfig } = require(${JSON.stringify(packagePath)});
const path = require('node:path');

module.exports = defineConfig({
  testDir: __dirname,
  outputDir: path.join(__dirname, 'test-results'),
  reporter: [['line']],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  workers: 1,
  retries: 0
});
`);
  return { configPath, testPath };
}

function runAuthenticatedFailureArtifactPreflight(root, repositoryRoot, options = {}) {
  const { configPath } = createAuthenticatedFailureFixture(root, repositoryRoot);
  const cliPath = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'test', '--config', configPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      UAT_MODE: 'authenticated',
      UAT_BASE_URL: options.baseUrl || 'http://uat.invalid',
      PLAYWRIGHT_NO_COPY_PROMPT: '1'
    },
    stdio: 'ignore'
  });
  const resultsDirectory = path.join(root, 'test-results');
  const findings = fs.existsSync(resultsDirectory)
    ? scanGeneratedArtifacts(resultsDirectory, options.scanOptions || {})
    : [];
  return {
    exitCode: result.status ?? 1,
    resultsDirectory,
    findings,
    errorContextPath: path.join(resultsDirectory, 'failure-synthetic-authenticated-API-authorization-failure', 'error-context.md')
  };
}

function createAuthenticatedLoginFailureFixture(root, repositoryRoot, { scrub = true } = {}) {
  const packagePath = path.join(repositoryRoot, 'node_modules', '@playwright', 'test');
  const helperPath = path.join(repositoryRoot, 'e2e', 'helpers', 'uat-test.js');
  const authHelperPath = path.join(repositoryRoot, 'e2e', 'helpers', 'uat-auth.js');
  const configPath = path.join(root, 'playwright.config.js');
  const testPath = path.join(root, 'login-failure.spec.js');
  fs.writeFileSync(testPath, `const { test, expect } = require(${JSON.stringify(helperPath)});
const { scrubLoginCredentialDom } = require(${JSON.stringify(authHelperPath)});

test('synthetic authenticated login post-submit failure', async ({ page }) => {
  await page.setContent('<form><label>รหัสผ่าน<input type="password" aria-label="รหัสผ่าน"></label><button type="submit">เข้าสู่ระบบ</button></form>');
  await page.locator('form').evaluate((form) => form.addEventListener('submit', (event) => event.preventDefault(), { once: true }));
  await page.getByLabel('รหัสผ่าน').fill(process.env.UAT_SYNTHETIC_PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  ${scrub ? 'await scrubLoginCredentialDom(page);' : ''}
  await expect(403, 'synthetic post-submit failure').toBe(200);
});
`);
  fs.writeFileSync(configPath, `const { defineConfig } = require(${JSON.stringify(packagePath)});
const path = require('node:path');

module.exports = defineConfig({
  testDir: __dirname,
  outputDir: path.join(__dirname, 'test-results'),
  reporter: [['line']],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  workers: 1,
  retries: 0
});
`);
  return { configPath, testPath };
}

function runAuthenticatedLoginFailureArtifactPreflight(root, repositoryRoot, { scrub = true } = {}) {
  const syntheticPassword = ['FAKE_UAT_LOGIN_PASSWORD', '123456789'].join('_');
  const { configPath } = createAuthenticatedLoginFailureFixture(root, repositoryRoot, { scrub });
  const cliPath = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'test', '--config', configPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      UAT_MODE: 'authenticated',
      UAT_BASE_URL: 'http://uat.invalid',
      UAT_SYNTHETIC_PASSWORD: syntheticPassword,
      PLAYWRIGHT_NO_COPY_PROMPT: '1'
    },
    stdio: 'ignore'
  });
  const resultsDirectory = path.join(root, 'test-results');
  const findings = fs.existsSync(resultsDirectory)
    ? scanGeneratedArtifacts(resultsDirectory, { passwordValues: [syntheticPassword] })
    : [];
  return {
    exitCode: result.status ?? 1,
    findings,
    resultsDirectory,
    syntheticPassword
  };
}
module.exports = {
  authenticatedArtifactAllowlist,
  collectFiles,
  createAuthenticatedArtifactFixture,
  createAuthenticatedLoginFailureFixture,
  createAuthenticatedFailureFixture,
  runAuthenticatedFailureArtifactPreflight,
  runAuthenticatedLoginFailureArtifactPreflight,
  scanGeneratedArtifacts
};
