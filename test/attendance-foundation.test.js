const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildExpectationSnapshot, createAttendanceFoundationService } = require('../src/services/attendance-foundation.service');
const { assertIdempotentEvidence, calculateRetentionUntil } = require('../src/services/attendance-evidence-provider');
const { ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS, validateAttendanceSystemSetting } = require('../src/services/attendance-policy.service');
const { createSecuritySiteService } = require('../src/services/security-site.service');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'prisma/migrations/202608200001_g06_attendance_foundation/migration.sql'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/attendance-foundation.routes.js'), 'utf8');

function eventHarness(existing = null) {
  const events = existing ? [existing] : [];
  const audits = [];
  const tx = {
    attendanceEvent: {
      findUnique: async ({ where }) => events.find((event) => event.captureId === where.captureId) || null,
      create: async ({ data }) => { const event = { id: `event-${events.length + 1}`, ...data }; events.push(event); return event; }
    },
    attendanceCorrection: { create: async ({ data }) => ({ id: 'correction-1', ...data }) },
    attendanceBusinessFlagRecord: { create: async ({ data }) => ({ id: 'flag-1', ...data }) }
  };
  const service = createAttendanceFoundationService({ prismaClient: { $transaction: async (work) => work(tx) }, auditService: { log: async (entry) => audits.push(entry) }, clock: () => new Date('2026-08-20T02:00:00.000Z') });
  return { service, events, audits };
}

function validatedOfflineDecision(overrides = {}) {
  return {
    decision: 'SERVER_VALIDATED',
    effectiveEventAt: '2026-08-20T01:05:00.000Z',
    timeBasis: 'DEVICE_CAPTURED',
    ...overrides
  };
}

