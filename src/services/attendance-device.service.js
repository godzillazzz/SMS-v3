'use strict';

const crypto = require('crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const ACTIVE_REQUEST_STATUSES = ['PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'];
const SUPPORTED_KEY_ALGORITHMS = new Set(['ECDSA_P256_SHA256']);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

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
function safeEnrollment(row) { return row ? { id: row.id, employeeId: row.employeeId, displayName: row.displayName, keyAlgorithm: row.keyAlgorithm, credentialFingerprint: row.credentialFingerprint, platformHint: row.platformHint, status: row.status, proofVerifiedAt: row.proofVerifiedAt, enrolledAt: row.enrolledAt, activatedAt: row.activatedAt, revokedAt: row.revokedAt } : null; }
function safeRequest(row) { return row ? { id: row.id, employeeId: row.employeeId, requestType: row.requestType, status: row.status, requestedByUserId: row.requestedByUserId, candidateDeviceEnrollmentId: row.candidateDeviceEnrollmentId, currentDeviceEnrollmentId: row.currentDeviceEnrollmentId, reason: row.reason, reviewerComment: row.reviewerComment, reviewedByUserId: row.reviewedByUserId, reviewedAt: row.reviewedAt, returnedAt: row.returnedAt, cancelledAt: row.cancelledAt, createdAt: row.createdAt, updatedAt: row.updatedAt, candidateDevice: row.candidateDevice ? safeEnrollment(row.candidateDevice) : undefined } : null; }

function createAttendanceDeviceService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  async function loadLinkedEmployee(client, actor) {
    const user = await client.user.findUnique({ where: { id: actor?.sub }, select: { id: true, employeeId: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.employee.isActive || user.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot enroll an Attendance device.');
    return user.employee;
  }

  async function getMyState({ actor }) {
    const employee = await loadLinkedEmployee(prisma, actor);
    const [activeDevice, activeRequest] = await Promise.all([
      prisma.attendanceDeviceEnrollment.findFirst({ where: { employeeId: employee.id, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } }),
      prisma.attendanceDeviceChangeRequest.findFirst({ where: { employeeId: employee.id, status: { in: ACTIVE_REQUEST_STATUSES } }, include: { candidateDevice: true }, orderBy: { createdAt: 'desc' } })
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
        const actionable = await tx.attendanceDeviceChangeRequest.findFirst({ where: { employeeId: employee.id, status: { in: ACTIVE_REQUEST_STATUSES } }, select: { id: true } });
        if (actionable) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_ALREADY_ACTIVE', 'An Attendance device request is already active.');
        const active = await tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId: employee.id, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
        const candidate = await tx.attendanceDeviceEnrollment.create({ data: { employeeId: employee.id, publicKey, keyAlgorithm, credentialFingerprint, displayName: name, platformHint: cleanText(platformHint, 100), userAgentSnapshot: cleanText(userAgentSnapshot, 500), status: 'PENDING_APPROVAL', createdByUserId: actor.sub } });
        const request = await tx.attendanceDeviceChangeRequest.create({ data: { employeeId: employee.id, requestType: active ? 'REPLACEMENT' : 'INITIAL', requestedByUserId: actor.sub, candidateDeviceEnrollmentId: candidate.id, currentDeviceEnrollmentId: active?.id || null, reason: cleanText(reason) }, include: { candidateDevice: true } });
        await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'SUBMIT', requestType: request.requestType, employeeId: employee.id, candidateDeviceEnrollmentId: candidate.id, credentialFingerprint, keyAlgorithm } }, tx);
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

  async function verifyProof({ actor, requestId, challengeId, challenge, signatureBase64 }) {
    const now = clock();
    const snapshot = await prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true } });
      if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      if (!ACTIVE_REQUEST_STATUSES.includes(request.status)) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request is not actionable.');
      const stored = await tx.attendanceDeviceChallenge.findUnique({ where: { id: challengeId } });
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
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: snapshot.requestId }, include: { candidateDevice: true } });
      if (!request || request.requestedByUserId !== actor?.sub || request.candidateDeviceEnrollmentId !== snapshot.candidateDeviceEnrollmentId || !ACTIVE_REQUEST_STATUSES.includes(request.status)) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request changed during proof verification.');
      const candidate = await tx.attendanceDeviceEnrollment.update({ where: { id: request.candidateDeviceEnrollmentId }, data: { proofVerifiedAt: now } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceEnrollment', entityId: candidate.id, metadata: { event: 'DEVICE_PROOF_VERIFIED', employeeId: request.employeeId, requestId: request.id, keyAlgorithm: candidate.keyAlgorithm, credentialFingerprint: candidate.credentialFingerprint } }, tx);
      return safeEnrollment(candidate);
    });
  }

  async function listRequests({ actor, status = 'PENDING_APPROVAL' }) {
    assertAdmin(actor);
    const rows = await prisma.attendanceDeviceChangeRequest.findMany({ where: status ? { status } : {}, include: { candidateDevice: true }, orderBy: { createdAt: 'asc' } });
    return rows.map(safeRequest);
  }

  async function approve({ actor, requestId, comment = null }) {
    assertAdmin(actor);
    const now = clock();
    try {
      return await prisma.$transaction(async (tx) => {
        const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
        if (!request) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
        if (request.status !== 'PENDING_APPROVAL') throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only pending device requests can be approved.');
        if (!request.employee.isActive || request.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot activate an Attendance device.');
        if (request.candidateDevice.status !== 'PENDING_APPROVAL' || !request.candidateDevice.proofVerifiedAt) throw http(409, 'ATTENDANCE_DEVICE_PROOF_REQUIRED', 'Verified device-key proof is required before approval.');
        const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', reviewedByUserId: actor.sub, reviewedAt: now, reviewerComment: cleanText(comment) } });
        if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Attendance device request was already reviewed.');
        const active = await tx.attendanceDeviceEnrollment.findFirst({ where: { employeeId: request.employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
        if (request.requestType === 'INITIAL' && active) throw http(409, 'ATTENDANCE_DEVICE_STALE_REQUEST', 'An active device already exists.');
        if (request.requestType === 'REPLACEMENT' && (!active || active.id !== request.currentDeviceEnrollmentId)) throw http(409, 'ATTENDANCE_DEVICE_STALE_REQUEST', 'The active device changed after this request was submitted.');
        if (active) await tx.attendanceDeviceEnrollment.update({ where: { id: active.id }, data: { status: 'REVOKED', revokedAt: now, revokedReason: 'ADMIN_APPROVED_REPLACEMENT' } });
        const candidate = await tx.attendanceDeviceEnrollment.update({ where: { id: request.candidateDeviceEnrollmentId }, data: { status: 'ACTIVE', activatedAt: now, approvedByUserId: actor.sub, revokedAt: null, revokedReason: null } });
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'FINAL_APPROVE', requestType: request.requestType, employeeId: request.employeeId, previousDeviceEnrollmentId: active?.id || null, activeDeviceEnrollmentId: candidate.id, requestedByUserId: request.requestedByUserId } }, tx);
        const approved = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id }, include: { candidateDevice: true } });
        return safeRequest(approved);
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
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'RETURN_FOR_CORRECTION', employeeId: request.employeeId } }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id } }));
    });
  }

  async function resubmit({ actor, requestId, reason = null }) {
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: requestId }, include: { candidateDevice: true } });
      if (!request || request.requestedByUserId !== actor?.sub) throw http(404, 'ATTENDANCE_DEVICE_REQUEST_NOT_FOUND', 'Attendance device request not found.');
      const claimed = await tx.attendanceDeviceChangeRequest.updateMany({ where: { id: request.id, requestedByUserId: actor.sub, status: 'RETURNED_FOR_CORRECTION' }, data: { status: 'PENDING_APPROVAL', reason: cleanText(reason) ?? request.reason, reviewerComment: null, reviewedByUserId: null, reviewedAt: null, returnedAt: null } });
      if (claimed.count !== 1) throw http(409, 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE', 'Only returned device requests can be resubmitted.');
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'RESUBMIT', employeeId: request.employeeId, proofPreviouslyVerified: Boolean(request.candidateDevice.proofVerifiedAt), resubmittedAt: now } }, tx);
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
      await tx.attendanceDeviceEnrollment.update({ where: { id: request.candidateDeviceEnrollmentId }, data: { status: 'REJECTED', revokedAt: now, revokedReason: text } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'REJECT', employeeId: request.employeeId } }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id } }));
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
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceDeviceChangeRequest', entityId: request.id, metadata: { event: 'CANCEL', employeeId: request.employeeId } }, tx);
      return safeRequest(await tx.attendanceDeviceChangeRequest.findUnique({ where: { id: request.id } }));
    });
  }

  return { getMyState, createRequest, createProofChallenge, verifyProof, listRequests, approve, returnForCorrection, resubmit, reject, cancel };
}

module.exports = { ACTIVE_REQUEST_STATUSES, SUPPORTED_KEY_ALGORITHMS, CHALLENGE_TTL_MS, challengeHash, fingerprint, createAttendanceDeviceService };
