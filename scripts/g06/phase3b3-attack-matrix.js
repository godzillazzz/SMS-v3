'use strict';

const PROVIDER_RUNTIME_STATE = 'PAUSED';
const PROVIDER_EMPIRICAL_STATUS = 'NOT_EXECUTED_PROVIDER_PAUSED';

const scenarios = Object.freeze([
  {
    id: 'ATK-01',
    name: 'Genuine Employee + ACTIVE device + valid context',
    requiredResult: 'PASS',
    category: 'GENUINE_CONTROL',
    backendContract: 'TRUSTED_PROVIDER_PASS_REQUIRED',
    acceptedFailureCodes: [],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.integration.test.js', 'attendance-event-workflow.integration.test.js']
  },
  {
    id: 'ATK-02',
    name: 'Color printed Reference Photo',
    requiredResult: 'PAD FAIL',
    category: 'PRESENTATION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE',
    acceptedFailureCodes: ['LIVENESS_FAILED'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-03',
    name: 'High-quality/glossy printed photo',
    requiredResult: 'PAD FAIL',
    category: 'PRESENTATION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE',
    acceptedFailureCodes: ['LIVENESS_FAILED'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-04',
    name: 'Photo displayed on another phone',
    requiredResult: 'PAD FAIL',
    category: 'PRESENTATION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE',
    acceptedFailureCodes: ['LIVENESS_FAILED'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-05',
    name: 'Photo displayed on tablet/monitor',
    requiredResult: 'PAD FAIL',
    category: 'PRESENTATION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE',
    acceptedFailureCodes: ['LIVENESS_FAILED'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-06',
    name: 'Prerecorded face video',
    requiredResult: 'PAD/INJECTION FAIL',
    category: 'PRESENTATION_OR_INJECTION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE_OR_INJECTION_TRUE',
    acceptedFailureCodes: ['LIVENESS_FAILED', 'CAPTURE_INJECTION_RISK'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-07',
    name: 'Video with blink/head movement',
    requiredResult: 'PAD/INJECTION FAIL',
    category: 'PRESENTATION_OR_INJECTION_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_PAD_FALSE_OR_INJECTION_TRUE',
    acceptedFailureCodes: ['LIVENESS_FAILED', 'CAPTURE_INJECTION_RISK'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-08',
    name: 'Wrong live person',
    requiredResult: 'FACE MATCH FAIL',
    category: 'IDENTITY_ATTACK',
    backendContract: 'NO_RECEIPT_WHEN_FACE_MATCH_FALSE',
    acceptedFailureCodes: ['FACE_MATCH_FAILED'],
    empiricalProviderRequired: true,
    backendEvidence: ['face-verification-session.test.js']
  },
  {
    id: 'ATK-09',
    name: 'Correct face on revoked/wrong device',
    requiredResult: 'DEVICE AUTHORITY FAIL',
    category: 'DEVICE_AUTHORITY_ATTACK',
    backendContract: 'ACTIVE_DEVICE_AND_DEVICE_KEY_BINDING_REQUIRED',
    acceptedFailureCodes: ['ATTENDANCE_DEVICE_REQUIRED', 'ATTENDANCE_DEVICE_AUTHORITY_CONFLICT', 'DEVICE_PROOF_FAILED', 'VERIFICATION_STALE'],
    empiricalProviderRequired: false,
    backendEvidence: ['attendance-device-enrollment.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-10',
    name: 'Replayed device challenge',
    requiredResult: 'REPLAY FAIL',
    category: 'REPLAY_ATTACK',
    backendContract: 'DEVICE_CHALLENGE_SINGLE_USE',
    acceptedFailureCodes: ['ATTENDANCE_DEVICE_CHALLENGE_INVALID', 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-11',
    name: 'Replayed biometric receipt',
    requiredResult: 'REPLAY FAIL',
    category: 'REPLAY_ATTACK',
    backendContract: 'OPAQUE_RECEIPT_SINGLE_USE',
    acceptedFailureCodes: ['VERIFICATION_REPLAYED'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-session.integration.test.js', 'attendance-event-workflow.integration.test.js']
  },
  {
    id: 'ATK-12',
    name: 'Reference Photo replaced mid-session',
    requiredResult: 'STALE FAIL',
    category: 'AUTHORITY_DRIFT_ATTACK',
    backendContract: 'REFERENCE_PHOTO_SNAPSHOT_REVALIDATED',
    acceptedFailureCodes: ['VERIFICATION_STALE'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-13',
    name: 'Device replaced/revoked mid-session',
    requiredResult: 'STALE FAIL',
    category: 'AUTHORITY_DRIFT_ATTACK',
    backendContract: 'DEVICE_SNAPSHOT_REVALIDATED',
    acceptedFailureCodes: ['VERIFICATION_STALE', 'ATTENDANCE_DEVICE_REQUIRED', 'ATTENDANCE_DEVICE_AUTHORITY_CONFLICT'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-session.test.js', 'face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-14',
    name: 'Expired verification session',
    requiredResult: 'EXPIRED FAIL',
    category: 'TIME_WINDOW_ATTACK',
    backendContract: 'SESSION_AND_RECEIPT_TTL_ENFORCED',
    acceptedFailureCodes: ['VERIFICATION_EXPIRED'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-session.integration.test.js']
  },
  {
    id: 'ATK-15',
    name: 'Correct face/device outside geofence',
    requiredResult: 'LOCATION FAIL',
    category: 'LOCATION_CONTEXT_ATTACK',
    backendContract: 'SERVER_SIDE_GEOFENCE_REQUIRED',
    acceptedFailureCodes: ['ATTENDANCE_OUTSIDE_SITE_GEOFENCE'],
    empiricalProviderRequired: false,
    backendEvidence: ['attendance-site-evidence.test.js', 'attendance-verification-context.integration.test.js']
  },
  {
    id: 'ATK-16',
    name: 'Correct face/device with wrong site QR/context',
    requiredResult: 'SITE CONTEXT FAIL',
    category: 'SITE_CONTEXT_ATTACK',
    backendContract: 'SERVER_SIDE_SITE_QR_CONTEXT_REQUIRED',
    acceptedFailureCodes: ['ATTENDANCE_QR_INVALID', 'ATTENDANCE_QR_REVOKED', 'VERIFICATION_CONTEXT_MISMATCH'],
    empiricalProviderRequired: false,
    backendEvidence: ['attendance-site-evidence.test.js', 'attendance-verification-context.integration.test.js']
  },
  {
    id: 'ATK-17',
    name: 'Provider unavailable/timeout',
    requiredResult: 'FAIL CLOSED / controlled retry',
    category: 'PROVIDER_AVAILABILITY_FAILURE',
    backendContract: 'NO_FALLBACK_PASS_ON_PROVIDER_FAILURE',
    acceptedFailureCodes: ['VERIFICATION_PROVIDER_UNAVAILABLE'],
    empiricalProviderRequired: false,
    backendEvidence: ['face-verification-provider-poc.test.js']
  }
]);

function summarizeAttackMatrix() {
  const empiricalProviderCases = scenarios.filter((scenario) => scenario.empiricalProviderRequired).length;
  return {
    phase: 'G06_PHASE_3B_3',
    providerRuntime: PROVIDER_RUNTIME_STATE,
    totalScenarios: scenarios.length,
    backendContractScenarios: scenarios.length,
    empiricalProviderCases,
    empiricalExecuted: 0,
    empiricalPassed: 0,
    empiricalStatus: PROVIDER_EMPIRICAL_STATUS,
    status: 'ARCHITECTURE_READY_PROVIDER_EXECUTION_NOT_STARTED'
  };
}

function plannedEvidenceRows() {
  return scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    scenario: scenario.name,
    requiredResult: scenario.requiredResult,
    category: scenario.category,
    backendContract: scenario.backendContract,
    backendEvidence: [...scenario.backendEvidence],
    empiricalProviderRequired: scenario.empiricalProviderRequired,
    empiricalStatus: scenario.empiricalProviderRequired ? PROVIDER_EMPIRICAL_STATUS : 'NOT_REQUIRED_FOR_BACKEND_CONTROL'
  }));
}

module.exports = {
  PROVIDER_RUNTIME_STATE,
  PROVIDER_EMPIRICAL_STATUS,
  scenarios,
  summarizeAttackMatrix,
  plannedEvidenceRows
};
