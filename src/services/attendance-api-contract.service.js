'use strict';

const { createAttendanceVerificationContextService } = require('./attendance-verification-context.service');
const { createAttendanceEventService } = require('./attendance-event.service');
const { createAttendanceFaceVerificationService } = require('./attendance-face-verification.service');
const {
  serverRuntimeReadiness,
  mapAttendanceDomainOutcome
} = require('./attendance-readiness-state.service');

function safeVerificationStart(result) {
  const session = result?.session || {};
  return {
    sessionId: session.id || null,
    status: session.status || null,
    expiresAt: session.expiresAt || null,
    challengeId: result?.challengeId || null,
    challenge: result?.challenge || null,
    attendanceContext: result?.attendanceContext || null,
    activeChallenge: result?.activeChallenge || null
  };
}

function createAttendanceApiContractService({
  verificationContextService = null,
  attendanceEventService = null,
  faceVerificationService = null,
  isBiometricRuntimeEnabled = () => false
} = {}) {
  const verification = verificationContextService || createAttendanceVerificationContextService();
  const events = attendanceEventService || createAttendanceEventService({ verificationContextService: verification });
  const face = faceVerificationService || createAttendanceFaceVerificationService();

  function runtimeEnabled() {
    try {
      return isBiometricRuntimeEnabled() === true;
    } catch {
      return false;
    }
  }

  async function resolveServerIntent(actor) {
    if (typeof verification.resolveEventIntent !== 'function') {
      const error = new Error('Attendance server intent resolver is unavailable.');
      error.details = { code: 'ATTENDANCE_INTENT_RESOLVER_UNAVAILABLE' };
      throw error;
    }
    return verification.resolveEventIntent({ actor });
  }

  async function assessReadiness({ actor, captureId, attendanceEvidence } = {}) {
    if (!runtimeEnabled()) {
      return { ok: true, eventIntent: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      const resolvedIntent = await resolveServerIntent(actor);
      await verification.prepareContext({ actor, captureId, eventIntent: resolvedIntent.eventIntent, attendanceEvidence });
      return {
        ok: true,
        eventIntent: resolvedIntent.eventIntent,
        readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true })
      };
    } catch (error) {
      return { ok: false, eventIntent: null, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  async function beginVerification({ actor, captureId, attendanceEvidence } = {}) {
    if (!runtimeEnabled()) {
      return { ok: false, eventIntent: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }), verification: null };
    }
    try {
      const resolvedIntent = await resolveServerIntent(actor);
      const result = await verification.prepareVerification({ actor, captureId, eventIntent: resolvedIntent.eventIntent, attendanceEvidence });
      return {
        ok: true,
        eventIntent: resolvedIntent.eventIntent,
        readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true }),
        verification: safeVerificationStart(result)
      };
    } catch (error) {
      return { ok: false, eventIntent: null, readiness: mapAttendanceDomainOutcome(error), verification: null };
    }
  }

  async function verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 } = {}) {
    if (!runtimeEnabled()) {
      return { ok: false, verificationReady: false, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      const result = await face.verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, verificationReady: false, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  async function verifyLiveFace({ actor, sessionId, livePhotoFile, challengeFrameFiles } = {}) {
    if (!runtimeEnabled()) {
      return { ok: false, verificationAccepted: false, receipt: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      const result = await face.verifyLiveFace({ actor, sessionId, livePhotoFile, challengeFrameFiles });
      if (result.verificationAccepted !== true || !result.receipt) {
        return { ok: false, verificationAccepted: false, receipt: null, evidence: result.evidence || null, readiness: mapAttendanceDomainOutcome(result.domainCode || 'FACE_MATCH_FAILED') };
      }
      return { ok: true, verificationAccepted: true, receipt: result.receipt, receiptExpiresAt: result.receiptExpiresAt || null, evidence: result.evidence || null };
    } catch (error) {
      return { ok: false, verificationAccepted: false, receipt: null, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  async function acceptVerifiedEvent({ actor, receipt, attendanceContext } = {}) {
    try {
      const result = await events.acceptVerifiedEvent({ actor, receipt, attendanceContext });
      return {
        ok: true,
        attendanceAccepted: true,
        idempotent: result.idempotent === true,
        event: result.event,
        session: result.session
      };
    } catch (error) {
      return {
        ok: false,
        attendanceAccepted: false,
        readiness: mapAttendanceDomainOutcome(error)
      };
    }
  }

  return {
    assessReadiness,
    beginVerification,
    verifyDeviceProof,
    verifyLiveFace,
    acceptVerifiedEvent
  };
}

module.exports = {
  safeVerificationStart,
  createAttendanceApiContractService
};
