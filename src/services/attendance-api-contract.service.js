'use strict';

const { createAttendanceVerificationContextService } = require('./attendance-verification-context.service');
const { createAttendanceEventService } = require('./attendance-event.service');
const { createAttendanceFaceVerificationService } = require('./attendance-face-verification.service');
const {
  serverRuntimeReadiness,
  mapAttendanceDomainOutcome
} = require('./attendance-readiness-state.service');
const { GEOFENCE_ONLY_UAT_MODE, GEOFENCE_ONLY_UAT_EMPLOYEE_CODE } = require('./attendance-geofence-only-uat-receipt.service');

function safeVerificationStart(result) {
  const session = result?.session || {};
  const verificationMode = result?.verificationMode === GEOFENCE_ONLY_UAT_MODE ? GEOFENCE_ONLY_UAT_MODE : 'BIOMETRIC';
  return {
    verificationMode,
    sessionId: session.id || null,
    deviceEnrollmentId: session.deviceEnrollmentId || null,
    status: session.status || null,
    expiresAt: session.expiresAt || null,
    challengeId: result?.challengeId || null,
    challenge: result?.challenge || null,
    attendanceContext: result?.attendanceContext || null,
    activeChallenge: verificationMode === GEOFENCE_ONLY_UAT_MODE ? null : (result?.activeChallenge || null)
  };
}

function createAttendanceApiContractService({
  verificationContextService = null,
  attendanceEventService = null,
  faceVerificationService = null,
  isBiometricRuntimeEnabled = () => false,
  isGeofenceOnlyUatEnabled = () => false
} = {}) {
  const verification = verificationContextService || createAttendanceVerificationContextService({ isGeofenceOnlyUatEnabled });
  const events = attendanceEventService || createAttendanceEventService({ verificationContextService: verification });
  const face = faceVerificationService || createAttendanceFaceVerificationService();

  function runtimeEnabled() {
    try {
      return isBiometricRuntimeEnabled() === true;
    } catch {
      return false;
    }
  }

  function geofenceOnlyUatEnabled() {
    try { return isGeofenceOnlyUatEnabled() === true; } catch { return false; }
  }

  async function geofenceOnlyUatActor(actor) {
    if (!geofenceOnlyUatEnabled() || typeof verification.isGeofenceOnlyUatActor !== 'function') return false;
    try { return await verification.isGeofenceOnlyUatActor({ actor }) === true; } catch { return false; }
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
    const biometricEnabled = runtimeEnabled();
    const uatActor = await geofenceOnlyUatActor(actor);
    if (!biometricEnabled && !uatActor) {
      return { ok: true, eventIntent: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      const resolvedIntent = await resolveServerIntent(actor);
      await verification.prepareContext({ actor, captureId, eventIntent: resolvedIntent.eventIntent, attendanceEvidence });
      return {
        ok: true,
        eventIntent: resolvedIntent.eventIntent,
        readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true }),
        ...(uatActor ? { verificationMode: GEOFENCE_ONLY_UAT_MODE } : {})
      };
    } catch (error) {
      return { ok: false, eventIntent: null, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  async function beginVerification({ actor, captureId, attendanceEvidence } = {}) {
    const biometricEnabled = runtimeEnabled();
    const uatActor = await geofenceOnlyUatActor(actor);
    if (!biometricEnabled && !uatActor) {
      return { ok: false, eventIntent: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }), verification: null };
    }
    try {
      const result = await verification.prepareVerification({ actor, captureId, attendanceEvidence });
      const controlledUat = uatActor
        && result.employeeCode === GEOFENCE_ONLY_UAT_EMPLOYEE_CODE
        && geofenceOnlyUatEnabled();
      if (!biometricEnabled && !controlledUat) {
        return { ok: false, eventIntent: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }), verification: null };
      }
      return {
        ok: true,
        eventIntent: result.eventIntent || null,
        readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true }),
        verification: safeVerificationStart({ ...result, verificationMode: controlledUat ? GEOFENCE_ONLY_UAT_MODE : 'BIOMETRIC' })
      };
    } catch (error) {
      return { ok: false, eventIntent: null, readiness: mapAttendanceDomainOutcome(error), verification: null };
    }
  }

  async function verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 } = {}) {
    if (!runtimeEnabled() && !(await geofenceOnlyUatActor(actor))) {
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

  async function issueGeofenceOnlyUatEventReceipt({ actor, sessionId, attendanceContext } = {}) {
    if (!(await geofenceOnlyUatActor(actor)) || typeof verification.issueGeofenceOnlyUatReceipt !== 'function') {
      return { ok: false, receipt: null, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      const result = await verification.issueGeofenceOnlyUatReceipt({ actor, sessionId, attendanceContext });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, receipt: null, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  return {
    assessReadiness,
    beginVerification,
    verifyDeviceProof,
    verifyLiveFace,
    issueGeofenceOnlyUatEventReceipt,
    acceptVerifiedEvent
  };
}

module.exports = {
  safeVerificationStart,
  createAttendanceApiContractService
};
