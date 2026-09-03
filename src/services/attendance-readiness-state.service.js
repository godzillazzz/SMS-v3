'use strict';

const BASE = Object.freeze({
  attendanceAccepted: false,
  authority: 'SERVER_DOMAIN_OUTCOME_ONLY'
});

const STATES = Object.freeze({
  BIOMETRIC_RUNTIME_DISABLED: Object.freeze({ state: 'BIOMETRIC_RUNTIME_DISABLED', blocking: true, retryable: false, action: 'WAIT_FOR_PROVIDER_ACTIVATION', messageKey: 'attendance.biometric_runtime_disabled' }),
  READY_TO_START_VERIFICATION: Object.freeze({ state: 'READY_TO_START_VERIFICATION', blocking: false, retryable: true, action: 'START_VERIFICATION', messageKey: 'attendance.ready_to_start_verification' }),
  ACCOUNT_NOT_ELIGIBLE: Object.freeze({ state: 'ACCOUNT_NOT_ELIGIBLE', blocking: true, retryable: false, action: 'CONTACT_ADMIN', messageKey: 'attendance.account_not_eligible' }),
  DEVICE_SETUP_REQUIRED: Object.freeze({ state: 'DEVICE_SETUP_REQUIRED', blocking: true, retryable: false, action: 'ENROLL_DEVICE', messageKey: 'attendance.device_setup_required' }),
  DEVICE_REVIEW_REQUIRED: Object.freeze({ state: 'DEVICE_REVIEW_REQUIRED', blocking: true, retryable: false, action: 'CONTACT_ADMIN', messageKey: 'attendance.device_review_required' }),
  DEVICE_PROOF_RETRY: Object.freeze({ state: 'DEVICE_PROOF_RETRY', blocking: true, retryable: true, action: 'RESTART_DEVICE_PROOF', messageKey: 'attendance.device_proof_retry' }),
  REFERENCE_PHOTO_REQUIRED: Object.freeze({ state: 'REFERENCE_PHOTO_REQUIRED', blocking: true, retryable: false, action: 'CONTACT_ADMIN', messageKey: 'attendance.reference_photo_required' }),
  REFERENCE_PHOTO_REVIEW_REQUIRED: Object.freeze({ state: 'REFERENCE_PHOTO_REVIEW_REQUIRED', blocking: true, retryable: false, action: 'CONTACT_ADMIN', messageKey: 'attendance.reference_photo_review_required' }),
  REFERENCE_PHOTO_REPLACEMENT_REQUIRED: Object.freeze({ state: 'REFERENCE_PHOTO_REPLACEMENT_REQUIRED', blocking: true, retryable: false, action: 'CONTACT_ADMIN', messageKey: 'attendance.reference_photo_replacement_required' }),
  SCHEDULE_NOT_READY: Object.freeze({ state: 'SCHEDULE_NOT_READY', blocking: true, retryable: false, action: 'CONTACT_MANAGER', messageKey: 'attendance.schedule_not_ready' }),
  SITE_NOT_READY: Object.freeze({ state: 'SITE_NOT_READY', blocking: true, retryable: false, action: 'CONTACT_MANAGER', messageKey: 'attendance.site_not_ready' }),
  QR_STEP_UP_REQUIRED: Object.freeze({ state: 'QR_STEP_UP_REQUIRED', blocking: true, retryable: true, action: 'SCAN_CURRENT_SITE_QR', messageKey: 'attendance.qr_step_up_required' }),
  QR_RESCAN_REQUIRED: Object.freeze({ state: 'QR_RESCAN_REQUIRED', blocking: true, retryable: true, action: 'SCAN_CURRENT_SITE_QR', messageKey: 'attendance.qr_rescan_required' }),
  LOCATION_REFRESH_REQUIRED: Object.freeze({ state: 'LOCATION_REFRESH_REQUIRED', blocking: true, retryable: true, action: 'REFRESH_LOCATION', messageKey: 'attendance.location_refresh_required' }),
  OUTSIDE_SITE_GEOFENCE: Object.freeze({ state: 'OUTSIDE_SITE_GEOFENCE', blocking: true, retryable: true, action: 'MOVE_INSIDE_ASSIGNED_SITE', messageKey: 'attendance.outside_site_geofence' }),
  BIOMETRIC_TEMPORARILY_UNAVAILABLE: Object.freeze({ state: 'BIOMETRIC_TEMPORARILY_UNAVAILABLE', blocking: true, retryable: true, action: 'RETRY_LATER', messageKey: 'attendance.biometric_temporarily_unavailable' }),
  VERIFICATION_EXPIRED: Object.freeze({ state: 'VERIFICATION_EXPIRED', blocking: true, retryable: true, action: 'RESTART_VERIFICATION', messageKey: 'attendance.verification_expired' }),
  VERIFICATION_RESTART_REQUIRED: Object.freeze({ state: 'VERIFICATION_RESTART_REQUIRED', blocking: true, retryable: true, action: 'RESTART_VERIFICATION', messageKey: 'attendance.verification_restart_required' }),
  VERIFICATION_REPLAY_BLOCKED: Object.freeze({ state: 'VERIFICATION_REPLAY_BLOCKED', blocking: true, retryable: false, action: 'START_NEW_ATTENDANCE_ATTEMPT', messageKey: 'attendance.verification_replay_blocked' }),
  CONTEXT_CHANGED_RESTART: Object.freeze({ state: 'CONTEXT_CHANGED_RESTART', blocking: true, retryable: true, action: 'RESTART_ATTENDANCE', messageKey: 'attendance.context_changed_restart' }),
  LIVENESS_NOT_VERIFIED: Object.freeze({ state: 'LIVENESS_NOT_VERIFIED', blocking: true, retryable: true, action: 'RETRY_FACE_VERIFICATION', messageKey: 'attendance.liveness_not_verified' }),
  ACTIVE_CHALLENGE_RETRY: Object.freeze({ state: 'ACTIVE_CHALLENGE_RETRY', blocking: true, retryable: true, action: 'RETRY_ACTIVE_CHALLENGE', messageKey: 'attendance.active_challenge_retry' }),
  FACE_NOT_MATCHED: Object.freeze({ state: 'FACE_NOT_MATCHED', blocking: true, retryable: true, action: 'RETRY_FACE_VERIFICATION', messageKey: 'attendance.face_not_matched' }),
  SECURITY_REVIEW_REQUIRED: Object.freeze({ state: 'SECURITY_REVIEW_REQUIRED', blocking: true, retryable: false, action: 'CONTACT_ADMIN_OR_SECURITY', messageKey: 'attendance.security_review_required' }),
  ATTENDANCE_STATE_REFRESH_REQUIRED: Object.freeze({ state: 'ATTENDANCE_STATE_REFRESH_REQUIRED', blocking: true, retryable: true, action: 'REFRESH_ATTENDANCE_STATUS', messageKey: 'attendance.state_refresh_required' }),
  CHECK_IN_REQUIRED: Object.freeze({ state: 'CHECK_IN_REQUIRED', blocking: true, retryable: false, action: 'START_CHECK_IN', messageKey: 'attendance.check_in_required' }),
  ATTENDANCE_UNAVAILABLE: Object.freeze({ state: 'ATTENDANCE_UNAVAILABLE', blocking: true, retryable: false, action: 'CONTACT_SUPPORT', messageKey: 'attendance.unavailable' })
});

