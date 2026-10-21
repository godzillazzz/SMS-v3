'use strict';

/**
 * Attendance API exposure policy shared by the Attendance route families.
 * Self-hosted production is identified by the deliberate absence of VERCEL_ENV;
 * it must never inherit Vercel Preview behavior or any UAT-only route.
 */
function attendanceApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') {
    return environment.ATTENDANCE_API_PRODUCTION_ENABLED === 'true';
  }
  if (environment.VERCEL_ENV === 'preview') {
    return environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
  }
  return environment.VERCEL_ENV == null
    && environment.NODE_ENV === 'production'
    && environment.SELF_HOSTED_ATTENDANCE_API_ENABLED === 'true';
}

module.exports = { attendanceApiEnabled };
