'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  canonicalJson,
  signedEventPayload,
  createAttendanceSimpleService
} = require('../src/services/attendance-simple.service');
const { createAttendanceSiteEvidenceService } = require('../src/services/attendance-site-evidence.service');
const { DEFAULT_ATTENDANCE_TIME_POLICY } = require('../src/services/attendance-time-policy.contract');

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  employee: '22222222-2222-4222-8222-222222222222',
  assignment: '33333333-3333-4333-8333-333333333333',
  shift: '44444444-4444-4444-8444-444444444444',
  siteA: '55555555-5555-4555-8555-555555555555',
  siteB: '66666666-6666-4666-8666-666666666666',
  admin: '77777777-7777-4777-8777-777777777777'
};
const now = new Date('2026-10-02T01:00:00.000Z'); // 08:00 Asia/Bangkok
const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 5 * 60 * 1000, offlineBundleTtlMs: 24 * 60 * 60 * 1000 };

function site({ id, code, name, latitude, longitude, radius = 100, active = true }) {
  return { id, code, name, latitude, longitude, geofenceRadiusMeters: radius, isActive: active };
}

function harness({ sites = null, activePrimary = null, timePolicyValues = null } = {}) {
  const state = {
    now: new Date(now),
    sites: sites || [
      site({ id: ids.siteA, code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701 }),
      site({ id: ids.siteB, code: 'B', name: 'Site B', latitude: 13.7251, longitude: 100.5701, radius: 120 })
    ],
    activePrimary,
    devices: [],
    session: null,
    events: new Map(),
    pending: new Map(),
    audits: [],
    timePolicyResolutions: []
  };
  const employee = { id: ids.employee, employeeCode: 'UAT-TEST', displayName: 'Attendance Test', firstName: 'Attendance', lastName: 'Test', department: 'SECURITY', isActive: true, deletedAt: null };
  const assignment = {
    id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shift, securitySiteId: ids.siteA,
    workDate: new Date('2026-10-02T00:00:00.000Z'), startTime: '07:00', endTime: '19:00',
    shiftType: { id: ids.shift, code: 'D', name: 'Day', startTime: '07:00', endTime: '19:00' },
    securitySite: state.sites.find((row) => row.id === ids.siteA), employee
  };
  const prisma = {
    user: { findUnique: async () => ({ id: ids.user, employeeId: ids.employee, isActive: true, accountStatus: 'ACTIVE', employee }) },
    shiftAssignment: {
      findMany: async () => [assignment],
      findUnique: async ({ where }) => where.id === ids.assignment ? assignment : null
    },
    scheduleApproval: { findFirst: async () => ({ id: ids.admin, revision: 1, status: 'APPROVED' }) },
    securitySite: {
      findUnique: async ({ where }) => state.sites.find((row) => row.id === where.id) || null,
      findMany: async () => state.sites.filter((row) => row.isActive === true)
    },
    attendanceSession: {
      findUnique: async () => state.session ? { ...state.session, events: [...state.events.values()].filter((event) => event.sessionId === state.session.id) } : null,
      create: async ({ data }) => { state.session = { id: crypto.randomUUID(), ...data, events: [] }; return state.session; },
      update: async ({ data }) => { state.session = { ...state.session, ...data }; return state.session; }
    },
    attendanceEvent: {
      findUnique: async ({ where }) => {
        if (where.captureId) return state.events.get(where.captureId) || null;
        if (where.sessionId_eventType) return [...state.events.values()].find((row) => row.sessionId === where.sessionId_eventType.sessionId && row.eventType === where.sessionId_eventType.eventType) || null;
        return null;
      },
      create: async ({ data }) => { const row = { id: crypto.randomUUID(), ...data }; state.events.set(row.captureId, row); return row; }
    },
    attendancePendingEvent: {
      findUnique: async ({ where }) => where.captureId ? state.pending.get(where.captureId) || null : [...state.pending.values()].find((row) => row.id === where.id) || null,
      create: async ({ data }) => { const row = { id: crypto.randomUUID(), ...data }; state.pending.set(row.captureId, row); return row; },
      update: async ({ where, data }) => {
        const row = [...state.pending.values()].find((item) => item.id === where.id);
        const updated = { ...row, ...data };
        state.pending.set(row.captureId, updated);
        return updated;
      }
    },
    attendanceDeviceEnrollment: {
      findUnique: async ({ where }) => state.devices.find((row) => row.credentialFingerprint === where.credentialFingerprint) || null,
      findFirst: async () => state.devices.find((row) => row.status === 'ACTIVE') || null,
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), ...data };
        state.devices.push(row);
        return row;
      }
    },
    $transaction: async (callback) => callback(prisma)
  };
  const audit = { log: async (entry) => { state.audits.push(entry); } };
  const siteAuthorityService = { resolve: async () => ({ site: state.sites.find((row) => row.id === ids.siteA), source: 'ASSIGNMENT' }) };
  const siteEvidenceService = createAttendanceSiteEvidenceService({ prisma, clock: () => state.now, policyOverride: policy });
  const timePolicyService = timePolicyValues ? {
    resolveForAssignment: async ({ assignment: target, at }) => {
      state.timePolicyResolutions.push({ assignmentId: target.id, at: new Date(at) });
      return { values: timePolicyValues, source: { policyId: 'time-policy-test', scopeType: 'SHIFT_TYPE', scopeId: ids.shift, effectiveFrom: new Date('2026-10-01T00:00:00.000Z') } };
    }
  } : undefined;
  const service = createAttendanceSimpleService({ prisma, audit, clock: () => state.now, siteAuthorityService, siteEvidenceService,
    policyService: { getPolicy: async () => policy }, timePolicyService, bundleSecret: () => 'test-only-offline-signing-secret-at-least-32-bytes' });
  return { state, prisma, service, assignment };
}