test('Security Site, optional schedule Site/Duty, and active shift-template fields are additive', () => {
  assert.match(schema, /model SecuritySite \{/);
  assert.match(schema, /model SecuritySiteDepartment \{/);
  assert.match(schema, /model Duty \{/);
  assert.match(schema, /securitySiteId\s+String\?/);
  assert.match(schema, /dutyId\s+String\?/);
  assert.match(schema, /isOvernight\s+Boolean/);
  assert.match(routes, /router\.post\('\/sites', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.put\('\/sites\/:id', authorize\('ADMIN'\)/);
  assert.doesNotMatch(routes, /CHECK_IN|CHECK_OUT|camera|geolocation/i);
});

test('Security Site foundation lists active sites by default and audits Admin create/deactivation', async () => {
  const created = [];
  const audits = [];
  let storedSite = null;
  const client = {
    securitySite: {
      findMany: async ({ where }) => { assert.deepEqual(where, { isActive: true }); return [{ id: 'site-1', code: 'A', isActive: true }]; },
      findUnique: async () => null,
      create: async ({ data }) => { created.push(data); storedSite = { id: 'site-1', ...data, departmentLinks: [] }; return storedSite; },
      update: async ({ data }) => ({ id: 'site-1', code: 'A', name: 'A', latitude: 1, longitude: 1, geofenceRadiusMeters: 50, isActive: data.isActive, departmentLinks: [] })
    },
    $transaction: async (work) => work({ securitySite: { findUnique: async () => storedSite, create: client.securitySite.create, update: client.securitySite.update } })
  };
  const service = createSecuritySiteService({ prismaClient: client, auditService: { log: async (entry) => audits.push(entry) } });
  assert.equal((await service.list()).length, 1);
  await service.create({ code: 'A', name: 'A', latitude: 1, longitude: 1, geofenceRadiusMeters: 50 }, 'admin-1');
  await service.update('site-1', { isActive: false }, 'admin-1');
  assert.equal(created.length, 1);
  assert.deepEqual(audits.map((entry) => entry.action), ['CREATE', 'UPDATE']);
});

test('overnight shift expectation belongs to the start workDate and remains immutable after master changes', () => {
  const assignment = { id: 'assignment-1', shiftTypeId: 'shift-1', workDate: new Date('2026-08-20T00:00:00.000Z'), startTime: '19:00', endTime: '07:00', securitySiteId: 'site-1', dutyId: null };
  const shift = { id: 'shift-1', code: 'NIGHT', name: 'Night', isOvernight: false };
  const site = { id: 'site-1', code: 'SITE-A', name: 'Site A', latitude: { toString: () => '13.7563000' }, longitude: { toString: () => '100.5018000' }, geofenceRadiusMeters: 100 };
  const snapshot = buildExpectationSnapshot({ shiftAssignment: assignment, shiftType: shift, securitySite: site });
  assert.equal(snapshot.workDate, '2026-08-20');
  assert.equal(snapshot.expectedStartAt, '2026-08-20T19:00:00.000Z');
  assert.equal(snapshot.expectedEndAt, '2026-08-21T07:00:00.000Z');
  site.geofenceRadiusMeters = 200;
  shift.name = 'Changed master value';
  assert.equal(snapshot.expectedGeofenceRadiusMeters, 100);
  assert.equal(snapshot.expectedShiftName, 'Night');
});

test('online events use only the server receipt time as their effective time', async () => {
  const harness = eventHarness();
  const { event } = await harness.service.recordEvent({ sessionId: 'session-1', captureId: 'capture-online', eventType: 'CHECK_IN', provenance: 'ONLINE', capturedAt: '2026-08-20T01:00:00.000Z' });
  assert.equal(event.capturedAt.toISOString(), '2026-08-20T01:00:00.000Z');
  assert.equal(event.receivedAt.toISOString(), '2026-08-20T02:00:00.000Z');
  assert.equal(event.effectiveEventAt.toISOString(), '2026-08-20T02:00:00.000Z');
  assert.equal(event.timeBasis, 'SERVER_RECEIVED');
});

test('offline events require a server validation decision before creation', async () => {
  const harness = eventHarness();
  await assert.rejects(
    () => harness.service.recordEvent({ sessionId: 'session-1', captureId: 'capture-offline-missing', eventType: 'CHECK_IN', provenance: 'OFFLINE', capturedAt: '2026-08-20T01:00:00.000Z' }),
    (error) => error.statusCode === 400 && error.details.code === 'ATTENDANCE_OFFLINE_VALIDATION_REQUIRED'
  );
  assert.equal(harness.events.length, 0);
});

test('offline events preserve evidence times and use only server-approved effective time', async () => {
  const harness = eventHarness();
  const { event } = await harness.service.recordEvent({ sessionId: 'session-1', captureId: 'capture-offline-validated', eventType: 'CHECK_IN', provenance: 'OFFLINE', capturedAt: '2026-08-20T01:00:00.000Z', offlineValidation: validatedOfflineDecision() });
  assert.equal(event.capturedAt.toISOString(), '2026-08-20T01:00:00.000Z');
  assert.equal(event.receivedAt.toISOString(), '2026-08-20T02:00:00.000Z');
  assert.equal(event.effectiveEventAt.toISOString(), '2026-08-20T01:05:00.000Z');
  assert.equal(event.timeBasis, 'DEVICE_CAPTURED');
});

test('captureId is idempotent only for the same immutable core identity', async () => {
  const harness = eventHarness();
  const first = await harness.service.recordEvent({ sessionId: 'session-1', captureId: 'capture-1', eventType: 'CHECK_IN', provenance: 'ONLINE', capturedAt: '2026-08-20T01:00:00.000Z' });
  const duplicate = await harness.service.recordEvent({ sessionId: 'session-1', captureId: 'capture-1', eventType: 'CHECK_IN', provenance: 'ONLINE', capturedAt: '2026-08-20T01:00:00.000Z' });
  assert.equal(first.idempotent, false);
  assert.equal(duplicate.idempotent, true);
  assert.equal(harness.events.length, 1);
  for (const conflictingEvent of [
    { sessionId: 'session-1', eventType: 'CHECK_IN', provenance: 'ONLINE', capturedAt: '2026-08-20T01:01:00.000Z' },
    { sessionId: 'session-2', eventType: 'CHECK_IN', provenance: 'ONLINE', capturedAt: '2026-08-20T01:00:00.000Z' },
    { sessionId: 'session-1', eventType: 'CHECK_OUT', provenance: 'ONLINE', capturedAt: '2026-08-20T01:00:00.000Z' },
    { sessionId: 'session-1', eventType: 'CHECK_IN', provenance: 'OFFLINE', capturedAt: '2026-08-20T01:00:00.000Z', offlineValidation: validatedOfflineDecision() }
  ]) {
    await assert.rejects(
      () => harness.service.recordEvent({ ...conflictingEvent, captureId: 'capture-1' }),
      (error) => error.statusCode === 409 && error.details.code === 'ATTENDANCE_CAPTURE_ID_CONFLICT'
    );
  }
  assert.equal(harness.events.length, 1);
});

test('corrections are append-only, require Manager/Admin actor and always flag the session as corrected', async () => {
  const harness = eventHarness();
  await assert.rejects(() => harness.service.appendCorrection({ sessionId: 'session-1', correctionType: 'TIME', correctedValue: { at: '2026-08-20T01:00:00Z' }, reason: 'reason', actorUserId: 'user-1', actorRole: 'VIEWER' }), (error) => error.statusCode === 403);
  await assert.rejects(() => harness.service.appendCorrection({ sessionId: 'session-1', correctionType: 'TIME', correctedValue: {}, reason: '', actorUserId: 'user-1', actorRole: 'MANAGER' }), (error) => error.details.code === 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
  const correction = await harness.service.appendCorrection({ sessionId: 'session-1', correctionType: 'TIME', previousValue: { at: 'old' }, correctedValue: { at: 'new' }, reason: 'Approved correction', actorUserId: 'user-1', actorRole: 'MANAGER' });
  assert.equal(correction.actorRole, 'MANAGER');
  assert.equal(harness.audits[0].entityType, 'AttendanceCorrection');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/services/attendance-foundation.service.js'), 'utf8'), /attendanceEvent\.update|attendanceEvent\.delete/);
});

test('evidence retention is rolling one year and integrity conflicts do not overwrite evidence', () => {
  assert.equal(calculateRetentionUntil('2026-08-20T06:55:00.000Z').toISOString(), '2027-08-20T06:55:00.000Z');
  assert.equal(assertIdempotentEvidence({ objectReference: 'attendance/a', checksum: 'a'.repeat(64) }, { objectReference: 'attendance/a', checksum: 'a'.repeat(64) }).idempotent, true);
  assert.throws(() => assertIdempotentEvidence({ objectReference: 'attendance/a', checksum: 'a'.repeat(64) }, { objectReference: 'attendance/a', checksum: 'b'.repeat(64) }), (error) => error.details.code === 'EVIDENCE_INTEGRITY_CONFLICT');
  const evidenceModel = schema.match(/model AttendanceEvidence \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(evidenceModel, /\bBytes\b/);
});

test('offline policy values are configurable but bounded and business/risk states remain separate', () => {
  assert.equal(validateAttendanceSystemSetting(ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, '1440'), '1440');
  assert.equal(validateAttendanceSystemSetting(ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS, '7'), '7');
  assert.throws(() => validateAttendanceSystemSetting(ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, '10081'), /between/);
  assert.match(schema, /enum AttendanceRiskCode/);
  assert.match(schema, /enum AttendanceBusinessFlag/);
  assert.match(schema, /model AttendanceRiskReview/);
  assert.match(schema, /model AttendanceBusinessFlagRecord/);
  assert.match(schema, /@@unique\(\[sessionId, flag\]\)/);
});

test('month certification foundation locks revisions only after risk review resolution and migration is non-destructive', () => {
  assert.match(fs.readFileSync(path.join(root, 'src/services/attendance-foundation.service.js'), 'utf8'), /ATTENDANCE_CERTIFICATION_REVIEW_REQUIRED/);
  assert.match(schema, /@@unique\(\[month, revision\]\)/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bTRUNCATE\b|ALTER\s+TYPE[\s\S]*RENAME/i);
  assert.doesNotMatch(migration, /employee_license_documents|DELETE\s+FROM/i);
});
