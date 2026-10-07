import { describe, expect, it } from 'vitest';
import { attendanceSimpleErrorDetails, attendanceSimpleErrorMessage } from './attendance-simple-client';

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
      .toBe('ตารางกะยังไม่ได้รับอนุมัติ กรุณาติดต่อหัวหน้างาน');
  });

  it('reads public error codes and request ids from the API response shape', () => {
    expect(attendanceSimpleErrorDetails({
      error: 'A linked employee account is required.',
      code: 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED',
      requestId: 'a1492eb7-60ac-4ad8-9990-e9f80bb963a9'
    })).toEqual({
      message: 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ',
      code: 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED',
      requestId: 'a1492eb7-60ac-4ad8-9990-e9f80bb963a9'
    });
  });

  it('explains device setup and pending approval without exposing server text', () => {
    expect(attendanceSimpleErrorMessage({ error: 'No active Attendance device.', code: 'ATTENDANCE_DEVICE_REQUIRED' }))
      .toBe('ยังไม่มีอุปกรณ์ลงเวลาที่ลงทะเบียนแล้ว กรุณาลงทะเบียนเครื่องนี้ก่อน');
    expect(attendanceSimpleErrorMessage({ error: 'An inactive device requires ADMIN approval.', code: 'ATTENDANCE_DEVICE_NOT_ALLOWED' }))
      .toBe('อุปกรณ์ลงเวลานี้ต้องรอผู้ดูแลอนุมัติก่อนใช้งาน');
    expect(attendanceSimpleErrorMessage({ error: 'Internal server error.', code: 'UNRECOGNIZED_ATTENDANCE_FAILURE' }))
      .toBe('ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน');
  });
});