function keyMaterial() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpkiBase64 = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { pair, publicKeySpkiBase64 };
}

function signedInput({ pair, publicKeySpkiBase64, location, offlineBundle = null, captureId = crypto.randomUUID(), capturedAt = now, eventIntent = 'CHECK_IN', claimedActualSiteId = undefined }) {
  const input = {
    captureId, eventIntent, shiftAssignmentId: ids.assignment, capturedAt: capturedAt.toISOString(),
    location: { ...location, capturedAt: location.capturedAt || capturedAt.toISOString() },
    device: {
      publicKeySpkiBase64, keyAlgorithm: 'ECDSA_P256_SHA256', displayName: 'Test device',
      signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true }, signatureBase64: ''
    },
    offlineBundle
  };
  if (claimedActualSiteId !== undefined) input.actualSiteId = claimedActualSiteId;
  const signature = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input)), 'utf8'), {
    key: pair.privateKey, dsaEncoding: 'ieee-p1363'
  });
  input.device.signatureBase64 = signature.toString('base64');
  return input;
}

const locA = () => ({ latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: now.toISOString() });
const locB = () => ({ latitude: 13.7251, longitude: 100.5701, accuracyMeters: 8, capturedAt: now.toISOString() });

test('online support Site keeps assigned Site, derives actual Site, emits context and audit', async () => {
  const h = harness();
  const { pair, publicKeySpkiBase64 } = keyMaterial();
  const input = signedInput({ pair, publicKeySpkiBase64, location: locB() });
  const result = await h.service.submit({ actor: { sub: ids.user, role: 'VIEWER' }, input });
  assert.equal(result.counted, true);
  assert.equal(result.event.locationEvidence.expectedSiteId, ids.siteA);
  assert.equal(result.event.locationEvidence.actualSiteId, ids.siteB);
  assert.equal(result.event.locationEvidence.workSiteContext, 'SUPPORT_SITE');
  assert.equal(result.event.punctuality, 'LATE');
  assert.equal(result.event.checkoutCondition, null);
  assert.equal(result.event.locationEvidence.assignedSite.code, 'A');
  assert.equal(result.event.locationEvidence.actualSite.code, 'B');
  assert.equal(result.session.expectedSiteId, ids.siteA);
  assert.deepEqual(result.event.reviewReasons, ['ASSIST_OTHER_SITE']);
  assert.equal(h.state.audits.some((row) => row.entityType === 'AttendanceEvent' && row.metadata.workSiteContext === 'SUPPORT_SITE' && row.metadata.assignedSiteId === ids.siteA && row.metadata.actualSiteId === ids.siteB), true);
});

