'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Documentation contract: the threat model must describe runtime behaviour, not intentions.
// These assertions exist because the model previously overstated what the controls do, which made
// the risk look smaller than it is (SENTINEL findings F002, F003, R3-F008).
const DOC = path.join(__dirname, '..', 'docs', 'G06_1_PHASE0_THREAT_MODEL.md');
const text = fs.readFileSync(DOC, 'utf8');

test('records the owner decision for second-device attendance', () => {
  assert.match(text, /## 2b\. Owner decision on second-device attendance/);
  assert.match(text, /selfie is mandatory/i);
  assert.match(text, /flag(ged)?/i);
  assert.match(text, /ADMIN approval/i);
  assert.match(text, /first device is revoked/i);
  assert.match(text, /No biometric matching/i);
});

test('says device mismatch detects and flags rather than blocks', () => {
  assert.match(text, /detects and flags|detect rather than block|detects rather than blocks/i);
  assert.doesNotMatch(text, /Stops one person clocking in for another/i);
});

test('states that geofence and offline bundle checks reject before an event exists', () => {
  assert.match(text, /ATTENDANCE_OFFLINE_SITE_NOT_AUTHORIZED/);
  assert.match(text, /reject/i);
  assert.match(text, /validateAttendanceTime/);
});

test('does not claim the client clock only affects the printed value', () => {
  assert.doesNotMatch(text, /Client clock only affects the printed value/i);
  assert.match(text, /client-captured time/i);
});

test('does not claim offline tampering is only flagged', () => {
  assert.doesNotMatch(text, /is only flagged, not rejected/i);
});

test('includes the sharing, self-enrolment and collusion threats', () => {
  for (const id of ['G061-11', 'G061-12', 'G061-13']) {
    assert.match(text, new RegExp(id));
  }
});
