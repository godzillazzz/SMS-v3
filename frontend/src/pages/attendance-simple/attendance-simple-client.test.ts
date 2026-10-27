import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ attendanceAuthenticatedRequest: vi.fn() }));

vi.mock('../../attendance-auth-request', () => ({ attendanceAuthenticatedRequest: mocks.attendanceAuthenticatedRequest }));

import { attendanceSimpleErrorDetails, attendanceSimpleErrorMessage, simpleAttendanceBootstrap } from './attendance-simple-client';

describe('Attendance structured error messages', () => {
  it('localizes the outside-all-Sites geofence block using its stable server code', () => {
    expect(attendanceSimpleErrorMessage({ error: {
      code: 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE',
      message: 'Attendance location is confidently outside all active Security Site geofences.'
    } })).toBe('ตำแหน่ง GPS อยู่นอกขอบเขต Site ตามกะ แม้ชื่อสถานที่อาจแสดงตรงกัน กรุณาเปิด Precise Location แล้วลองใหม่');
  });

  it('localizes the remaining safe attendance diagnostics', () => {
    expect(attendanceSimpleErrorMessage({ code: 'ATTENDANCE_SITE_REQUIRED' })).toContain('ไม่พบ Site');
    expect(attendanceSimpleErrorMessage({ code: 'ATTENDANCE_LOCATION_CAPTURED_AT_INVALID' })).toContain('เวลาที่จับตำแหน่ง GPS');
    expect(attendanceSimpleErrorMessage({ code: 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT' })).toContain('ไม่แม่นยำพอ');
    expect(attendanceSimpleErrorMessage({ code: 'ATTENDANCE_LOCATION_STALE' })).toContain('หมดอายุ');
    expect(attendanceSimpleErrorMessage({ code: 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED' })).toContain('ระบบเก็บภาพยืนยันตัวตน');
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

  it('shows the employee-link explanation when bootstrap returns its specific 403 code', async () => {
    mocks.attendanceAuthenticatedRequest.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', message: 'A linked employee account is required.' }
    }), { status: 403, headers: { 'content-type': 'application/json' } }));

    await expect(simpleAttendanceBootstrap('test-token')).rejects.toMatchObject({
      name: 'AttendanceSimpleRequestError',
      code: 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED',
      message: 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ'
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

  it('turns code-less failures into status diagnostics instead of a bare Request ID', () => {
    expect(attendanceSimpleErrorDetails({ error: 'Validation failed: device.signals (Required)', requestId: '8333a3d5-fcb0-4b98-bb13-f0dba4757424' }, 400))
      .toEqual(expect.objectContaining({ code: 'ATTENDANCE_REQUEST_INVALID', requestId: '8333a3d5-fcb0-4b98-bb13-f0dba4757424' }));
    expect(attendanceSimpleErrorDetails({ error: 'Internal server error.' }, 500)).toMatchObject({ code: 'HTTP_500', message: expect.stringContaining('ระบบขัดข้อง') });
    expect(attendanceSimpleErrorDetails({ error: 'Database unavailable.' }, 503)).toMatchObject({ code: 'HTTP_503' });
    expect(attendanceSimpleErrorDetails({}, 413)).toMatchObject({ code: 'HTTP_413' });
    expect(attendanceSimpleErrorDetails({}, 403).message).toContain('ไม่มีสิทธิ์');
  });

  it('keeps the public server code ahead of any status diagnostic', () => {
    expect(attendanceSimpleErrorDetails({ code: 'ATTENDANCE_CHECK_IN_TOO_EARLY' }, 422)).toMatchObject({ code: 'ATTENDANCE_CHECK_IN_TOO_EARLY', message: 'ยังไม่ถึงช่วงเวลาที่อนุญาตให้ลงเวลาเข้า' });
    expect(attendanceSimpleErrorDetails({ code: 'ATTENDANCE_CONTEXT_STALE' }, 409)).toMatchObject({ code: 'ATTENDANCE_CONTEXT_STALE' });
    expect(attendanceSimpleErrorDetails({})).toEqual({ message: 'ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน' });
  });
});
