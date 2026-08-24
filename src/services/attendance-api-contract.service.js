'use strict';

const { createAttendanceVerificationContextService } = require('./attendance-verification-context.service');
const { createAttendanceEventService } = require('./attendance-event.service');
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
    attendanceContext: result?.attendanceContext || null
  };
}

function createAttendanceApiContractService({
  verificationContextService = null,
  attendanceEventService = null,
  isBiometricRuntimeEnabled = () => false
} = {}) {
  const verification = verificationContextService || createAttendanceVerificationContextService();
  const events = attendanceEventService || createAttendanceEventService({ verificationContextService: verification });

  function runtimeEnabled() {
    try {
      return isBiometricRuntimeEnabled() === true;
    } catch {
      return false;
    }
  }

  async function assessReadiness({ actor, captureId, eventIntent, attendanceEvidence } = {}) {
    if (!runtimeEnabled()) {
      return { ok: true, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }) };
    }
    try {
      await verification.prepareContext({ actor, captureId, eventIntent, attendanceEvidence });
      return { ok: true, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true }) };
    } catch (error) {
      return { ok: false, readiness: mapAttendanceDomainOutcome(error) };
    }
  }

  async function beginVerification({ actor, captureId, eventIntent, attendanceEvidence } = {}) {
    if (!runtimeEnabled()) {
      return { ok: false, readiness: serverRuntimeReadiness({ serverRuntimeEnabled: false }), verification: null };
    }
    try {
      const result = await verification.prepareVerification({ actor, captureId, eventIntent, attendanceEvidence });
      return {
        ok: true,
        readiness: serverRuntimeReadiness({ serverRuntimeEnabled: true }),
        verification: safeVerificationStart(result)
      };
    } catch (error) {
      return { ok: false, readiness: mapAttendanceDomainOutcome(error), verification: null };
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
    acceptVerifiedEvent
  };
}

module.exports = {
  safeVerificationStart,
  createAttendanceApiContractService
};
