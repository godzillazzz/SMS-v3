import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./pages/attendance-simple/AttendanceSimplePage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./pages/attendance-simple/attendance-simple.css', import.meta.url), 'utf8');

describe('Attendance P0 clarity contract', () => {
  it('organizes the employee journey around Now, Next and Exception', () => {
    expect(page).toContain('attendance-simple__journey');
    expect(page).toContain('ตอนนี้');
    expect(page).toContain('ขั้นตอนถัดไป');
    expect(page).toContain('attendance-simple__exception');
    expect(page).toContain('ต้องทราบ');
    expect(page).toContain('ช่วยปฏิบัติงานต่าง Site');
  });

  it('keeps technical reason codes behind progressive disclosure', () => {
    expect(page).toContain('รายละเอียดทางเทคนิค');
    expect(page).toContain('<details className="attendance-simple__technical">');
    expect(page).not.toContain('<b>ธงตรวจ:</b>');
    expect(page).not.toContain('AES-GCM encrypted queue');
  });

  it('uses human-first device and offline copy while preserving the security controls', () => {
    expect(page).toContain('อุปกรณ์นี้ยืนยันแล้ว');
    expect(page).toContain('<SmsIcon name="check" size={15} />');
    expect(page).toContain('เครื่องหลักของคุณ');
    expect(page).toContain('ออฟไลน์พร้อมใช้งาน');
    expect(page).toContain('ระบบเก็บรายการในเครื่องและส่งให้อัตโนมัติเมื่อออนไลน์');
    expect(page).toContain('GPS / GEOFENCE ตรวจทุกครั้งก่อนบันทึก');
  });

  it('renders a server-backed post-action receipt without changing the API contract', () => {
    expect(page).toContain('attendance-simple__receipt');
    expect(page).toContain('aria-label="หลักฐานการลงเวลา"');
    expect(page).toContain('บันทึกกับ Server แล้ว');
    expect(page).toContain('Site จริง');
    expect(page).toContain('GPS / GEOFENCE');
    expect(page).toContain('ตรวจแล้ว');
    expect(page).toContain('formatReceiptTime(receiptEvent?.effectiveEventAt || receiptEvent?.receivedAt)');
  });

  it('keeps the 390px field-worker viewport first-class', () => {
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('.attendance-simple__receipt-grid { grid-template-columns:1fr; }');
  });
});
