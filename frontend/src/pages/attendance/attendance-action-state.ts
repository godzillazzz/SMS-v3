import type { AttendanceEventIntent } from './attendance-client';

export type AttendancePrimaryActionCode =
  | 'READY'
  | 'VIEW_ONLY'
  | 'OFFLINE'
  | 'BUSY'
  | 'ATTENDANCE_COMPLETE'
  | 'LOADING'
  | 'SCHEDULE_NOT_READY';

export type AttendancePrimaryActionState = {
  code: AttendancePrimaryActionCode;
  enabled: boolean;
  actionText: string;
  actionThai: string;
  readyLine: string;
  detail: string;
};

export function attendancePrimaryActionState(input: {
  readOnly: boolean;
  online: boolean;
  busy: boolean;
  attendanceComplete: boolean;
  loading: boolean;
  scheduleReady: boolean;
  intent: AttendanceEventIntent;
}): AttendancePrimaryActionState {
  if (input.readOnly) return {
    code: 'VIEW_ONLY',
    enabled: false,
    actionText: 'อ่านอย่างเดียว',
    actionThai: 'อ่านอย่างเดียว',
    readyLine: 'โหมดดูข้อมูล · ไม่อนุญาตให้ลงเวลาแทนพนักงาน',
    detail: 'โหมดดูข้อมูลเป็นแบบอ่านอย่างเดียว จึงไม่อนุญาตให้ลงเวลาแทนพนักงาน'
  };
  if (!input.online) return {
    code: 'OFFLINE',
    enabled: false,
    actionText: 'ออฟไลน์',
    actionThai: 'ต้องเชื่อมต่อเซิร์ฟเวอร์',
    readyLine: 'ออฟไลน์ · เชื่อมต่อเซิร์ฟเวอร์ก่อนลงเวลา',
    detail: 'อุปกรณ์ออฟไลน์อยู่ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนลงเวลา'
  };
  if (input.busy) return {
    code: 'BUSY',
    enabled: false,
    actionText: 'กำลังดำเนินการ',
    actionThai: 'กำลังตรวจสอบ…',
    readyLine: 'กำลังตรวจสอบตามลำดับความปลอดภัย',
    detail: 'ระบบกำลังดำเนินการลงเวลาครั้งก่อน กรุณารอให้ขั้นตอนปัจจุบันเสร็จสิ้น'
  };
  if (input.attendanceComplete) return {
    code: 'ATTENDANCE_COMPLETE',
    enabled: false,
    actionText: 'ลงเวลาครบแล้ว',
    actionThai: 'ลงเวลาครบแล้ว',
    readyLine: 'การลงเวลาวันนี้ครบแล้ว',
    detail: 'วันนี้มีทั้งเวลาเข้าและเวลาออกครบแล้ว'
  };
  if (input.loading) return {
    code: 'LOADING',
    enabled: false,
    actionText: 'กำลังอ่านตารางงาน',
    actionThai: 'กำลังอ่านตารางงาน…',
    readyLine: 'กำลังอ่านตารางงาน…',
    detail: 'กำลังอ่านตารางงานจากเซิร์ฟเวอร์ กรุณารอสักครู่แล้วลองอีกครั้ง'
  };
  if (!input.scheduleReady) return {
    code: 'SCHEDULE_NOT_READY',
    enabled: false,
    actionText: 'ตารางงานยังไม่พร้อม',
    actionThai: 'รอตารางงานที่อนุมัติ',
    readyLine: 'ยังไม่พร้อมลงเวลา · ต้องมีตารางที่อนุมัติ',
    detail: 'ยังไม่มีตารางงานที่อนุมัติและพร้อมใช้เป็นข้อมูลอ้างอิงสำหรับการลงเวลา'
  };

  const checkOut = input.intent === 'CHECK_OUT';
  return {
    code: 'READY',
    enabled: true,
    actionText: checkOut ? 'แตะเพื่อเช็กเอาต์' : 'แตะเพื่อเช็กอิน',
    actionThai: checkOut ? 'พร้อมเช็กเอาต์' : 'พร้อมเช็กอิน',
    readyLine: checkOut ? 'พร้อมสำหรับเช็กเอาต์' : 'พร้อมสำหรับเช็กอิน',
    detail: ''
  };
}

export function createAttendanceActivationGuard(syntheticClickWindowMs = 800) {
  let inFlight = false;
  let lastPointerActivationAt = Number.NEGATIVE_INFINITY;

  return {
    async runExclusive(action: () => Promise<void>): Promise<boolean> {
      if (inFlight) return false;
      inFlight = true;
      try {
        await action();
        return true;
      } finally {
        inFlight = false;
      }
    },
    notePointerActivation(now: number) {
      lastPointerActivationAt = now;
    },
    shouldIgnoreSyntheticClick(now: number) {
      return now - lastPointerActivationAt >= 0 && now - lastPointerActivationAt < syntheticClickWindowMs;
    },
    isInFlight() {
      return inFlight;
    }
  };
}
