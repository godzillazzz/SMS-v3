const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  authenticatedArtifactAllowlist,
  collectFiles,
  createAuthenticatedArtifactFixture,
  runAuthenticatedFailureArtifactPreflight,
  scanGeneratedArtifacts
} = require('../e2e/helpers/uat-v3-artifact-preflight');
const { artifactLeakFindings, sanitizeUatDiagnostic } = require('../e2e/helpers/uat-v3-security');
const playwrightConfig = fs.readFileSync(path.resolve(__dirname, '../playwright.config.js'), 'utf8');
const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-uat-v3-artifact-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('UAT_V3_ARTIFACT_PREFLIGHT: synthetic password and Authorization leaks are reproduced', () => {
  assert.deepEqual(
    artifactLeakFindings('playwright-report/index.html', '<input name="password" value="FAKE_UAT_PASSWORD_123">', { passwordValues: ['FAKE_UAT_PASSWORD_123'] }),
    ['PASSWORD_VALUE']
  );
  assert.deepEqual(
    artifactLeakFindings('playwright-report/data/error-context.md', 'Authorization: Bearer FAKE_UAT_TOKEN_123456789'),
    ['AUTHORIZATION_HEADER']
  );
  assert.deepEqual(
    artifactLeakFindings('test-results/uat-results.json', '{"headers":{"Authorization":"Bearer FAKE_UAT_TOKEN_123456789"}}'),
    ['AUTHORIZATION_HEADER']
  );
  assert.deepEqual(
    artifactLeakFindings('test-results/playwright/authenticated-v3-ADMIN-schedule/error-context.md', 'Authorization: Bearer FAKE_UAT_TOKEN_123456789'),
    ['AUTHORIZATION_HEADER']
  );
});

test('UAT_V3_ARTIFACT_PREFLIGHT: authenticated diagnostic sanitizer removes auth material', () => {
  const value = sanitizeUatDiagnostic('Authorization: Bearer FAKE_UAT_TOKEN_123 password=FAKE_UAT_PASSWORD_123 uat-admin@example.test');
  assert.equal(value.includes('FAKE_UAT_TOKEN_123'), false);
  assert.equal(value.includes('FAKE_UAT_PASSWORD_123'), false);
  assert.equal(value.includes('uat-admin@example.test'), false);
  assert.match(value, /\[REDACTED_AUTHORIZATION\]/);
});

test('UAT_V3_ARTIFACT_PREFLIGHT: actual Playwright failure context is sanitized', () => {
  withFixture((root) => {
    const result = runAuthenticatedFailureArtifactPreflight(root, path.resolve(__dirname, '..'), {
      scanOptions: { passwordValues: ['FAKE_UAT_PASSWORD_123'] }
    });
    assert.equal(result.exitCode, 1);
    const errorContexts = collectFiles(result.resultsDirectory).filter((filePath) => filePath.endsWith('error-context.md'));
    assert.equal(errorContexts.length, 1);
    assert.deepEqual(result.findings, []);
    const content = fs.readFileSync(errorContexts[0], 'utf8');
    assert.equal(/Authorization:\s*Bearer\s+[A-Za-z0-9._~-]{20,}/i.test(content), false);
    assert.equal(/\bAuthorization\s*[:=]/i.test(content), false);
    assert.equal(/\bBearer\s+[A-Za-z0-9._~-]{20,}/i.test(content), false);
    assert.equal(content.includes('FAKE_AUTH_TOKEN_123456789'), false);
  });
});

test('UAT_V3_ARTIFACT_PREFLIGHT: authenticated reporter generates an allowlisted zero-leak set', () => {
  withFixture((root) => {
    createAuthenticatedArtifactFixture(root);
    const findings = scanGeneratedArtifacts(root, {
      passwordValues: ['FAKE_UAT_PASSWORD_123'],
      emailValues: ['uat-admin@example.test'],
      bypassSecret: 'FAKE_VERCEL_BYPASS_123456789'
    });
    assert.deepEqual(findings, []);
    const files = collectFiles(root).map((filePath) => path.relative(path.join(root, 'test-results'), filePath).replace(/\\/g, '/'));
    assert.deepEqual(files.sort(), [
      ...authenticatedArtifactAllowlist,
      'playwright/v3-admin-390.png'
    ].sort());
    assert.equal(fs.existsSync(path.join(root, 'playwright-report')), false);
    const result = JSON.parse(fs.readFileSync(path.join(root, 'test-results/uat-results.json'), 'utf8'));
    assert.deepEqual(Object.keys(result).sort(), ['mode', 'overall', 'tests', 'totals']);
    assert.equal(JSON.stringify(result).includes('FAKE_UAT_TOKEN_123456789'), false);
    assert.equal(JSON.stringify(result).includes('FAKE_UAT_PASSWORD_123'), false);
    assert.equal(JSON.stringify(result).includes('Authorization'), false);
    assert.equal(JSON.stringify(result).includes('headers'), false);
  });
});

test('UAT_V3_ARTIFACT_PREFLIGHT: generated artifact preflight has no hidden unsafe files', () => {
  withFixture((root) => {
    createAuthenticatedArtifactFixture(root);
    const files = collectFiles(root).map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'));
    assert.equal(files.some((filePath) => /(?:error-context|storageState|auth-state|\.har$)/i.test(filePath)), false);
    assert.equal(files.some((filePath) => filePath.startsWith('playwright-report/')), false);
  });
});

test('UAT_V3_ARTIFACT_PREFLIGHT: authenticated reporter and upload policy are minimal', () => {
  assert.match(playwrightConfig, /const authenticatedMode = process\.env\.UAT_MODE === 'authenticated'/);
  assert.match(playwrightConfig, /retries: authenticatedMode \? 0/);
  assert.match(playwrightConfig, /screenshot: 'off'/);
  assert.match(playwrightConfig, /jsonOutputFile: 'test-results\/uat-results\.json'/);
  assert.doesNotMatch(playwrightConfig, /\['html'/);
  assert.doesNotMatch(playwrightConfig, /\['json'/);
  const authenticatedUpload = workflow.match(/- name: Upload authenticated UAT artifacts[\s\S]*?(?=\n\s{2}\w|$)/)?.[0] || '';
  assert.doesNotMatch(authenticatedUpload, /playwright-report/);
  for (const fileName of authenticatedArtifactAllowlist) assert.match(authenticatedUpload, new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(authenticatedUpload, /test-results\/playwright/);
});
