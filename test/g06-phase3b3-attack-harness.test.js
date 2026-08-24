'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PROVIDER_RUNTIME_STATE,
  PROVIDER_EMPIRICAL_STATUS,
  scenarios,
  summarizeAttackMatrix,
  plannedEvidenceRows
} = require('../scripts/g06/phase3b3-attack-matrix');
const { assertMatrixIntegrity, createPlan } = require('../scripts/g06/phase3b3-attack-harness');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const canonical = [
  ['Genuine Employee + ACTIVE device + valid context', 'PASS'],
  ['Color printed Reference Photo', 'PAD FAIL'],
  ['High-quality/glossy printed photo', 'PAD FAIL'],
  ['Photo displayed on another phone', 'PAD FAIL'],
  ['Photo displayed on tablet/monitor', 'PAD FAIL'],
  ['Prerecorded face video', 'PAD/INJECTION FAIL'],
  ['Video with blink/head movement', 'PAD/INJECTION FAIL'],
  ['Wrong live person', 'FACE MATCH FAIL'],
  ['Correct face on revoked/wrong device', 'DEVICE AUTHORITY FAIL'],
  ['Replayed device challenge', 'REPLAY FAIL'],
  ['Replayed biometric receipt', 'REPLAY FAIL'],
  ['Reference Photo replaced mid-session', 'STALE FAIL'],
  ['Device replaced/revoked mid-session', 'STALE FAIL'],
  ['Expired verification session', 'EXPIRED FAIL'],
  ['Correct face/device outside geofence', 'LOCATION FAIL'],
  ['Correct face/device with wrong site QR/context', 'SITE CONTEXT FAIL'],
  ['Provider unavailable/timeout', 'FAIL CLOSED / controlled retry']
];

test('Phase 3B-3 machine-readable matrix exactly covers the 17 canonical architecture cases', () => {
  assert.equal(assertMatrixIntegrity(), true);
  assert.equal(scenarios.length, 17);
  assert.deepEqual(scenarios.map(({ name, requiredResult }) => [name, requiredResult]), canonical);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 17);
  assert.deepEqual(scenarios.map((scenario) => scenario.id), canonical.map((_, index) => `ATK-${String(index + 1).padStart(2, '0')}`));
});

test('provider-paused harness cannot claim empirical PAD/face-match execution or PASS', () => {
  const summary = summarizeAttackMatrix();
  const plan = createPlan();
  assert.equal(PROVIDER_RUNTIME_STATE, 'PAUSED');
  assert.equal(PROVIDER_EMPIRICAL_STATUS, 'NOT_EXECUTED_PROVIDER_PAUSED');
  assert.equal(summary.totalScenarios, 17);
  assert.equal(summary.empiricalProviderCases, 8);
  assert.equal(summary.empiricalExecuted, 0);
  assert.equal(summary.empiricalPassed, 0);
  assert.equal(summary.status, 'ARCHITECTURE_READY_PROVIDER_EXECUTION_NOT_STARTED');
  assert.equal(plan.rules.providerCallsAllowed, false);
  assert.equal(plan.rules.biometricRuntimeMayBeEnabled, false);
  assert.equal(plan.rules.productionMutationAllowed, false);
  assert.equal(plan.rules.unexecutedEmpiricalCaseMayBeReportedAsPass, false);
  const empiricalRows = plannedEvidenceRows().filter((row) => row.empiricalProviderRequired);
  assert.equal(empiricalRows.length, 8);
  assert.ok(empiricalRows.every((row) => row.empiricalStatus === 'NOT_EXECUTED_PROVIDER_PAUSED'));
});

test('harness is plan-only and rejects any provider execution mode', () => {
  const script = path.join(root, 'scripts', 'g06', 'phase3b3-attack-harness.js');
  const planned = spawnSync(process.execPath, [script, '--mode=plan'], { encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr);
  const output = JSON.parse(planned.stdout);
  assert.equal(output.summary.providerRuntime, 'PAUSED');
  assert.equal(output.summary.empiricalExecuted, 0);
  assert.equal(output.summary.empiricalPassed, 0);

  const blocked = spawnSync(process.execPath, [script, '--mode=execute-provider'], { encoding: 'utf8' });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /PHASE3B3_PROVIDER_EXECUTION_NOT_AUTHORIZED/);
});

test('every attack row maps to existing backend authority/failure evidence without inventing client PASS', () => {
  const source = [
    read('src/services/face-verification-session.service.js'),
    read('src/services/attendance-verification-context.service.js'),
    read('src/services/attendance-site-evidence.service.js'),
    read('src/services/aws-rekognition-face-verification.provider.js')
  ].join('\n');

  for (const scenario of scenarios) {
    assert.ok(scenario.backendEvidence.length > 0, `${scenario.id} must name backend evidence`);
    for (const evidenceFile of scenario.backendEvidence) {
      const inUnit = path.join(root, 'test', evidenceFile);
      const inIntegration = path.join(root, 'test', 'integration', evidenceFile);
      assert.equal(fs.existsSync(inUnit) || fs.existsSync(inIntegration), true, `${scenario.id} evidence file missing: ${evidenceFile}`);
    }
    for (const code of scenario.acceptedFailureCodes) {
      assert.match(source, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${scenario.id} backend code missing: ${code}`);
    }
  }

  const face = read('src/services/face-verification-session.service.js');
  assert.match(face, /trustedResult\.injectionRiskDetected/);
  assert.match(face, /!trustedResult\.padPassed/);
  assert.match(face, /!trustedResult\.faceMatchPassed/);
  assert.match(face, /receipt:\s*null/);
  assert.doesNotMatch(face, /client.*padPassed|client.*faceMatchPassed/i);
});

test('Phase 3B-3 harness and document retain the trust boundary and do not open runtime', () => {
  const harness = read('scripts/g06/phase3b3-attack-harness.js');
  const matrix = read('scripts/g06/phase3b3-attack-matrix.js');
  const doc = read('docs/G06_PHASE3B3_ATTACK_TEST_ARCHITECTURE.md');
  const routes = fs.readdirSync(path.join(root, 'src', 'routes'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(path.join('src', 'routes', name)))
    .join('\n');

  assert.match(doc, /ARCHITECTURE READY \/ PROVIDER EXECUTION NOT STARTED/);
  assert.match(doc, /NOT_EXECUTED_PROVIDER_PAUSED/);
  assert.match(doc, /Backend contract evidence is not PAD certification/);
  assert.match(doc, /unexecuted empirical case cannot be recorded as PASS/i);
  assert.doesNotMatch(`${harness}\n${matrix}`, /@aws-sdk|CreateFaceLivenessSession|GetFaceLivenessSessionResults|CompareFaces|fetch\(|https?:\/\//i);
  assert.doesNotMatch(`${harness}\n${matrix}`, /imageBytes|videoBytes|embedding|template|faceCollection|camera/i);
  assert.doesNotMatch(routes, /phase3b3-attack|phase3b3|attack-harness/);
});
