'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { readConfig, roles } = require('../../e2e/uat-v3/config');
const { scanArtifact, sensitiveUatValues } = require('../../e2e/uat-v3/security');
const { diagnosticLines } = require('../../e2e/uat-v3/reporter');
try {
  const rawCooldown = process.env.UAT_ROLE_COOLDOWN_MS ?? '5000';
  if (!/^\d+$/.test(rawCooldown) || Number(rawCooldown) < 0 || Number(rawCooldown) > 10000) {
    throw new Error('UAT_ROLE_COOLDOWN_MS_INVALID');
  }
  readConfig();
  const file = 'test-results/uat-v3-safe/results.json';
  for (const path of [file, 'test-results/uat-v3-safe/preflight.json']) {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
  // Never forward raw Playwright output, errors, traces, DOM, tokens, or login payloads.
  const result = spawnSync(process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.uat-v3.config.js'],
    { env: process.env, stdio: 'ignore' });
  if (!fs.existsSync(file)) throw new Error('UAT_REPORT_MISSING');
  const content = fs.readFileSync(file);
  if (!scanArtifact(file, content, { secretValues: sensitiveUatValues() }).safe) throw new Error('UAT_ARTIFACT_LEAK');
  const summary = JSON.parse(content);
  if (summary.source_sha !== process.env.UAT_SOURCE_SHA
    || summary.harness_sha !== process.env.GITHUB_SHA
    || summary.deployment_id !== process.env.UAT_EXPECTED_DEPLOYMENT_ID) {
    throw new Error('UAT_EVIDENCE_IDENTITY_MISMATCH');
  }
  for (const line of diagnosticLines(summary)) process.stdout.write(line + '\n');
  if (result.status !== 0 || result.error || summary.status !== 'passed'
    || summary.counts.failed !== 0 || summary.counts.skipped !== 0 || summary.counts.passed !== 24
    || roles.some((role) => summary.tests.filter((t) => t.role === role && t.status === 'passed').length !== 6
      || summary.roles?.[role]?.state !== 'PASS')) throw new Error('UAT_EXECUTION_FAILED');
  process.stdout.write('UAT_V3_READONLY=PASS\nUAT_ARTIFACT_LEAK_COUNT=0\nUAT_TESTS=24_PASS_0_FAIL_0_SKIP\n');
} catch (error) {
  const code = ['UAT_CREDENTIALS_REQUIRED', 'UAT_ARTIFACT_LEAK', 'UAT_ROLE_ACCOUNTS_NOT_DISTINCT',
    'UAT_IMMUTABLE_PREVIEW_REQUIRED', 'UAT_REPORT_MISSING', 'UAT_EVIDENCE_IDENTITY_MISMATCH',
    'UAT_ROLE_COOLDOWN_MS_INVALID']
    .includes(error.code || error.message) ? error.code || error.message : 'UAT_EXECUTION_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
