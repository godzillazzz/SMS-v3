'use strict';

const crypto = require('crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const ACTIVE_REQUEST_STATUSES = ['PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'];
const SUPPORTED_KEY_ALGORITHMS = new Set(['ECDSA_P256_SHA256']);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SELFIE_CHALLENGE_TTL_MS = 120 * 1000;
const DEVICE_TRANSFER_REJECTED = 'DEVICE_TRANSFER_REJECTED';
const DEVICE_REQUEST_AUDIT_FIELDS = Object.freeze([
  'event', 'requestId', 'employeeId', 'requestType', 'status',
  'candidateEnrollmentId', 'currentEnrollmentId', 'adminUserId', 'reviewedByUserId', 'reviewedAt',
  'reason', 'rejectedAt', 'rejectedEventCount', 'excludedCaptureIds',
  'deviceEnrollmentId', 'previousDeviceEnrollmentId', 'activeDeviceEnrollmentId', 'requestedByUserId'
]);
const DEVICE_REQUEST_AUDIT_FIELD_SET = new Set(DEVICE_REQUEST_AUDIT_FIELDS);

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function cleanText(value, max = 1000) { const text = value == null ? null : String(value).trim(); return text ? text.slice(0, max) : null; }
function fingerprint(publicKey) { return crypto.createHash('sha256').update(publicKey).digest('hex'); }
function challengeHash(challenge) { return crypto.createHash('sha256').update(String(challenge), 'utf8').digest('hex'); }
function decodePublicKey(value) {
  let key;
  try { key = Buffer.from(String(value || ''), 'base64'); crypto.createPublicKey({ key, format: 'der', type: 'spki' }); }
  catch { throw http(400, 'ATTENDANCE_DEVICE_PUBLIC_KEY_INVALID', 'Invalid device public key.'); }
  if (!key.length || key.length > 4096) throw http(400, 'ATTENDANCE_DEVICE_PUBLIC_KEY_INVALID', 'Invalid device public key.');
  return key;
}
function assertAdmin(actor) { if (actor?.role !== 'ADMIN') throw http(403, 'ATTENDANCE_DEVICE_ADMIN_REQUIRED', 'Admin approval is required for this action.'); }
function mapConflict(error) {
  if (error?.code === 'P2002') return http(409, 'ATTENDANCE_DEVICE_STATE_CONFLICT', 'Attendance device state changed. Please refresh and try again.');
  return error;
}
function safeEnrollment(row) { return row ? { id: row.id, employeeId: row.employeeId, displayName: row.displayName, keyAlgorithm: row.keyAlgorithm, credentialFingerprint: row.credentialFingerprint, platformHint: row.platformHint, status: row.status, proofVerifiedAt: row.proofVerifiedAt, enrolledAt: row.enrolledAt, activatedAt: row.activatedAt, revokedAt: row.revokedAt, revokedReason: row.revokedReason, approvedByUserId: row.approvedByUserId || null, approvedBy: safeRequester(row.approvedBy) } : null; }
function safeEmployee(row) { return row ? { id: row.id, displayName: row.displayName, firstName: row.firstName, lastName: row.lastName, department: row.department } : undefined; }
function safeRequester(row) { return row ? { id: row.id, displayName: row.displayName, role: row.role || null } : undefined; }
function safeAudit(row) {
  if (!row) return null;
  const source = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
  const metadata = Object.fromEntries(Object.entries(source).filter(([key]) => DEVICE_REQUEST_AUDIT_FIELD_SET.has(key)));
  return { id: row.id, actorUserId: row.actorUserId, action: row.action, entityType: row.entityType, entityId: row.entityId, metadata, createdAt: row.createdAt, actor: safeRequester(row.actor) };
}
function deviceRequestAuditMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata || {}).filter(([key]) => DEVICE_REQUEST_AUDIT_FIELD_SET.has(key)));
}
function safeRequest(row, projection = {}) { return row ? { id: row.id, requestId: row.id, employeeId: row.employeeId, requestType: row.requestType, candidateEnrollmentId: row.candidateDeviceEnrollmentId, currentEnrollmentId: row.currentDeviceEnrollmentId, status: row.status, reviewedByUserId: row.reviewedByUserId ?? null, reviewedAt: row.reviewedAt ?? null, rejectedEventCount: projection.rejectedEventCount ?? row.rejectedEventCount ?? 0, excludedCaptureIds: projection.excludedCaptureIds ?? row.excludedCaptureIds ?? [], requestedByUserId: row.requestedByUserId, candidateDeviceEnrollmentId: row.candidateDeviceEnrollmentId, currentDeviceEnrollmentId: row.currentDeviceEnrollmentId, reason: row.reason, reviewerComment: row.reviewerComment, returnedAt: row.returnedAt, cancelledAt: row.cancelledAt, createdAt: row.createdAt, updatedAt: row.updatedAt, candidateDevice: row.candidateDevice ? safeEnrollment(row.candidateDevice) : undefined, employee: safeEmployee(row.employee), requestedBy: safeRequester(row.requestedBy), reviewedBy: safeRequester(row.reviewedBy) } : null; }
function reviewReasonList(value) { return Array.isArray(value) ? value.filter((reason) => typeof reason === 'string') : []; }
function addReviewReason(value, reason) { return [...new Set([...reviewReasonList(value), reason])]; }

