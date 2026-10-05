'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Vercel exposes one API function entry point and no explicit Human/TFJS payload', () => {
  const vercelConfig = JSON.parse(read('vercel.json'));
  assert.equal(fs.existsSync(path.join(root, 'api/index.js')), false);
  assert.deepEqual(Object.keys(vercelConfig.functions || {}), ['api/[...path].js']);
  assert.equal(vercelConfig.functions['api/[...path].js'].maxDuration, 60);
  assert.equal(vercelConfig.functions['api/[...path].js'].includeFiles, undefined);
  assert.equal(vercelConfig.env?.FACE_VERIFICATION_IN_PROCESS_ENABLED, undefined);
  assert.doesNotMatch(JSON.stringify(vercelConfig), /@vladmandic\/human|tfjs|human\.node-wasm/i);
});

test('deployed route graph does not import the in-process face engine', () => {
  const runtimeSources = [
    read('src/routes/attendance.routes.js'),
    read('src/routes/employee-reference-photo.routes.js'),
    read('src/services/attendance-face-verification.service.js')
  ].join('\n');
  assert.doesNotMatch(runtimeSources, /in-process-face-match\.provider|face-verification-in-process\.service|attendance-face-engine-uat\.service/);
  assert.doesNotMatch(runtimeSources, /createInProcessFaceMatchProvider|createInProcessFaceVerificationService|createAttendanceFaceEngineUatService/);
});
