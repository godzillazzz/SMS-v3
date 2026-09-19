export type AttendancePolicyForm = {
  qrPolicy: 'ADAPTIVE' | 'REQUIRED' | 'DISABLED';
  maxAccuracyMeters: number;
  maxAgeSeconds: number;
  futureSkewSeconds: number;
  autoPassAccuracyMeters: number;
  innerMarginMeters: number;
  stepUpOnSiteOverlap: boolean;
};

export const attendancePolicyKeys = {
  qrPolicy: 'ATTENDANCE_QR_POLICY',
  maxAccuracyMeters: 'ATTENDANCE_GPS_MAX_ACCURACY_METERS',
  maxAgeSeconds: 'ATTENDANCE_GPS_MAX_AGE_SECONDS',
  futureSkewSeconds: 'ATTENDANCE_GPS_FUTURE_SKEW_SECONDS',
  autoPassAccuracyMeters: 'ATTENDANCE_GPS_AUTO_PASS_ACCURACY_METERS',
  innerMarginMeters: 'ATTENDANCE_GEOFENCE_INNER_MARGIN_METERS',
  stepUpOnSiteOverlap: 'ATTENDANCE_QR_STEP_UP_ON_SITE_OVERLAP'
} as const;

export const defaultAttendancePolicy: AttendancePolicyForm = {
  qrPolicy: 'ADAPTIVE',
  maxAccuracyMeters: 50,
  maxAgeSeconds: 180,
  futureSkewSeconds: 30,
  autoPassAccuracyMeters: 20,
  innerMarginMeters: 20,
  stepUpOnSiteOverlap: true
};
