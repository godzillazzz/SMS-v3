import { describe, expect, it } from 'vitest';
import { attendanceObservationLabels, attendanceOperationalLabels, attendanceTimeLabels } from './attendance-time-labels';

describe('Attendance time policy labels', () => {
  it('keeps support Site, foreign device, and lateness as distinct observations', () => {
    expect(attendanceObservationLabels({
      punctuality: 'LATE',
      flags: ['ASSIST_OTHER_SITE', 'DEVICE_MISMATCH', 'LATE']
    })).toEqual(['ช่วยปฏิบัติงาน', 'ใช้อุปกรณ์อื่น · ตรวจสอบ', 'มาสาย']);
  });

  it('shows missing checkout and abnormal time separately', () => {
    expect(attendanceTimeLabels({
      checkoutCondition: 'MISSING_CHECK_OUT',
      abnormalTime: true,
      abnormalReasons: ['MISSING_CHECK_OUT'],
      flags: ['MISSING_CHECK_OUT', 'TIME_ABNORMAL']
    })).toEqual(['ไม่ได้ลงเวลาออก', 'เวลาผิดปกติ']);
  });

  it('separates time status from operational observations', () => {
    const row = { punctuality: 'LATE', flags: ['ASSIST_OTHER_SITE', 'DEVICE_MISMATCH', 'LATE'] };
    expect(attendanceTimeLabels(row)).toEqual(['มาสาย']);
    expect(attendanceOperationalLabels(row)).toEqual(['ช่วยปฏิบัติงาน', 'ใช้อุปกรณ์อื่น · ตรวจสอบ']);
  });
});