test('outside every active Site and inactive support Site fail closed before Attendance mutation', async () => {
  const outside = harness();
  const key1 = keyMaterial();
  await assert.rejects(() => outside.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...key1, location: { latitude: 13.73, longitude: 100.57, accuracyMeters: 8, capturedAt: now.toISOString() } }) }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE');
  assert.equal(outside.state.events.size, 0);

  const inactive = harness({ sites: [
    site({ id: ids.siteA, code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701 }),
    site({ id: ids.siteB, code: 'B', name: 'Site B', latitude: 13.7251, longitude: 100.5701, radius: 120, active: false })
  ] });
  const key2 = keyMaterial();
  await assert.rejects(() => inactive.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...key2, location: locB() }) }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE');
  assert.equal(inactive.state.events.size, 0);
});

test('signed offline bootstrap authorizes only its active Site snapshot and server derives support Site', async () => {
  const h = harness();
  const bootstrap = await h.service.bootstrap({ actor: { sub: ids.user } });
  assert.deepEqual(bootstrap.eligibleSites.map((row) => row.id), [ids.siteA, ids.siteB]);
  const bundle = h.service.verifyBundle(bootstrap.offline.bundle);
  assert.equal(bundle.version, 'SMS_ATTENDANCE_OFFLINE_BUNDLE_V2');
  assert.deepEqual(bundle.eligibleSites.map((row) => row.id), [ids.siteA, ids.siteB]);
  const { pair, publicKeySpkiBase64 } = keyMaterial();
  const input = signedInput({ pair, publicKeySpkiBase64, location: locB(), offlineBundle: bootstrap.offline.bundle, claimedActualSiteId: ids.siteA });
  const result = await h.service.submit({ actor: { sub: ids.user, role: 'VIEWER' }, input });
  assert.equal(result.event.locationEvidence.actualSiteId, ids.siteB);
  assert.equal(result.event.locationEvidence.workSiteContext, 'SUPPORT_SITE');
  assert.equal(result.event.locationEvidence.expectedSiteId, ids.siteA);
});

test('offline support Site fails closed when its registered geofence changes before sync', async () => {
  const h = harness();
  const bootstrap = await h.service.bootstrap({ actor: { sub: ids.user } });
  h.state.sites.find((row) => row.id === ids.siteB).geofenceRadiusMeters = 121;
  const key = keyMaterial();
  const input = signedInput({ ...key, location: locB(), offlineBundle: bootstrap.offline.bundle });
  await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input }),
    (error) => error.details?.code === 'ATTENDANCE_OFFLINE_SITE_AUTHORITY_CHANGED');
  assert.equal(h.state.events.size, 0);
});

test('delayed offline support attendance stays uncounted until ADMIN confirms and preserves both Site and device flags', async () => {
  const h = harness({ activePrimary: { id: crypto.randomUUID(), employeeId: ids.employee, status: 'ACTIVE', credentialFingerprint: 'different-primary' } });
  h.state.devices.push(h.state.activePrimary);
  const bootstrap = await h.service.bootstrap({ actor: { sub: ids.user } });
  const { pair, publicKeySpkiBase64 } = keyMaterial();
  const capturedAt = new Date(now.getTime() + 60 * 1000);
  h.state.now = new Date(now.getTime() + 30 * 60 * 1000);
  const input = signedInput({ pair, publicKeySpkiBase64, location: { ...locB(), capturedAt: capturedAt.toISOString() }, capturedAt, offlineBundle: bootstrap.offline.bundle });
  const pending = await h.service.submit({ actor: { sub: ids.user, role: 'VIEWER' }, input });
  assert.equal(pending.counted, false);
  assert.equal(pending.status, 'PENDING_CONFIRMATION');
  assert.equal(pending.pendingEvent.locationEvidence.workSiteContext, 'SUPPORT_SITE');
  assert.equal(pending.pendingEvent.timePolicySnapshot.values.lateGraceMinutes, 0);
  assert.equal(h.state.events.size, 0);
  const confirmed = await h.service.reviewPending({ actor: { sub: ids.admin, role: 'ADMIN' }, pendingId: pending.pendingEvent.id, action: 'CONFIRM', comment: 'Reviewed test record' });
  assert.equal(confirmed.counted, true);
  assert.equal(confirmed.event.locationEvidence.expectedSiteId, ids.siteA);
  assert.equal(confirmed.event.locationEvidence.actualSiteId, ids.siteB);
  assert.equal(confirmed.event.locationEvidence.workSiteContext, 'SUPPORT_SITE');
  assert.equal(confirmed.event.punctuality, 'LATE');
  assert.equal(confirmed.event.reviewRequired, true);
  assert.ok(confirmed.event.reviewReasons.includes('DEVICE_MISMATCH'));
  assert.ok(confirmed.event.reviewReasons.includes('ASSIST_OTHER_SITE'));
  assert.equal(h.state.events.size, 1);
});