const CODE_TO_STATE = new Map();

function mapCodes(stateName, codes) {
  for (const code of codes) CODE_TO_STATE.set(code, stateName);
}

mapCodes('ACCOUNT_NOT_ELIGIBLE', [
  'ATTENDANCE_EMPLOYEE_LINK_REQUIRED',
  'FACE_VERIFICATION_EMPLOYEE_LINK_REQUIRED',
  'INACTIVE_EMPLOYEE_OPERATION'
]);
mapCodes('DEVICE_SETUP_REQUIRED', ['ATTENDANCE_DEVICE_REQUIRED']);
mapCodes('DEVICE_REVIEW_REQUIRED', ['ATTENDANCE_DEVICE_AUTHORITY_CONFLICT']);
mapCodes('DEVICE_PROOF_RETRY', [
  'DEVICE_PROOF_FAILED',
  'ATTENDANCE_DEVICE_CHALLENGE_INVALID',
  'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE'
]);
mapCodes('REFERENCE_PHOTO_REQUIRED', ['FACE_REFERENCE_REQUIRED']);
mapCodes('REFERENCE_PHOTO_REVIEW_REQUIRED', ['FACE_REFERENCE_AUTHORITY_CONFLICT', 'FACE_REFERENCE_STALE']);
mapCodes('REFERENCE_PHOTO_REPLACEMENT_REQUIRED', ['FACE_REFERENCE_INVALID', 'FACE_REFERENCE_NOT_NEUTRAL']);
mapCodes('SCHEDULE_NOT_READY', [
  'ATTENDANCE_ASSIGNMENT_REQUIRED',
  'ATTENDANCE_SHIFT_NOT_ACTIONABLE',
  'ATTENDANCE_SCHEDULE_NOT_APPROVED'
]);
mapCodes('SITE_NOT_READY', [
  'ATTENDANCE_SITE_REQUIRED',
  'ATTENDANCE_SITE_INACTIVE',
  'ATTENDANCE_SITE_INVALID'
]);
mapCodes('QR_STEP_UP_REQUIRED', ['ATTENDANCE_QR_STEP_UP_REQUIRED']);
mapCodes('QR_RESCAN_REQUIRED', [
  'ATTENDANCE_QR_INVALID',
  'ATTENDANCE_QR_AUTHORITY_INVALID',
  'ATTENDANCE_QR_REVOKED',
  'ATTENDANCE_QR_NOT_ACTIVE',
  'ATTENDANCE_QR_EXPIRED',
  'ATTENDANCE_QR_CREDENTIAL_INVALID'
]);
mapCodes('LOCATION_REFRESH_REQUIRED', [
  'ATTENDANCE_LOCATION_CAPTURED_AT_INVALID',
  'ATTENDANCE_LOCATION_INVALID',
  'ATTENDANCE_LOCATION_ACCURACY_INVALID',
  'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT',
  'ATTENDANCE_LOCATION_STALE',
  'ATTENDANCE_LOCATION_FROM_FUTURE',
  'ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT'
]);
mapCodes('OUTSIDE_SITE_GEOFENCE', ['ATTENDANCE_OUTSIDE_SITE_GEOFENCE']);
mapCodes('BIOMETRIC_TEMPORARILY_UNAVAILABLE', [
  'VERIFICATION_PROVIDER_UNAVAILABLE',
  'ATTENDANCE_RECEIPT_CONSUMER_UNAVAILABLE'
]);
mapCodes('VERIFICATION_EXPIRED', ['VERIFICATION_EXPIRED']);
mapCodes('VERIFICATION_RESTART_REQUIRED', ['FACE_VERIFICATION_SESSION_ALREADY_ACTIVE']);
mapCodes('VERIFICATION_REPLAY_BLOCKED', [
  'VERIFICATION_REPLAYED',
  'ATTENDANCE_CAPTURE_ID_CONFLICT'
]);
mapCodes('CONTEXT_CHANGED_RESTART', [
  'VERIFICATION_STALE',
  'VERIFICATION_CONTEXT_MISMATCH',
  'ATTENDANCE_CONTEXT_STALE',
  'ATTENDANCE_ASSIGNMENT_STALE',
  'ATTENDANCE_SCHEDULE_STALE',
  'ATTENDANCE_SITE_STALE',
  'ATTENDANCE_SESSION_STALE'
]);
mapCodes('LIVENESS_NOT_VERIFIED', ['LIVENESS_FAILED']);
mapCodes('ACTIVE_CHALLENGE_RETRY', ['ACTIVE_CHALLENGE_FAILED', 'ACTIVE_CHALLENGE_FRAMES_INVALID', 'ACTIVE_CHALLENGE_FRAME_INVALID']);
mapCodes('FACE_NOT_MATCHED', ['FACE_MATCH_FAILED']);
mapCodes('SECURITY_REVIEW_REQUIRED', [
  'CAPTURE_INJECTION_RISK',
  'VERIFICATION_PROVIDER_SESSION_MISMATCH'
]);
mapCodes('CHECK_IN_REQUIRED', ['ATTENDANCE_CHECK_IN_REQUIRED']);
mapCodes('ATTENDANCE_STATE_REFRESH_REQUIRED', [
  'ATTENDANCE_ALREADY_CHECKED_IN',
  'ATTENDANCE_ALREADY_CHECKED_OUT',
  'ATTENDANCE_SESSION_CLOSED',
  'ATTENDANCE_SESSION_INCONSISTENT',
  'ATTENDANCE_EVENT_CONFLICT',
  'FACE_VERIFICATION_STATE_CONFLICT'
]);

function publicState(stateName, reasonCode = null) {
  const preset = STATES[stateName] || STATES.ATTENDANCE_UNAVAILABLE;
  return Object.freeze({
    ...BASE,
    ...preset,
    reasonCode: typeof reasonCode === 'string' && reasonCode.length <= 100 ? reasonCode : null
  });
}

function serverRuntimeReadiness({ serverRuntimeEnabled = false } = {}) {
  return serverRuntimeEnabled === true
    ? publicState('READY_TO_START_VERIFICATION', 'SERVER_RUNTIME_ENABLED')
    : publicState('BIOMETRIC_RUNTIME_DISABLED', 'SERVER_RUNTIME_DISABLED');
}

function domainCode(value) {
  if (typeof value === 'string') return value.trim().toUpperCase();
  const code = value?.details?.code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function mapAttendanceDomainOutcome(errorOrCode) {
  const code = domainCode(errorOrCode);
  const stateName = CODE_TO_STATE.get(code) || 'ATTENDANCE_UNAVAILABLE';
  return publicState(stateName, code || 'UNKNOWN');
}

module.exports = {
  STATES,
  serverRuntimeReadiness,
  mapAttendanceDomainOutcome
};
