'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('all current approval domains preserve authoritative approver identity and expose a human-name path', () => {
  const leaveRoute = read('src/routes/operations.routes.js');
  const userAccess = read('src/services/user-access.service.js');
  const registration = read('src/services/registration-request.service.js');
  const device = read('src/services/attendance-device.service.js');
  const referencePhoto = read('src/services/employee-reference-photo.service.js');
  const license = read('src/services/license-document.service.js');
  const employeeChange = read('src/services/employee-change-request.service.js');
  const adjustment = read('src/services/attendance-adjustment.service.js');

  assert.match(leaveRoute, /approvedByDisplayName: approver\?\.displayName/);
  assert.match(leaveRoute, /approvalWithIdentity/);
  assert.match(userAccess, /approvedByLegacyRef: actorUserId/);
  assert.match(registration, /approvedByLegacyRef: actorUserId/);
  assert.match(registration, /reviewedBy: \{ select: \{ id: true, displayName: true, role: true \} \}/);
  assert.match(device, /approvedBy: safeRequester\(row\.approvedBy\)/);
  assert.match(device, /reviewedBy: safeRequester\(row\.reviewedBy\)/);
  assert.match(referencePhoto, /reviewedBy: safeUser\(row\.reviewedBy\)/);
  assert.match(license, /reviewedBy: \{ select: \{ id: true, displayName: true \} \}/);
  assert.match(employeeChange, /events: \{ include: \{ actor: \{ select: \{ id: true, displayName: true, role: true \} \}/);
  assert.match(adjustment, /approverDisplayName/);
});