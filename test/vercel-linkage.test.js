const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_ORG_ID,
  EXPECTED_PROJECT_ID,
  classifyVercelFailure,
  redactVercelOutput,
  runVercelDiagnostic,
  selectDiagnosticMessage,
  writeTemporaryProjectLinkage
} = require('../scripts/ci/vercel-linkage');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('classifies Vercel linkage failures fail-closed', () => {
  assert.equal(classifyVercelFailure('401 invalid token', 1), 'INVALID_OR_EXPIRED_TOKEN');
  assert.equal(classifyVercelFailure('403 forbidden', 1), 'TOKEN_SCOPE_OR_PROJECT_ACCESS');
  assert.equal(classifyVercelFailure('project not found', 1), 'PROJECT_NOT_FOUND');
  assert.equal(classifyVercelFailure('team scope mismatch', 1), 'ORG_SCOPE_MISMATCH');
  assert.equal(classifyVercelFailure('unknown option --project', 1), 'CLI_ARGUMENT_ERROR');
  assert.equal(classifyVercelFailure('network timeout', 1), 'NETWORK_ERROR');
  assert.equal(classifyVercelFailure('unexpected response', 1), 'UNKNOWN_VERCEL_LINKAGE_ERROR');
  assert.equal(classifyVercelFailure('HTTP 404 Not Found', 1, 'team'), 'ORG_SCOPE_MISMATCH');
  assert.equal(classifyVercelFailure('HTTP 404 Not Found', 1, 'project'), 'PROJECT_NOT_FOUND');
});

test('diagnostic message skips the CLI banner and keeps only a safe error line', () => {
  assert.equal(selectDiagnosticMessage('Vercel CLI 56.4.1\nError: HTTP 404 Not Found'), 'Error: HTTP 404 Not Found');
});

test('redacts tokens, credential URLs, database URLs, headers, emails, and paths', () => {
  const token = 'vercel-secret-token';
  const output = redactVercelOutput(
    `Authorization: Bearer ${token}\nhttps://user:pass@example.test/path?secret=value\nDATABASE_URL=postgresql://user:pass@db.example/app\nuser@example.com\nC:\\runner\\work\\repo`,
    [token, 'postgresql://user:pass@db.example/app']
  );

  assert.doesNotMatch(output, /vercel-secret-token|Bearer|user:pass|postgresql:\/\/|user@example\.com|C:\\runner/);
});

test('missing token fails without invoking the CLI', () => {
  let invoked = false;
  const result = runVercelDiagnostic('vercel', ['whoami'], {}, {
    runner: () => {
      invoked = true;
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.category, 'INVALID_OR_EXPIRED_TOKEN');
  assert.equal(invoked, false);
});

test('diagnostic runner returns sanitized classification and exit code', () => {
  const result = runVercelDiagnostic('vercel', ['whoami'], { VERCEL_TOKEN: 'secret' }, {
    runner: () => ({ status: 1, stdout: '', stderr: 'Error 403: forbidden for token secret' })
  });

  assert.equal(result.status, 1);
  assert.equal(result.category, 'TOKEN_SCOPE_OR_PROJECT_ACCESS');
  assert.doesNotMatch(result.sanitizedOutput, /secret/);
});

test('temporary project linkage contains only approved project and org IDs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-linkage-test-'));
  try {
    const projectPath = writeTemporaryProjectLinkage(directory);
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    assert.deepEqual(project, { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_ORG_ID });
    assert.doesNotMatch(fs.readFileSync(projectPath, 'utf8'), /token|secret|password|postgres/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
