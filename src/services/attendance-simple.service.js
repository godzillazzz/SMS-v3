'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { normalizeScheduleTime } = require('../utils/schedule-time');
const { createAttendanceSiteEvidenceService } = require('./attendance-site-evidence.service');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');
const { createAttendancePolicyService } = require('./attendance-policy.service');
const { bangkokParts, isOvernightAssignment, actionableAssignment } = require('./attendance-verification-context.service');

const SIMPLE_EVENT_VERSION = 'SMS_ATTENDANCE_SIMPLE_EVENT_V1';
const OFFLINE_BUNDLE_VERSION = 'SMS_ATTENDANCE_OFFLINE_BUNDLE_V1';
const MOVE_REQUEST_VERSION = 'SMS_ATTENDANCE_DEVICE_MOVE_V1';
const KEY_ALGORITHM = 'ECDSA_P256_SHA256';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function cleanText(value, max = 1000) { const text = String(value ?? '').trim(); return text ? text.slice(0, max) : null; }
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw http(400, 'ATTENDANCE_SIMPLE_PAYLOAD_INVALID', 'Attendance payload contains an invalid number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    return out;
  }
  throw http(400, 'ATTENDANCE_SIMPLE_PAYLOAD_INVALID', 'Attendance payload contains an unsupported value.');
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex'); }
function objectDigest(value) { return sha256(canonicalJson(value)); }
function normalizedUuid(value, code) {
  const text = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(text)) throw http(400, code, 'A valid UUID is required.');
  return text;
}
function workDateText(value) { return new Date(value).toISOString().slice(0, 10); }
function shiftDate(dateText, offsetDays) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
function timeMinutes(value) {
  const normalized = normalizeScheduleTime(value);
  return normalized ? Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(3, 5)) : null;
}
function scheduleMonth(workDate) {
  const text = workDateText(workDate);
  return new Date(`${text.slice(0, 7)}-01T00:00:00.000Z`);
}
function parsePublicKey(device) {
  if (device?.keyAlgorithm !== KEY_ALGORITHM) throw http(400, 'ATTENDANCE_DEVICE_ALGORITHM_UNSUPPORTED', 'Unsupported device key algorithm.');
  let bytes; let key;
  try {
    bytes = Buffer.from(String(device.publicKeySpkiBase64 || ''), 'base64');
    key = crypto.createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  } catch {
    throw http(400, 'ATTENDANCE_DEVICE_PUBLIC_KEY_INVALID', 'Invalid device public key.');
  }
  if (!bytes.length || bytes.length > 4096) throw http(400, 'ATTENDANCE_DEVICE_PUBLIC_KEY_INVALID', 'Invalid device public key.');
  return { bytes, key, fingerprint: sha256(bytes) };
}
function verifySignature(key, payload, signatureBase64) {
  let signature;
  try { signature = Buffer.from(String(signatureBase64 || ''), 'base64'); } catch {}
  if (!signature?.length) throw http(400, 'ATTENDANCE_DEVICE_SIGNATURE_INVALID', 'Device signature is missing.');
  const bytes = Buffer.from(canonicalJson(payload), 'utf8');
  let verified = false;
  try { verified = crypto.verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature); } catch {}
  if (!verified) { try { verified = crypto.verify('sha256', bytes, key, signature); } catch {} }
  if (!verified) throw http(400, 'ATTENDANCE_DEVICE_SIGNATURE_INVALID', 'Device signature could not be verified.');
}
function signedEventPayload(input) {
  const capturedAt = new Date(input.capturedAt);
  const locationAt = new Date(input.location?.capturedAt);
  if (Number.isNaN(capturedAt.getTime()) || Number.isNaN(locationAt.getTime())) throw http(400, 'ATTENDANCE_CAPTURED_AT_INVALID', 'Attendance capture time is invalid.');
  return {
    version: SIMPLE_EVENT_VERSION,
    captureId: normalizedUuid(input.captureId, 'ATTENDANCE_CAPTURE_ID_INVALID'),
    eventIntent: String(input.eventIntent || '').trim().toUpperCase(),
    shiftAssignmentId: normalizedUuid(input.shiftAssignmentId, 'ATTENDANCE_SHIFT_ASSIGNMENT_INVALID'),
    capturedAt: capturedAt.toISOString(),
    location: {
      latitude: Number(input.location?.latitude),
      longitude: Number(input.location?.longitude),
      accuracyMeters: Number(input.location?.accuracyMeters),
      capturedAt: locationAt.toISOString()
    },
    publicKeySpkiBase64: String(input.device?.publicKeySpkiBase64 || ''),
    keyAlgorithm: String(input.device?.keyAlgorithm || ''),
    deviceSignals: input.device?.signals || {},
    offlineBundleHash: input.offlineBundle ? sha256(String(input.offlineBundle)) : null
  };
}
function integrityRiskFlags(signals = {}) {
  const flags = [];
  if (signals.secureContext !== true) flags.push('DEVICE_SECURE_CONTEXT_RISK');
  if (signals.webCrypto !== true) flags.push('DEVICE_WEBCRYPTO_RISK');
  if (signals.indexedDb !== true) flags.push('DEVICE_STORAGE_RISK');
  if (signals.privateKeyNonExportable !== true) flags.push('DEVICE_KEY_EXPORTABILITY_RISK');
  if (signals.automation === true) flags.push('DEVICE_AUTOMATION_RISK');
  for (const warning of Array.isArray(signals.integrityWarnings) ? signals.integrityWarnings.slice(0, 10) : []) {
    const safe = String(warning || '').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80).toUpperCase();
    if (safe) flags.push(`DEVICE_INTEGRITY_${safe}`);
  }
  return [...new Set(flags)];
}

