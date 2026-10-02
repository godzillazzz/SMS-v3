import { describe, expect, it } from 'vitest';
import { attendanceSimpleErrorMessage } from './attendance-simple-client';

describe('Attendance structured error messages', () => {
  it('localizes the outside-all-Sites geofence block using its stable server code', () => {
    expect(attendanceSimpleErrorMessage({ error: {
      code: 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE',
      message: 'Attendance location is confidently outside all active Security Site geofences.'
    } })).toBe('ไม่สามารถลงเวลาได้ เนื่องจากอยู่นอกพื้นที่ทำงานที่กำหนด');
  });

  it('uses structured time-policy and missing-schedule messages before generic server text', () => {
    expect(attendanceSimpleErrorMessage({ error: { code: 'ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED' } }))
      .toBe('ไม่สามารถลงเวลาเข้าได้ เนื่องจากเกินช่วงเวลาที่กำหนด');
    expect(attendanceSimpleErrorMessage({ error: { code: 'ATTENDANCE_SCHEDULE_NOT_APPROVED' } }))
      .toBe('ไม่พบกะงานที่ได้รับอนุมัติ');
  });
});
