'use strict';

function productionAttendanceEnabled(environment = process.env) {
  return environment.VERCEL_ENV === 'production' && environment.ATTENDANCE_API_PRODUCTION_ENABLED === 'true';
}

function previewAttendanceEnabled(environment = process.env) {
  return environment.VERCEL_ENV === 'preview' && environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
}

function attendanceRuntimeEnabled(environment = process.env) {
  return productionAttendanceEnabled(environment) || previewAttendanceEnabled(environment);
}

function productionVerifierReady(environment = process.env) {
  if (!productionAttendanceEnabled(environment)) return true;
  if (environment.FACE_VERIFICATION_SELF_HOSTED_API_ENABLED !== 'true') return false;
  const token = String(environment.FACE_VERIFIER_SHARED_TOKEN || '').trim();
  if (token.length < 16 || token.length > 4096) return false;
  try {
    return new URL(String(environment.FACE_VERIFIER_URL || '').trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

function assertProductionAttendanceRuntime(environment = process.env) {
  if (!productionAttendanceEnabled(environment)) return { enabled: false, production: environment.VERCEL_ENV === 'production' };
  if (!productionVerifierReady(environment)) {
    const error = new Error('Attendance Production runtime is enabled but trusted face verifier configuration is incomplete.');
    error.code = 'ATTENDANCE_PRODUCTION_RUNTIME_INVALID';
    throw error;
  }
  return { enabled: true, production: true };
}

module.exports = {
  productionAttendanceEnabled,
  previewAttendanceEnabled,
  attendanceRuntimeEnabled,
  productionVerifierReady,
  assertProductionAttendanceRuntime
};