function createAttendanceSimpleService({
  prisma = prismaDefault, audit = auditDefault, clock = () => new Date(),
  siteEvidenceService = null, siteAuthorityService = null, policyService = null,
  bundleSecret = () => process.env.JWT_SECRET
} = {}) {
  const siteEvidence = siteEvidenceService || createAttendanceSiteEvidenceService({ prisma, clock });
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });
  const policies = policyService || createAttendancePolicyService({ prisma });

  async function resolveIdentity(client, actor) {
    const user = await client.user.findUnique({
      where: { id: actor?.sub },
      select: { id: true, employeeId: true, isActive: true, accountStatus: true,
        employee: { select: { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, isActive: true, deletedAt: true } } }
    });
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.isActive || user.accountStatus !== 'ACTIVE' || !user.employee.isActive || user.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot use Attendance.');
    return { userId: user.id, employeeId: user.employee.id, employeeCode: user.employee.employeeCode, employee: user.employee };
  }

  async function resolveCurrentAssignment(client, employeeId, now) {
    const local = bangkokParts(now);
    const yesterday = shiftDate(local.date, -1);
    const rows = await client.shiftAssignment.findMany({
      where: { employeeId, workDate: { in: [new Date(`${yesterday}T00:00:00.000Z`), new Date(`${local.date}T00:00:00.000Z`)] } },
      include: { shiftType: true, securitySite: true }, orderBy: { workDate: 'asc' }
    });
    const byDate = new Map(rows.map((row) => [workDateText(row.workDate), row]));
    const previous = byDate.get(yesterday);
    const today = byDate.get(local.date);
    if (previous && isOvernightAssignment(previous)) {
      const end = timeMinutes(previous.endTime || previous.shiftType?.endTime);
      if (end !== null && local.minutes < end) return previous;
    }
    if (today) return today;
    throw http(409, 'ATTENDANCE_ASSIGNMENT_REQUIRED', 'No authoritative Shift Assignment is available for Attendance.');
  }

  async function loadAssignment(client, identity, id) {
    const assignment = await client.shiftAssignment.findUnique({ where: { id: normalizedUuid(id, 'ATTENDANCE_SHIFT_ASSIGNMENT_INVALID') }, include: { shiftType: true, securitySite: true, employee: true } });
    if (!assignment || assignment.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_ASSIGNMENT_STALE', 'Attendance Shift Assignment is no longer authoritative.');
    if (!actionableAssignment(assignment)) throw http(409, 'ATTENDANCE_SHIFT_NOT_ACTIONABLE', 'The current shift is not eligible for Attendance.');
    return assignment;
  }

  async function approvedSchedule(client, assignment) {
    const approval = await client.scheduleApproval.findFirst({ where: { month: scheduleMonth(assignment.workDate) }, orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }] });
    if (!approval || approval.status !== 'APPROVED') throw http(409, 'ATTENDANCE_SCHEDULE_NOT_APPROVED', 'The monthly schedule is not approved for Attendance.');
    return approval;
  }

  async function eventIntentForAssignment(client, identity, assignment) {
    const session = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id }, include: { events: { select: { eventType: true } } } });
    if (!session) return 'CHECK_IN';
    if (session.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_SESSION_STALE', 'Attendance session identity is stale.');
    const hasIn = session.events.some((row) => row.eventType === 'CHECK_IN');
    const hasOut = session.events.some((row) => row.eventType === 'CHECK_OUT');
    if (hasOut) throw http(409, 'ATTENDANCE_ALREADY_CHECKED_OUT', 'Attendance is already complete for the current shift.');
    return hasIn ? 'CHECK_OUT' : 'CHECK_IN';
  }

  function offlineSecret() {
    let value = '';
    try { value = String(bundleSecret() || ''); } catch {}
    if (value.length < 32) throw http(500, 'ATTENDANCE_OFFLINE_SIGNING_UNAVAILABLE', 'Offline Attendance signing is unavailable.');
    return value;
  }
  function issueBundle(payload) {
    const encoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', offlineSecret()).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }
  function verifyBundle(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw http(400, 'ATTENDANCE_OFFLINE_BUNDLE_INVALID', 'Offline Attendance bundle is invalid.');
    const [encoded, signature] = parts;
    const expected = crypto.createHmac('sha256', offlineSecret()).update(encoded).digest();
    let actual;
    try { actual = Buffer.from(signature, 'base64url'); } catch {}
    if (!actual || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw http(400, 'ATTENDANCE_OFFLINE_BUNDLE_INVALID', 'Offline Attendance bundle signature is invalid.');
    let payload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch {}
    if (!payload || payload.version !== OFFLINE_BUNDLE_VERSION) throw http(400, 'ATTENDANCE_OFFLINE_BUNDLE_INVALID', 'Offline Attendance bundle is invalid.');
    return payload;
  }

  async function bootstrap({ actor }) {
    const now = clock();
    const identity = await resolveIdentity(prisma, actor);
    const assignment = await resolveCurrentAssignment(prisma, identity.employeeId, now);
    if (!actionableAssignment(assignment)) throw http(409, 'ATTENDANCE_SHIFT_NOT_ACTIONABLE', 'The current shift is not eligible for Attendance.');
    const [approval, existingSession, policy] = await Promise.all([
      approvedSchedule(prisma, assignment),
      prisma.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } }),
      policies.getPolicy(prisma)
    ]);
    const authority = await siteAuthority.resolve({ assignment, employee: identity.employee, existingSession }, prisma);
    const eventIntent = await eventIntentForAssignment(prisma, identity, assignment);
    const payload = {
      version: OFFLINE_BUNDLE_VERSION, userId: identity.userId, employeeId: identity.employeeId, employeeCode: identity.employeeCode,
      shiftAssignmentId: assignment.id, workDate: workDateText(assignment.workDate),
      shift: { code: assignment.shiftType?.code || null, name: assignment.shiftType?.name || null,
        startTime: normalizeScheduleTime(assignment.startTime || assignment.shiftType?.startTime || null),
        endTime: normalizeScheduleTime(assignment.endTime || assignment.shiftType?.endTime || null) },
      approval: { id: approval.id, revision: approval.revision },
      site: { id: authority.site.id, code: authority.site.code, name: authority.site.name,
        latitude: Number(authority.site.latitude), longitude: Number(authority.site.longitude), geofenceRadiusMeters: Number(authority.site.geofenceRadiusMeters) },
      policy: { maxAccuracyMeters: policy.maxAccuracyMeters, futureSkewMs: policy.futureSkewMs,
        offlineConfirmAfterMs: policy.offlineConfirmAfterMs, offlineBundleTtlMs: policy.offlineBundleTtlMs },
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + policy.offlineBundleTtlMs).toISOString()
    };
    const activeDevice = await prisma.attendanceDeviceEnrollment.findFirst({
      where: { employeeId: identity.employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' },
      select: { id: true, credentialFingerprint: true, displayName: true, activatedAt: true }
    });
    return { employee: identity.employee, eventIntent,
      assignment: { id: assignment.id, workDate: workDateText(assignment.workDate), shift: payload.shift, site: payload.site },
      activeDevice,
      offline: { bundle: issueBundle(payload), issuedAt: payload.issuedAt, expiresAt: payload.expiresAt, confirmAfterMs: policy.offlineConfirmAfterMs, maxAccuracyMeters: policy.maxAccuracyMeters } };
  }

  async function bindOrObserveDevice(client, { actor, identity, material, device, now }) {
    const existing = await client.attendanceDeviceEnrollment.findUnique({ where: { credentialFingerprint: material.fingerprint } });
    if (existing && existing.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_DEVICE_BOUND_TO_OTHER_EMPLOYEE', 'This device identity is already bound to another employee.');
    const active = await client.attendanceDeviceEnrollment.findFirst({ where: { employeeId: identity.employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
    if (!active) {
      let enrollment = existing;
      if (enrollment) {
        enrollment = await client.attendanceDeviceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'ACTIVE', proofVerifiedAt: now, activatedAt: now, revokedAt: null, revokedReason: null,
            displayName: cleanText(device.displayName, 120) || enrollment.displayName,
            platformHint: cleanText(device.platformHint, 100) || enrollment.platformHint,
            userAgentSnapshot: cleanText(device.userAgentSnapshot, 500) || enrollment.userAgentSnapshot }
        });
      } else {
        enrollment = await client.attendanceDeviceEnrollment.create({
          data: { employeeId: identity.employeeId, publicKey: material.bytes, keyAlgorithm: KEY_ALGORITHM,
            credentialFingerprint: material.fingerprint, displayName: cleanText(device.displayName, 120) || 'Attendance device',
            platformHint: cleanText(device.platformHint, 100), userAgentSnapshot: cleanText(device.userAgentSnapshot, 500),
            status: 'ACTIVE', proofVerifiedAt: now, activatedAt: now, createdByUserId: actor.sub }
        });
      }
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceEnrollment', entityId: enrollment.id,
        metadata: { event: 'AUTO_BIND_FIRST_DEVICE', employeeId: identity.employeeId, credentialFingerprint: material.fingerprint, keyAlgorithm: KEY_ALGORITHM } }, client);
      return { enrollment, binding: 'PRIMARY', reviewFlags: [] };
    }
    if (active.credentialFingerprint === material.fingerprint) return { enrollment: active, binding: 'PRIMARY', reviewFlags: [] };
    let observed = existing;
    if (!observed) {
      observed = await client.attendanceDeviceEnrollment.create({
        data: { employeeId: identity.employeeId, publicKey: material.bytes, keyAlgorithm: KEY_ALGORITHM,
          credentialFingerprint: material.fingerprint, displayName: cleanText(device.displayName, 120) || 'Observed Attendance device',
          platformHint: cleanText(device.platformHint, 100), userAgentSnapshot: cleanText(device.userAgentSnapshot, 500),
          status: 'PENDING_APPROVAL', observationOnly: true, proofVerifiedAt: now, createdByUserId: actor.sub }
      });
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceEnrollment', entityId: observed.id,
        metadata: { event: 'OBSERVED_FOREIGN_ATTENDANCE_DEVICE', employeeId: identity.employeeId, activeDeviceEnrollmentId: active.id, credentialFingerprint: material.fingerprint } }, client);
    }
    if (['REVOKED', 'REJECTED', 'CANCELLED'].includes(observed.status)) throw http(409, 'ATTENDANCE_DEVICE_NOT_ALLOWED', 'This device identity has been revoked or rejected.');
    if (observed.status === 'PENDING_APPROVAL' && observed.observationOnly !== true) {
      return { enrollment: observed, binding: 'FOREIGN', reviewFlags: ['DEVICE_MISMATCH', 'DEVICE_MOVE_PENDING'] };
    }
    return { enrollment: observed, binding: 'FOREIGN', reviewFlags: ['DEVICE_MISMATCH'] };
  }

  function expectationSnapshot(assignment, approval, authority) {
    return { version: 'ATTENDANCE_SIMPLE_EXPECTATION_V1', employeeId: assignment.employeeId, shiftAssignmentId: assignment.id,
      workDate: workDateText(assignment.workDate), shiftTypeId: assignment.shiftTypeId, shiftCode: assignment.shiftType?.code || null,
      startTime: normalizeScheduleTime(assignment.startTime || assignment.shiftType?.startTime || null),
      endTime: normalizeScheduleTime(assignment.endTime || assignment.shiftType?.endTime || null),
      scheduleApprovalId: approval.id, scheduleRevision: approval.revision,
      site: { id: authority.site.id, authoritySource: authority.source, departmentName: authority.departmentName || null } };
  }

  async function sessionForEvent(client, identity, assignment, approval, authority, intent, now) {
    const snapshot = expectationSnapshot(assignment, approval, authority);
    let session = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    if (!session) {
      if (intent !== 'CHECK_IN') throw http(409, 'ATTENDANCE_CHECK_IN_REQUIRED', 'CHECK_IN is required before CHECK_OUT.');
      session = await client.attendanceSession.create({
        data: { employeeId: identity.employeeId, shiftAssignmentId: assignment.id, expectedShiftTypeId: assignment.shiftTypeId,
          expectedSiteId: authority.site.id, workDate: assignment.workDate, expectationSnapshot: snapshot,
          expectationDigest: objectDigest(snapshot), state: 'OPEN', openedAt: now }
      });
    } else {
      if (session.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_SESSION_STALE', 'Attendance session identity is stale.');
      if (session.state !== 'OPEN' || session.closedAt) throw http(409, 'ATTENDANCE_SESSION_CLOSED', 'Attendance session is already closed.');
    }
    const same = await client.attendanceEvent.findUnique({ where: { sessionId_eventType: { sessionId: session.id, eventType: intent } } });
    if (same) throw http(409, intent === 'CHECK_IN' ? 'ATTENDANCE_ALREADY_CHECKED_IN' : 'ATTENDANCE_ALREADY_CHECKED_OUT', `${intent} already exists for this shift.`);
    if (intent === 'CHECK_OUT') {
      const checkIn = await client.attendanceEvent.findUnique({ where: { sessionId_eventType: { sessionId: session.id, eventType: 'CHECK_IN' } } });
      if (!checkIn) throw http(409, 'ATTENDANCE_CHECK_IN_REQUIRED', 'CHECK_IN is required before CHECK_OUT.');
    }
    return session;
  }

  function deviceSnapshot(binding, signals, material) {
    return { mode: 'ACCOUNT_DEVICE_GPS_GEOFENCE_V1', deviceEnrollmentId: binding.enrollment.id,
      credentialFingerprint: material.fingerprint, binding: binding.binding,
      signals: { standalone: signals.standalone === true, secureContext: signals.secureContext === true,
        serviceWorkerControlled: signals.serviceWorkerControlled === true, webCrypto: signals.webCrypto === true,
        indexedDb: signals.indexedDb === true, privateKeyNonExportable: signals.privateKeyNonExportable === true,
        automation: signals.automation === true },
      integrityAttestation: 'BEST_EFFORT_BROWSER_SIGNALS' };
  }

  async function submit({ actor, input, requestUserAgent = null }) {
    const now = clock();
    const capturedAt = new Date(input.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw http(400, 'ATTENDANCE_CAPTURED_AT_INVALID', 'Attendance capture time is invalid.');
    const action = String(input.eventIntent || '').trim().toUpperCase();
    if (!['CHECK_IN', 'CHECK_OUT'].includes(action)) throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
    const material = parsePublicKey(input.device);
    const signedPayload = signedEventPayload(input);
    verifySignature(material.key, signedPayload, input.device?.signatureBase64);

    const identity = await resolveIdentity(prisma, actor);
    const assignment = await loadAssignment(prisma, identity, input.shiftAssignmentId);
    const approval = await approvedSchedule(prisma, assignment);
    const existingSession = await prisma.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    const authority = await siteAuthority.resolve({ assignment, employee: identity.employee, existingSession }, prisma);
    const evidenceAssignment = { ...assignment, securitySiteId: authority.site.id, securitySite: authority.site };
    const offline = Boolean(input.offlineBundle);
    const riskFlags = integrityRiskFlags(input.device?.signals);

    if (offline) {
      const bundle = verifyBundle(input.offlineBundle);
      if (bundle.userId !== identity.userId || bundle.employeeId !== identity.employeeId || bundle.shiftAssignmentId !== assignment.id) throw http(409, 'ATTENDANCE_OFFLINE_BUNDLE_STALE', 'Offline Attendance bundle does not match the current account or shift.');
      const issuedAt = new Date(bundle.issuedAt);
      const expiresAt = new Date(bundle.expiresAt);
      if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || capturedAt.getTime() < issuedAt.getTime() - 60000 || capturedAt.getTime() > expiresAt.getTime()) throw http(409, 'ATTENDANCE_OFFLINE_BUNDLE_STALE', 'Offline Attendance was captured outside the authorized offline window.');
      if (bundle.site?.id !== authority.site.id) riskFlags.push('SITE_AUTHORITY_CHANGED');
    }

    const locationResult = await siteEvidence.validateGpsOnlyForAssignment({ assignment: evidenceAssignment, location: input.location, referenceTime: offline ? capturedAt : now }, prisma);
    riskFlags.push(...(locationResult.decision.riskFlags || []));
    const locationCapturedAt = new Date(input.location?.capturedAt);
    if (offline && Math.abs(locationCapturedAt.getTime() - capturedAt.getTime()) > 120000) riskFlags.push('OFFLINE_LOCATION_TIME_MISMATCH');

    return prisma.$transaction(async (tx) => {
      const existingEvent = await tx.attendanceEvent.findUnique({ where: { captureId: input.captureId } });
      if (existingEvent) return { counted: true, idempotent: true, event: existingEvent, status: 'ACCEPTED' };
      const existingPending = await tx.attendancePendingEvent.findUnique({ where: { captureId: input.captureId } });
      if (existingPending) return { counted: false, idempotent: true, pendingEvent: existingPending, status: existingPending.status };
      const binding = await bindOrObserveDevice(tx, { actor, identity, material,
        device: { ...input.device, userAgentSnapshot: requestUserAgent || input.device?.userAgentSnapshot || null }, now });
      riskFlags.push(...binding.reviewFlags);
      const uniqueRiskFlags = [...new Set(riskFlags)];
      const snapshot = deviceSnapshot(binding, input.device?.signals || {}, material);
      const policy = await policies.getPolicy(tx);
      const delayMs = Math.max(0, now.getTime() - capturedAt.getTime());

      if (offline && delayMs > policy.offlineConfirmAfterMs) {
        const pending = await tx.attendancePendingEvent.create({
          data: { employeeId: identity.employeeId, shiftAssignmentId: assignment.id, captureId: input.captureId,
            eventType: action, sourceMode: 'OFFLINE', capturedAt, receivedAt: now,
            locationEvidence: locationResult.evidenceRef, deviceSnapshot: snapshot,
            riskFlags: [...new Set([...uniqueRiskFlags, 'DELAYED_OFFLINE'])],
            payloadDigest: objectDigest(signedPayload), status: 'PENDING_CONFIRMATION' }
        });
        await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendancePendingEvent', entityId: pending.id,
          metadata: { event: 'OFFLINE_DELAYED_PENDING_CONFIRMATION', employeeId: identity.employeeId,
            shiftAssignmentId: assignment.id, captureId: input.captureId, delayMs,
            deviceEnrollmentId: binding.enrollment.id, riskFlags: pending.riskFlags } }, tx);
        return { counted: false, status: 'PENDING_CONFIRMATION', pendingEvent: pending, reviewRequired: true, reviewReasons: pending.riskFlags };
      }

      const session = await sessionForEvent(tx, identity, assignment, approval, authority, action, now);
      const reviewRequired = uniqueRiskFlags.length > 0;
      const context = { version: SIMPLE_EVENT_VERSION, employeeId: identity.employeeId, shiftAssignmentId: assignment.id,
        captureId: input.captureId, eventIntent: action, locationEvidence: locationResult.evidenceRef,
        deviceEnrollmentId: binding.enrollment.id, credentialFingerprint: material.fingerprint };
      const event = await tx.attendanceEvent.create({
        data: { sessionId: session.id, faceVerificationSessionId: null, deviceEnrollmentId: binding.enrollment.id,
          captureId: input.captureId, eventType: action, provenance: 'ONLINE', sourceMode: offline ? 'OFFLINE' : 'ONLINE',
          receivedAt: now, effectiveEventAt: offline ? capturedAt : now, deviceCapturedAt: offline ? capturedAt : null,
          timeBasis: 'SERVER_RECEIVED', contextDigest: objectDigest(context),
          locationEvidence: locationResult.evidenceRef, verificationSnapshot: snapshot,
          reviewRequired, reviewReasons: reviewRequired ? uniqueRiskFlags : null }
      });
      let finalSession = session;
      if (action === 'CHECK_OUT') finalSession = await tx.attendanceSession.update({ where: { id: session.id }, data: { state: 'CLOSED', closedAt: now } });
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceEvent', entityId: event.id,
        metadata: { event: 'ATTENDANCE_SIMPLE_ACCEPTED', employeeId: identity.employeeId,
          shiftAssignmentId: assignment.id, captureId: input.captureId, eventType: action,
          sourceMode: offline ? 'OFFLINE' : 'ONLINE', deviceEnrollmentId: binding.enrollment.id,
          deviceBinding: binding.binding, reviewRequired, reviewReasons: uniqueRiskFlags } }, tx);
      return { counted: true, status: reviewRequired ? 'ACCEPTED_REVIEW_FLAGGED' : 'ACCEPTED',
        event, session: finalSession, deviceBinding: binding.binding, reviewRequired, reviewReasons: uniqueRiskFlags };
    });
  }

  async function requestDeviceMove({ actor, input, requestUserAgent = null }) {
    const identity = await resolveIdentity(prisma, actor);
    const material = parsePublicKey({ publicKeySpkiBase64: input.publicKeySpkiBase64, keyAlgorithm: input.keyAlgorithm });
    const reason = cleanText(input.reason);
    if (!reason || reason.length < 3) throw http(400, 'ATTENDANCE_DEVICE_REPLACEMENT_REASON_REQUIRED', 'A replacement reason of at least 3 characters is required.');
    const requestId = normalizedUuid(input.requestId, 'ATTENDANCE_DEVICE_MOVE_REQUEST_ID_INVALID');
    verifySignature(material.key, { version: MOVE_REQUEST_VERSION, requestId,
      publicKeySpkiBase64: String(input.publicKeySpkiBase64 || ''), keyAlgorithm: String(input.keyAlgorithm || ''), reason }, input.signatureBase64);
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const active = await tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId: identity.employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
      if (!active) throw http(409, 'ATTENDANCE_DEVICE_PRIMARY_MISSING', 'No primary Attendance device is currently bound.');
      if (active.credentialFingerprint === material.fingerprint) throw http(409, 'ATTENDANCE_DEVICE_ALREADY_PRIMARY', 'This device is already the primary Attendance device.');
      const currentRequest = await tx.attendanceDeviceChangeRequest.findFirst({ where: { employeeId: identity.employeeId, status: { in: ['PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'] } }, include: { candidateDevice: true } });
      if (currentRequest) return currentRequest;
      let candidate = await tx.attendanceDeviceEnrollment.findUnique({ where: { credentialFingerprint: material.fingerprint } });
      if (candidate && candidate.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_DEVICE_BOUND_TO_OTHER_EMPLOYEE', 'This device identity is already bound to another employee.');
      if (!candidate) {
        candidate = await tx.attendanceDeviceEnrollment.create({
          data: { employeeId: identity.employeeId, publicKey: material.bytes, keyAlgorithm: KEY_ALGORITHM,
            credentialFingerprint: material.fingerprint, displayName: cleanText(input.displayName, 120) || 'Replacement Attendance device',
            platformHint: cleanText(input.platformHint, 100), userAgentSnapshot: cleanText(requestUserAgent, 500),
            status: 'PENDING_APPROVAL', observationOnly: false, proofVerifiedAt: now, createdByUserId: actor.sub }
        });
      }
      if (candidate.status !== 'PENDING_APPROVAL') throw http(409, 'ATTENDANCE_DEVICE_NOT_ACTIONABLE', 'This device cannot be requested as a replacement.');
      if (candidate.observationOnly === true) candidate = await tx.attendanceDeviceEnrollment.update({ where: { id: candidate.id }, data: { observationOnly: false, proofVerifiedAt: candidate.proofVerifiedAt || now } });
      const request = await tx.attendanceDeviceChangeRequest.create({
        data: { employeeId: identity.employeeId, requestType: 'REPLACEMENT', requestedByUserId: actor.sub,
          candidateDeviceEnrollmentId: candidate.id, currentDeviceEnrollmentId: active.id, reason }, include: { candidateDevice: true }
      });
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id,
        metadata: { event: 'REQUEST_PRIMARY_DEVICE_MOVE', employeeId: identity.employeeId,
          currentDeviceEnrollmentId: active.id, candidateDeviceEnrollmentId: candidate.id, reason } }, tx);
      return request;
    });
  }

  async function listPending({ actor }) {
    if (actor?.role !== 'ADMIN') throw http(403, 'FORBIDDEN', 'Admin role is required.');
    return prisma.attendancePendingEvent.findMany({ where: { status: 'PENDING_CONFIRMATION' }, orderBy: { receivedAt: 'asc' }, take: 200 });
  }

  async function reviewPending({ actor, pendingId, action, comment }) {
    if (actor?.role !== 'ADMIN') throw http(403, 'FORBIDDEN', 'Admin role is required.');
    const note = cleanText(comment);
    if (!note || note.length < 3) throw http(400, 'ATTENDANCE_PENDING_REVIEW_COMMENT_REQUIRED', 'A review comment of at least 3 characters is required.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const pending = await tx.attendancePendingEvent.findUnique({ where: { id: normalizedUuid(pendingId, 'ATTENDANCE_PENDING_ID_INVALID') } });
      if (!pending) throw http(404, 'ATTENDANCE_PENDING_NOT_FOUND', 'Pending Attendance event was not found.');
      if (pending.status !== 'PENDING_CONFIRMATION') throw http(409, 'ATTENDANCE_PENDING_NOT_ACTIONABLE', 'Pending Attendance event was already reviewed.');
      if (action === 'REJECT') {
        const rejected = await tx.attendancePendingEvent.update({ where: { id: pending.id }, data: { status: 'REJECTED', reviewedByUserId: actor.sub, reviewedAt: now, reviewComment: note } });
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendancePendingEvent', entityId: pending.id,
          metadata: { event: 'REJECT_DELAYED_OFFLINE_ATTENDANCE', comment: note } }, tx);
        return { status: 'REJECTED', pendingEvent: rejected, counted: false };
      }

      const assignment = await tx.shiftAssignment.findUnique({ where: { id: pending.shiftAssignmentId }, include: { shiftType: true, securitySite: true, employee: true } });
      if (!assignment || assignment.employeeId !== pending.employeeId || !actionableAssignment(assignment)) throw http(409, 'ATTENDANCE_ASSIGNMENT_STALE', 'Pending Attendance shift is no longer actionable.');
      const identity = { employeeId: pending.employeeId };
      const approval = await approvedSchedule(tx, assignment);
      const existingSession = await tx.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
      const authority = await siteAuthority.resolve({ assignment, employee: assignment.employee, existingSession }, tx);
      const session = await sessionForEvent(tx, identity, assignment, approval, authority, pending.eventType, now);
      const existingCapture = await tx.attendanceEvent.findUnique({ where: { captureId: pending.captureId } });
      if (existingCapture) {
        const confirmed = await tx.attendancePendingEvent.update({ where: { id: pending.id },
          data: { status: 'CONFIRMED', reviewedByUserId: actor.sub, reviewedAt: now, reviewComment: note, attendanceEventId: existingCapture.id } });
        return { status: 'CONFIRMED', pendingEvent: confirmed, event: existingCapture, counted: true, idempotent: true };
      }
      const snapshot = pending.deviceSnapshot && typeof pending.deviceSnapshot === 'object' ? pending.deviceSnapshot : {};
      const event = await tx.attendanceEvent.create({
        data: { sessionId: session.id, faceVerificationSessionId: null, deviceEnrollmentId: snapshot.deviceEnrollmentId || null,
          captureId: pending.captureId, eventType: pending.eventType, provenance: 'ONLINE', sourceMode: 'OFFLINE',
          receivedAt: pending.receivedAt, effectiveEventAt: pending.capturedAt, deviceCapturedAt: pending.capturedAt, timeBasis: 'SERVER_RECEIVED',
          contextDigest: pending.payloadDigest, locationEvidence: pending.locationEvidence,
          verificationSnapshot: snapshot, reviewRequired: false, reviewReasons: null }
      });
      if (pending.eventType === 'CHECK_OUT') await tx.attendanceSession.update({ where: { id: session.id }, data: { state: 'CLOSED', closedAt: now } });
      const confirmed = await tx.attendancePendingEvent.update({ where: { id: pending.id },
        data: { status: 'CONFIRMED', reviewedByUserId: actor.sub, reviewedAt: now, reviewComment: note, attendanceEventId: event.id } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendancePendingEvent', entityId: pending.id,
        metadata: { event: 'CONFIRM_DELAYED_OFFLINE_ATTENDANCE', attendanceEventId: event.id, comment: note } }, tx);
      return { status: 'CONFIRMED', pendingEvent: confirmed, event, counted: true };
    });
  }

  return { bootstrap, submit, requestDeviceMove, listPending, reviewPending, verifyBundle };
}

module.exports = {
  SIMPLE_EVENT_VERSION, OFFLINE_BUNDLE_VERSION, MOVE_REQUEST_VERSION,
  canonicalize, canonicalJson, objectDigest, signedEventPayload, integrityRiskFlags,
  createAttendanceSimpleService
};