function createAttendanceDeviceService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  async function loadLinkedEmployee(client, actor) {
    if (Object.prototype.hasOwnProperty.call(actor || {}, 'employeeAuthority')) {
      const employee = actor.employeeAuthority;
      if (!employee?.id) throw http(403, 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
      if (!employee.isActive || employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot enroll an Attendance device.');
      return employee;
    }
    const user = await client.user.findUnique({ where: { id: actor?.sub }, select: { id: true, employeeId: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.employee.isActive || user.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot enroll an Attendance device.');
    return user.employee;
  }

  async function getMyState({ actor }) {
    const employee = await loadLinkedEmployee(prisma, actor);
    const [activeDevice, activeRequest] = await Promise.all([
      prisma.attendanceDeviceEnrollment.findFirst({ where: { employeeId: employee.id, status: 'ACTIVE' }, include: { approvedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { activatedAt: 'desc' } }),
      prisma.attendanceDeviceChangeRequest.findFirst({ where: { employeeId: employee.id, status: { in: ACTIVE_REQUEST_STATUSES } }, include: { candidateDevice: { include: { approvedBy: { select: { id: true, displayName: true, role: true } } } }, reviewedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { createdAt: 'desc' } })
    ]);
    return { employeeId: employee.id, activeDevice: safeEnrollment(activeDevice), activeRequest: safeRequest(activeRequest) };
  }

  async function createRequest({ actor, displayName, publicKeySpkiBase64, keyAlgorithm = 'ECDSA_P256_SHA256', platformHint = null, userAgentSnapshot = null, reason = null }) {
    if (!SUPPORTED_KEY_ALGORITHMS.has(keyAlgorithm)) throw http(400, 'ATTENDANCE_DEVICE_ALGORITHM_UNSUPPORTED', 'Unsupported device key algorithm.');
    const publicKey = decodePublicKey(publicKeySpkiBase64);
    const credentialFingerprint = fingerprint(publicKey);
    const name = cleanText(displayName, 120);
    if (!name) throw http(400, 'ATTENDANCE_DEVICE_DISPLAY_NAME_REQUIRED', 'Device display name is required.');
    try {
      return await prisma.$transaction(async (tx) => {
        const employee = await loadLinkedEmployee(tx, actor);
        const [actionable, active] = await Promise.all([
          tx.attendanceDeviceChangeRequest.findFirst({ where: { employeeId: employee.id, status: { in: ACTIVE_REQUEST_STATUSES } }, select: { id: true } }),
          tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId: employee.id, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } })
        ]);
        if (actionable) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_ALREADY_ACTIVE', 'An Attendance device request is already active.');
        const candidate = await tx.attendanceDeviceEnrollment.create({ data: { employeeId: employee.id, publicKey, keyAlgorithm, credentialFingerprint, displayName: name, platformHint: cleanText(platformHint, 100), userAgentSnapshot: cleanText(userAgentSnapshot, 500), status: 'PENDING_APPROVAL', createdByUserId: actor.sub } });
        const request = await tx.attendanceDeviceChangeRequest.create({ data: { employeeId: employee.id, requestType: active ? 'REPLACEMENT' : 'INITIAL', requestedByUserId: actor.sub, candidateDeviceEnrollmentId: candidate.id, currentDeviceEnrollmentId: active?.id || null, reason: cleanText(reason) }, include: { candidateDevice: true } });
        await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ event: 'CREATED', requestId: request.id, requestType: request.requestType, employeeId: employee.id, candidateEnrollmentId: candidate.id, currentEnrollmentId: active?.id || null, requestedByUserId: actor.sub, reason: cleanText(reason) }) }, tx);
        return safeRequest(request);
      });
    } catch (error) { throw mapConflict(error); }
  }

  async function createProofChallenge({ actor, requestId }) {
    const now = clock();
    const challenge = randomBytes(32).toString('base64url');
    try {
      return await prisma.$transaction(async (tx) => {
        const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true } });
        if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
        if (!ACTIVE_REQUEST_STATUSES.includes(request.status)) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request is not actionable.');
        await tx.attendanceDeviceChallenge.updateMany({ where: { employeeId: request.employeeId, deviceEnrollmentId: request.candidateDeviceEnrollmentId, purpose: 'DEVICE_ENROLLMENT', consumedAt: null }, data: { consumedAt: now } });
        const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
        const row = await tx.attendanceDeviceChallenge.create({ data: { employeeId: request.employeeId, deviceEnrollmentId: request.candidateDeviceEnrollmentId, purpose: 'DEVICE_ENROLLMENT', challengeHash: challengeHash(challenge), expiresAt } });
        return { challengeId: row.id, challenge, expiresAt, keyAlgorithm: request.candidateDevice.keyAlgorithm };
      });
    } catch (error) { throw mapConflict(error); }
  }

  async function createSelfieChallenge({ actor, action = null, assignmentId = null }) {
    const now = clock();
    const nonce = randomBytes(32).toString('hex');
    const employee = await loadLinkedEmployee(prisma, actor);
    const expiresAt = new Date(now.getTime() + SELFIE_CHALLENGE_TTL_MS);
    await prisma.attendanceDeviceChallenge.updateMany({ where: { employeeId: employee.id, purpose: 'ATTENDANCE_EVENT', consumedAt: null }, data: { consumedAt: now } });
    const binding = [employee.id, String(action || ''), String(assignmentId || '')].join('|');
    await prisma.attendanceDeviceChallenge.create({ data: { employeeId: employee.id, purpose: 'ATTENDANCE_EVENT', challengeHash: challengeHash(`${nonce}|${binding}`), expiresAt } });
    return { nonce, expiresAt };
  }

  async function verifyProof({ actor, requestId, challengeId, challenge, signatureBase64 }) {
    const now = clock();
    const snapshot = await prisma.$transaction(async (tx) => {
      const [request, stored] = await Promise.all([
        tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true } }),
        tx.attendanceDeviceChallenge.findUnique({ where: { id: challengeId } })
      ]);
      if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      if (!ACTIVE_REQUEST_STATUSES.includes(request.status)) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request is not actionable.');
      if (!stored || stored.employeeId !== request.employeeId || stored.deviceEnrollmentId !== request.candidateDeviceEnrollmentId || stored.purpose !== 'DEVICE_ENROLLMENT' || stored.consumedAt || stored.expiresAt <= now || stored.challengeHash !== challengeHash(challenge)) throw http(400, 'ATTENDANCE_DEVICE_CHALLENGE_INVALID', 'Device proof challenge is invalid or expired.');
      const consumed = await tx.attendanceDeviceChallenge.updateMany({ where: { id: challengeId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw http(400, 'ATTENDANCE_DEVICE_CHALLENGE_INVALID', 'Device proof challenge is invalid or expired.');
      return { requestId: request.id, employeeId: request.employeeId, requestedByUserId: request.requestedByUserId, candidateDeviceEnrollmentId: request.candidateDeviceEnrollmentId, candidateDevice: request.candidateDevice };
    });
    let signature; let challengeBytes;
    try { signature = Buffer.from(String(signatureBase64 || ''), 'base64'); challengeBytes = Buffer.from(String(challenge || ''), 'base64url'); }
    catch { throw http(400, 'ATTENDANCE_DEVICE_PROOF_INVALID', 'Device proof is invalid.'); }
    if (!signature.length || !challengeBytes.length) throw http(400, 'ATTENDANCE_DEVICE_PROOF_INVALID', 'Device proof is invalid.');
    let key;
    try { key = crypto.createPublicKey({ key: snapshot.candidateDevice.publicKey, format: 'der', type: 'spki' }); }
    catch { throw http(409, 'ATTENDANCE_DEVICE_PUBLIC_KEY_INVALID', 'Stored device public key is invalid.'); }
    let verified = false;
    try { verified = crypto.verify('sha256', challengeBytes, { key, dsaEncoding: 'ieee-p1363' }, signature); } catch {}
    if (!verified) { try { verified = crypto.verify('sha256', challengeBytes, key, signature); } catch {} }
    if (!verified) throw http(400, 'ATTENDANCE_DEVICE_PROOF_INVALID', 'Device proof is invalid.');
    return prisma.$transaction(async (tx) => {
      const marked = await tx.attendanceDeviceEnrollment.updateMany({
        where: {
          id: snapshot.candidateDeviceEnrollmentId,
          employeeId: snapshot.employeeId,
          status: 'PENDING_APPROVAL',
          candidateForRequest: {
            is: {
              id: snapshot.requestId,
              employeeId: snapshot.employeeId,
              requestedByUserId: actor.sub,
              status: { in: ACTIVE_REQUEST_STATUSES }
            }
          }
        },
        data: { proofVerifiedAt: now }
      });
      if (marked.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request changed during proof verification.');
      const candidate = { ...snapshot.candidateDevice, proofVerifiedAt: now };
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceEnrollment', entityId: candidate.id, metadata: { event: 'DEVICE_PROOF_VERIFIED', employeeId: snapshot.employeeId, requestId: snapshot.requestId, keyAlgorithm: candidate.keyAlgorithm, credentialFingerprint: candidate.credentialFingerprint } }, tx);
      return safeEnrollment(candidate);
    });
  }

  async function listRequests({ actor, status = 'PENDING_APPROVAL' }) {
    assertAdmin(actor);
    const rows = await prisma.attendanceDeviceChangeRequest.findMany({ where: status ? { status } : {}, include: { candidateDevice: { include: { approvedBy: { select: { id: true, displayName: true, role: true } } } }, employee: { select: { id: true, displayName: true, firstName: true, lastName: true, department: true } }, requestedBy: { select: { id: true, displayName: true, role: true } }, reviewedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map(safeRequest);
  }

  async function listAdminOverview({ actor }) {
    assertAdmin(actor);
    const [enrollments, requests, audits] = await Promise.all([
      prisma.attendanceDeviceEnrollment.findMany({ include: { employee: { select: { id: true, displayName: true, firstName: true, lastName: true, department: true } }, approvedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: [{ employeeId: 'asc' }, { createdAt: 'desc' }] }),
      prisma.attendanceDeviceChangeRequest.findMany({ include: { candidateDevice: { include: { approvedBy: { select: { id: true, displayName: true, role: true } } } }, employee: { select: { id: true, displayName: true, firstName: true, lastName: true, department: true } }, requestedBy: { select: { id: true, displayName: true, role: true } }, reviewedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.findMany({ where: { entityType: { in: ['AttendanceDeviceEnrollment', 'AttendanceDeviceChangeRequest'] } }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 300 })
    ]);
    const groups = new Map();
    const ensure = (employeeId, employee) => {
      if (!groups.has(employeeId)) groups.set(employeeId, { employeeId, employee: safeEmployee(employee), history: [], requests: [], recentAudit: [] });
      else if (employee && !groups.get(employeeId).employee) groups.get(employeeId).employee = safeEmployee(employee);
      return groups.get(employeeId);
    };
    for (const row of enrollments) ensure(row.employeeId, row.employee).history.push(safeEnrollment(row));
    for (const row of requests) ensure(row.employeeId, row.employee).requests.push(safeRequest(row));
    for (const row of audits) {
      const employeeId = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata.employeeId : null;
      if (typeof employeeId === 'string' && groups.has(employeeId) && groups.get(employeeId).recentAudit.length < 20) groups.get(employeeId).recentAudit.push(safeAudit(row));
    }
    return Array.from(groups.values()).map((group) => ({
      employeeId: group.employeeId,
      employee: group.employee,
      activeDevice: group.history.find((row) => row.status === 'ACTIVE') || null,
      activeRequest: group.requests.find((row) => ACTIVE_REQUEST_STATUSES.includes(row.status)) || null,
      history: group.history,
      recentAudit: group.recentAudit
    })).sort((a, b) => String(a.employee?.displayName || a.employeeId).localeCompare(String(b.employee?.displayName || b.employeeId), 'th'));
  }

  async function revokeCurrent({ actor, employeeId, deviceEnrollmentId, reason }) {
    assertAdmin(actor);
    const text = cleanText(reason);
    if (!text || text.length < 3) throw http(400, 'ATTENDANCE_DEVICE_REVOKE_REASON_REQUIRED', 'A revoke reason of at least 3 characters is required.');
    const now = clock();
    try {
      return await prisma.$transaction(async (tx) => {
        const device = await tx.attendanceDeviceEnrollment.findUnique({ where: { id: deviceEnrollmentId } });
        if (!device || device.employeeId !== employeeId) throw http(404, 'ATTENDANCE_DEVICE_NOT_FOUND', 'Attendance device not found.');
        if (device.status !== 'ACTIVE') throw http(409, 'ATTENDANCE_DEVICE_NOT_ACTIVE', 'Only the current ACTIVE Attendance device can be revoked.');
        const pending = await tx.attendanceDeviceChangeRequest.findFirst({ where: { employeeId, status: { in: ACTIVE_REQUEST_STATUSES } }, include: { candidateDevice: { include: { approvedBy: { select: { id: true, displayName: true, role: true } } } }, reviewedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { createdAt: 'desc' } });
        const claimed = await tx.attendanceDeviceEnrollment.updateMany({ where: { id: device.id, employeeId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: now, revokedReason: text } });
        if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_STATE_CONFLICT', 'Attendance device state changed. Please refresh and try again.');
        let cancelledRequestId = null;
        if (pending) {
          const cancelled = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: pending.id, employeeId, status: { in: ACTIVE_REQUEST_STATUSES } }, data: { status: 'CANCELLED', cancelledAt: now, reviewerComment: text, reviewedByUserId: actor.sub, reviewedAt: now } });
          if (cancelled.count === 1) {
            cancelledRequestId = pending.id;
            if (pending.candidateDeviceEnrollmentId !== device.id) await tx.attendanceDeviceEnrollment.updateMany({ where: { id: pending.candidateDeviceEnrollmentId, employeeId, status: 'PENDING_APPROVAL' }, data: { status: 'CANCELLED', revokedAt: now, revokedReason: text } });
          }
        }
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceEnrollment', entityId: device.id, metadata: { event: 'ADMIN_REVOKE_CURRENT', employeeId, deviceEnrollmentId: device.id, reason: text, revokedAt: now, cancelledRequestId } }, tx);
        return { employeeId, revokedDevice: safeEnrollment({ ...device, status: 'REVOKED', revokedAt: now, revokedReason: text }), cancelledRequestId };
      });
    } catch (error) { throw mapConflict(error); }
  }

  // ADMIN shortcut for the same transfer an employee can request: make a device the
  // employee has already used (key proof verified at clock-in or enrollment) the
  // primary device. It records a normal change request and approves it, so the
  // approval path, revocation of the previous device and audit trail stay identical.
  async function promoteDevice({ actor, employeeId, deviceEnrollmentId, reason }) {
    assertAdmin(actor);
    const text = cleanText(reason);
    if (!text || text.length < 3) throw http(400, 'ATTENDANCE_DEVICE_PROMOTE_REASON_REQUIRED', 'A reason of at least 3 characters is required.');
    const now = clock();
    let requestId;
    try {
      requestId = await prisma.$transaction(async (tx) => {
        const candidate = await tx.attendanceDeviceEnrollment.findUnique({ where: { id: deviceEnrollmentId } });
        if (!candidate || candidate.employeeId !== employeeId) throw http(404, 'ATTENDANCE_DEVICE_NOT_FOUND', 'Attendance device not found.');
        if (candidate.status === 'ACTIVE') throw http(409, 'ATTENDANCE_DEVICE_ALREADY_PRIMARY', 'This device is already the primary Attendance device.');
        if (candidate.status !== 'PENDING_APPROVAL' || !candidate.proofVerifiedAt) throw http(409, 'ATTENDANCE_DEVICE_NOT_ACTIONABLE', 'Only a device with a verified key that is not revoked can become primary.');
        const active = await tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
        const open = await tx.attendanceDeviceChangeRequest.findFirst({ where: { employeeId, status: { in: ACTIVE_REQUEST_STATUSES } } });
        if (open && open.candidateDeviceEnrollmentId === candidate.id && open.status === 'PENDING_APPROVAL') return open.id;
        if (open) {
          const cancelled = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: open.id, status: { in: ACTIVE_REQUEST_STATUSES } }, data: { status: 'CANCELLED', cancelledAt: now, reviewerComment: text, reviewedByUserId: actor.sub, reviewedAt: now } });
          if (cancelled.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_STATE_CONFLICT', 'Attendance device state changed. Please refresh and try again.');
          await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: open.id, metadata: deviceRequestAuditMetadata({ event: 'CANCELLED_BY_ADMIN_PROMOTE', requestId: open.id, employeeId, reason: text, adminUserId: actor.sub }) }, tx);
        }
        if (candidate.observationOnly === true) await tx.attendanceDeviceEnrollment.update({ where: { id: candidate.id }, data: { observationOnly: false } });
        const request = await tx.attendanceDeviceChangeRequest.create({
          data: { employeeId, requestType: active ? 'REPLACEMENT' : 'INITIAL', requestedByUserId: actor.sub,
            candidateDeviceEnrollmentId: candidate.id, currentDeviceEnrollmentId: active?.id || null, reason: text }
        });
        await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ event: 'ADMIN_PROMOTE_PRIMARY_DEVICE', requestId: request.id, employeeId, requestType: request.requestType, candidateEnrollmentId: candidate.id, currentEnrollmentId: active?.id || null, adminUserId: actor.sub, reason: text }) }, tx);
        return request.id;
      });
    } catch (error) { throw mapConflict(error); }
    return approve({ actor, requestId, comment: text });
  }

  async function approve({ actor, requestId, comment = null }) {
    assertAdmin(actor);
    const now = clock();
    try {
      return await prisma.$transaction(async (tx) => {
        const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
        if (!request) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
        if (request.status === 'APPROVED') return safeRequest(request);
        if (request.status !== 'PENDING_APPROVAL') throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only pending device requests can be approved.');
        if (!request.employee.isActive || request.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot activate an Attendance device.');
        if (request.candidateDevice.status !== 'PENDING_APPROVAL' || !request.candidateDevice.proofVerifiedAt) throw http(409, 'ATTENDANCE_DEVICE_PROOF_REQUIRED', 'Verified device-key proof is required before approval.');
        const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', reviewedByUserId: actor.sub, reviewedAt: now, reviewerComment: cleanText(comment) } });
        if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request was already reviewed.');
        const active = await tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId: request.employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
        if (request.requestType === 'INITIAL' && active) throw http(409, 'ATTENDANCE_DEVICE_STALE_REQUEST', 'An active device already exists.');
        if (request.requestType === 'REPLACEMENT' && (!active || active.id !== request.currentDeviceEnrollmentId)) throw http(409, 'ATTENDANCE_DEVICE_STALE_REQUEST', 'The active device changed after this request was submitted.');
        if (active) await tx.attendanceDeviceEnrollment.update({ where: { id: active.id }, data: { status: 'REVOKED', revokedAt: now, revokedReason: 'DEVICE_TRANSFER_SUPERSEDED' } });
        const candidate = await tx.attendanceDeviceEnrollment.update({ where: { id: request.candidateDeviceEnrollmentId }, data: { status: 'ACTIVE', activatedAt: now, approvedByUserId: actor.sub, revokedAt: null, revokedReason: null }, include: { approvedBy: { select: { id: true, displayName: true, role: true } } } });
        const rejectedEvents = tx.attendanceEvent
          ? await tx.attendanceEvent.findMany({ where: { deviceEnrollmentId: request.candidateDeviceEnrollmentId, session: { employeeId: request.employeeId } }, select: { id: true, reviewReasons: true, reviewRequired: true } })
          : [];
        for (const event of rejectedEvents) {
          const reviewReasons = reviewReasonList(event.reviewReasons).filter((reason) => reason !== DEVICE_TRANSFER_REJECTED);
          await tx.attendanceEvent.update({ where: { id: event.id }, data: { reviewRequired: reviewReasons.length > 0 || (event.reviewRequired && !Array.isArray(event.reviewReasons)), reviewReasons: reviewReasons.length ? reviewReasons : null } });
        }
        const approvalMetadata = { requestId: request.id, requestType: request.requestType, employeeId: request.employeeId, candidateEnrollmentId: candidate.id, currentEnrollmentId: active?.id || null, previousDeviceEnrollmentId: active?.id || null, activeDeviceEnrollmentId: candidate.id, adminUserId: actor.sub, reviewedByUserId: actor.sub, reviewedAt: now, status: 'APPROVED' };
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ ...approvalMetadata, event: 'APPROVED' }) }, tx);
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ ...approvalMetadata, event: 'FINAL_APPROVE' }) }, tx);
        const approved = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { candidateDevice: { include: { approvedBy: { select: { id: true, displayName: true, role: true } } } }, reviewedBy: { select: { id: true, displayName: true, role: true } } } });
        return safeRequest(approved, { rejectedEventCount: 0, excludedCaptureIds: [] });
      });
    } catch (error) { throw mapConflict(error); }
  }

  async function returnForCorrection({ actor, requestId, comment }) {
    assertAdmin(actor);
    const text = cleanText(comment);
    if (!text) throw http(400, 'ATTENDANCE_DEVICE_REVIEW_COMMENT_REQUIRED', 'A correction comment is required.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, status: 'PENDING_APPROVAL' }, data: { status: 'RETURNED_FOR_CORRECTION', reviewerComment: text, reviewedByUserId: actor.sub, returnedAt: now } });
      if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only pending device requests can be returned.');
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ event: 'RETURN_FOR_CORRECTION', requestId: request.id, employeeId: request.employeeId, status: 'RETURNED_FOR_CORRECTION', reviewedByUserId: actor.sub, reviewedAt: now, reason: text }) }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { reviewedBy: { select: { id: true, displayName: true, role: true } } } }));
    });
  }

  async function resubmit({ actor, requestId, reason = null }) {
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true } });
      if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, requestedByUserId: actor.sub, status: 'RETURNED_FOR_CORRECTION' }, data: { status: 'PENDING_APPROVAL', reason: cleanText(reason) ?? request.reason, reviewerComment: null, reviewedByUserId: null, reviewedAt: null, returnedAt: null } });
      if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only returned device requests can be resubmitted.');
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ event: 'RESUBMIT', requestId: request.id, employeeId: request.employeeId, status: 'PENDING_APPROVAL', requestedByUserId: request.requestedByUserId, reason: cleanText(reason) ?? request.reason }) }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { candidateDevice: true } }));
    });
  }

  async function reject({ actor, requestId, reason }) {
    assertAdmin(actor);
    const text = cleanText(reason);
    if (!text) throw http(400, 'ATTENDANCE_DEVICE_REJECTION_REASON_REQUIRED', 'A rejection reason is required.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED', reviewerComment: text, reviewedByUserId: actor.sub, reviewedAt: now } });
      if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only pending device requests can be rejected.');
      const events = tx.attendanceEvent
        ? await tx.attendanceEvent.findMany({ where: { deviceEnrollmentId: request.candidateDeviceEnrollmentId, session: { employeeId: request.employeeId } }, select: { id: true, captureId: true, reviewReasons: true } })
        : [];
      for (const event of events) {
        await tx.attendanceEvent.update({ where: { id: event.id }, data: { reviewRequired: true, reviewReasons: addReviewReason(event.reviewReasons, DEVICE_TRANSFER_REJECTED) } });
      }
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({
        event: 'REJECTED', requestId: request.id, employeeId: request.employeeId, status: 'REJECTED',
        candidateEnrollmentId: request.candidateDeviceEnrollmentId, currentEnrollmentId: request.currentDeviceEnrollmentId,
        adminUserId: actor.sub, reason: text, rejectedAt: now, rejectedEventCount: events.length,
        excludedCaptureIds: events.map((event) => event.captureId)
      }) }, tx);
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({
        event: 'DEVICE_TRANSFER_REJECTED', requestId: request.id, employeeId: request.employeeId, status: 'REJECTED',
        candidateEnrollmentId: request.candidateDeviceEnrollmentId, currentEnrollmentId: request.currentDeviceEnrollmentId,
        adminUserId: actor.sub, reason: text, rejectedAt: now, rejectedEventCount: events.length,
        excludedCaptureIds: events.map((event) => event.captureId)
      }) }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { reviewedBy: { select: { id: true, displayName: true, role: true } } } }), { rejectedEventCount: events.length, excludedCaptureIds: events.map((event) => event.captureId) });
    });
  }

  async function cancel({ actor, requestId, reason }) {
    const text = cleanText(reason);
    if (!text) throw http(400, 'ATTENDANCE_DEVICE_CANCEL_REASON_REQUIRED', 'A cancellation reason is required.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, requestedByUserId: actor.sub, status: { in: ACTIVE_REQUEST_STATUSES } }, data: { status: 'CANCELLED', cancelledAt: now, reviewerComment: text } });
      if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'This device request can no longer be cancelled.');
      await tx.attendanceDeviceEnrollment.update({ where: { id: request.candidateDeviceEnrollmentId }, data: { status: 'CANCELLED', revokedAt: now, revokedReason: text } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: deviceRequestAuditMetadata({ event: 'CANCELLED', requestId: request.id, employeeId: request.employeeId, status: 'CANCELLED', reason: text, requestedByUserId: request.requestedByUserId }) }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { reviewedBy: { select: { id: true, displayName: true, role: true } } } }));
    });
  }

  return { getMyState, createRequest, createProofChallenge, createSelfieChallenge, verifyProof, listRequests, listAdminOverview, revokeCurrent, promoteDevice, approve, returnForCorrection, resubmit, reject, cancel };
}

module.exports = { ACTIVE_REQUEST_STATUSES, SUPPORTED_KEY_ALGORITHMS, CHALLENGE_TTL_MS, DEVICE_REQUEST_AUDIT_FIELDS, challengeHash, fingerprint, safeAudit, createAttendanceDeviceService };