test('support Site duplicate capture is idempotent and poor/stale GPS remains blocked', async () => {
  const h = harness();
  const key = keyMaterial();
  const input = signedInput({ ...key, location: locB() });
  const first = await h.service.submit({ actor: { sub: ids.user, role: 'VIEWER' }, input });
  const retry = await h.service.submit({ actor: { sub: ids.user, role: 'VIEWER' }, input });
  assert.equal(first.counted, true);
  assert.equal(retry.idempotent, true);
  assert.equal(h.state.events.size, 1);

  const poor = harness();
  const poorKey = keyMaterial();
  await assert.rejects(() => poor.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...poorKey, location: { ...locB(), accuracyMeters: 51 } }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT');
  const stale = harness();
  const staleKey = keyMaterial();
  const old = new Date(now.getTime() - 4 * 60 * 1000);
  await assert.rejects(() => stale.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...staleKey, location: { ...locB(), capturedAt: old.toISOString() } }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_STALE');
});

test('an explicitly enabled latest CHECK_IN policy blocks before session or Attendance mutation', async () => {
  const h = harness({ timePolicyValues: { ...DEFAULT_ATTENDANCE_TIME_POLICY, latestCheckInEnabled: true, latestCheckInMinutesAfterStart: 30 } });
  const key = keyMaterial();
  await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...key, location: locA() }) }),
    (error) => error.details?.code === 'ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED');
  assert.equal(h.state.events.size, 0);
  assert.equal(h.state.session, null);
  assert.equal(h.state.devices.length, 0);
});

test('delayed offline CHECK_IN uses signed capture time for lateness and confirms without counting early', async () => {
  const h = harness({ timePolicyValues: DEFAULT_ATTENDANCE_TIME_POLICY });
  h.state.now = new Date('2026-10-02T00:00:00.000Z'); // 07:00 Asia/Bangkok: issue bundle
  const bootstrap = await h.service.bootstrap({ actor: { sub: ids.user } });
  const capturedAt = new Date('2026-10-02T00:15:00.000Z'); // 07:15 Asia/Bangkok
  h.state.now = new Date('2026-10-02T01:20:00.000Z'); // 08:20 Asia/Bangkok: delayed sync
  const key = keyMaterial();
  const input = signedInput({ ...key, capturedAt, offlineBundle: bootstrap.offline.bundle,
    location: { ...locB(), capturedAt: capturedAt.toISOString() } });
  const pending = await h.service.submit({ actor: { sub: ids.user }, input });
  assert.equal(pending.status, 'PENDING_CONFIRMATION');
  assert.equal(pending.counted, false);
  assert.equal(h.state.events.size, 0);
  assert.equal(h.state.timePolicyResolutions.length, 1);
  assert.equal(h.state.timePolicyResolutions[0].at.toISOString(), capturedAt.toISOString());
  assert.equal(pending.pendingEvent.timePolicySnapshot.values.lateGraceMinutes, 0);
  const confirmed = await h.service.reviewPending({ actor: { sub: ids.admin, role: 'ADMIN' }, pendingId: pending.pendingEvent.id, action: 'CONFIRM', comment: 'Reviewed delayed time-policy test' });
  assert.equal(confirmed.counted, true);
  assert.equal(confirmed.event.effectiveEventAt.toISOString(), capturedAt.toISOString());
  assert.equal(confirmed.event.punctuality, 'LATE');
  assert.equal(h.state.events.size, 1);
});

test('SUPPORT_SITE, DEVICE_MISMATCH and LATE survive together', async () => {
  const h = harness({ activePrimary: { id: crypto.randomUUID(), employeeId: ids.employee, status: 'ACTIVE', credentialFingerprint: 'different-primary' } });
  h.state.devices.push(h.state.activePrimary);
  const key = keyMaterial();
  const result = await h.service.submit({ actor: { sub: ids.user }, input: signedInput({ ...key, location: locB() }) });
  assert.equal(result.counted, true);
  assert.equal(result.event.locationEvidence.workSiteContext, 'SUPPORT_SITE');
  assert.equal(result.event.punctuality, 'LATE');
  assert.equal(result.event.reviewRequired, true);
  assert.ok(result.event.reviewReasons.includes('ASSIST_OTHER_SITE'));
  assert.ok(result.event.reviewReasons.includes('DEVICE_MISMATCH'));
});
