'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'face-verification.routes.js'), 'utf8');
const poc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'face-verification-poc.service.js'), 'utf8');
const architecture = fs.readFileSync(path.join(__dirname, '..', 'docs', 'G06_FACE_VERIFICATION_LIVENESS_V1_PHASE3B_ARCHITECTURE.md'), 'utf8');

test('client provider-result contract accepts only an opaque provider session reference', () => {
  const schema = route.match(/const providerResultInput = z\.object\(\{([^}]*)\}\)\.strict\(\);/s);
  assert.ok(schema, 'providerResultInput schema must remain explicit and strict');
  assert.match(schema[1], /providerSessionId/);
  assert.doesNotMatch(schema[1], /padPassed|livenessPassed|faceMatchPassed|activeChallengePassed|confidence|similarity|score|embedding/i);
  assert.doesNotMatch(route, /recordTrustedProviderResult\s*\(/, 'public route must not directly mint a trusted biometric result');
});

test('trusted biometric result is derived server-side from provider evaluation', () => {
  assert.match(poc, /await provider\.evaluate\(/);
  assert.match(poc, /sessionService\.recordTrustedProviderResult\(\{/);
  assert.match(poc, /padPassed:\s*evaluation\.padPassed/);
  assert.match(poc, /faceMatchPassed:\s*evaluation\.faceMatchPassed/);
  assert.match(poc, /injectionRiskDetected:\s*evaluation\.injectionRiskDetected/);
});

test('backend source contains no browser-local authoritative face provider path', () => {
  const srcRoot = path.join(__dirname, '..', 'src');
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.isFile() && /\.js$/.test(entry.name)) files.push(full); } };
  walk(srcRoot);
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /LOCAL_BROWSER_V1|LOCAL_LIVENESS|\/local-result|client[-_ ]?supplied.*(?:liveness|face).*result/i);
});

test('architecture keeps browser/client biometric booleans non-authoritative', () => {
  assert.match(architecture, /Do not trust client biometric booleans/i);
  assert.match(architecture, /No custom JavaScript ML model running entirely in the browser is accepted as the authoritative PAD engine for V1/i);
  assert.match(architecture, /does not by itself prove hardware-backed key storage, device integrity or genuine camera-pipeline integrity/i);
});
