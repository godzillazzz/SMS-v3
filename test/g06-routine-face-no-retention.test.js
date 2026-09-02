'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('routine Attendance face verification never retains live or challenge images', () => {
  const inProcess = source('src/services/face-verification-in-process.service.js');
  const selfHosted = source('src/services/face-verification-self-hosted.service.js');
  const adapter = source('src/services/attendance-face-verification.service.js');
  const routes = source('src/routes/attendance.routes.js');

  for (const implementation of [inProcess, selfHosted]) {
    assert.doesNotMatch(implementation, /createSupabaseAttendanceFaceEvidenceStorage/);
    assert.doesNotMatch(implementation, /attendanceEvidenceStorage/);
    assert.doesNotMatch(implementation, /ATTENDANCE_EVIDENCE_STORAGE_REQUIRED/);
    assert.match(implementation, /evidence:\s*safeEvidenceResult\(null\)/);
    assert.match(implementation, /livePhotoFile\.buffer\.fill\(0\)/);
    assert.match(implementation, /for \(const frame of challengeFrameBytes\).*frame\.fill\(0\)/);
  }

  assert.doesNotMatch(adapter, /createSupabaseAttendanceFaceEvidenceStorage/);
  assert.doesNotMatch(adapter, /evidenceStorage/);
  assert.doesNotMatch(routes, /createAttendanceFaceVerificationService\(\{ environment, evidenceStorage:/);
});

test('legacy AttendanceEvidence administration remains separate from routine verification', () => {
  const routes = source('src/routes/attendance.routes.js');
  assert.match(routes, /createSupabaseAttendanceFaceEvidenceStorage/);
  assert.match(routes, /\/evidence\/:id\/view/);
  assert.match(routes, /\/evidence\/purge-expired/);
});