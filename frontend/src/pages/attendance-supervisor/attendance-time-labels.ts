export type AttendanceTimeRow = {
  punctuality?: string | null;
  checkoutCondition?: string | null;
  abnormalTime?: boolean;
  abnormalReasons?: string[];
  flags?: string[];
};

const flagLabels: Record<string, string> = {
  ON_TIME: 'ตรงเวลา',
  LATE: 'มาสาย',
  EARLY_OUT: 'ออกก่อนเวลา',
  MISSING_CHECK_OUT: 'ไม่ได้ลงเวลาออก',
  MISSING_CHECK_IN: 'ไม่ได้ลงเวลาเข้า',
  TIME_ABNORMAL: 'เวลาผิดปกติ',
  ASSIST_OTHER_SITE: 'ช่วยปฏิบัติงาน',
  DEVICE_MISMATCH: 'ใช้อุปกรณ์อื่น · ตรวจสอบ',
  DEVICE_MOVE_PENDING: 'รออนุมัติย้ายเครื่อง',
  OUTSIDE_ALL_SITES: 'นอกพื้นที่ทำงาน',
  WRONG_SHIFT: 'ลงเวลาผิดกะ',
  CORRECTED: 'มีการแก้ไขตามกระบวนการ'
};

const abnormalReasonLabels: Record<string, string> = {
  MISSING_CHECK_OUT: 'ไม่ได้ลงเวลาออก',
  MAX_SHIFT_DURATION_EXCEEDED: 'เกินเวลากะสูงสุด',
  CHECK_OUT_BEFORE_CHECK_IN: 'ลำดับเวลาเข้าออกไม่ถูกต้อง'
};

export function attendanceFlagLabel(flag: string) {
  return flagLabels[flag] || flag;
}

export function attendanceTimeLabels(row: AttendanceTimeRow) {
  const labels: string[] = [];
  if (row.punctuality === 'LATE') labels.push('มาสาย');
  else if (row.punctuality === 'ON_TIME') labels.push('ตรงเวลา');
  if (row.checkoutCondition === 'EARLY_LEAVE') labels.push('ออกก่อนเวลา');
  else if (row.checkoutCondition === 'MISSING_CHECK_OUT') labels.push('ไม่ได้ลงเวลาออก');
  if (row.abnormalTime) labels.push('เวลาผิดปกติ');
  for (const reason of row.abnormalReasons || []) {
    labels.push(abnormalReasonLabels[reason] || 'เวลาผิดปกติ');
  }
  for (const flag of row.flags || []) {
    if (['ON_TIME', 'LATE', 'EARLY_OUT', 'MISSING_CHECK_OUT', 'MISSING_CHECK_IN', 'TIME_ABNORMAL'].includes(flag)) {
      labels.push(attendanceFlagLabel(flag));
    }
  }
  return [...new Set(labels)];
}

export function attendanceObservationLabels(row: AttendanceTimeRow) {
  return [...new Set([
    ...(row.flags || []).map(attendanceFlagLabel),
    ...attendanceTimeLabels(row)
  ])];
}

const timeFlags = new Set(['ON_TIME', 'LATE', 'EARLY_OUT', 'MISSING_CHECK_OUT', 'MISSING_CHECK_IN', 'TIME_ABNORMAL']);

export function attendanceOperationalLabels(row: AttendanceTimeRow) {
  return [...new Set((row.flags || []).filter((flag) => !timeFlags.has(flag)).map(attendanceFlagLabel))];
}
