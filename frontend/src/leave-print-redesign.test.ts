import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');

describe('Leave Print Document Redesign (Matching Reference Image)', () => {
  test('renders formal letter header, document number, and status', () => {
    expect(mainTsx).toContain('ใบขออนุญาตลา');
    expect(mainTsx).toContain('LEAVE REQUEST');
    expect(mainTsx).toContain('leave-print-doc-meta');
    expect(mainTsx).toContain('leave-print-divider');
  });

  test('renders letter body with employee details, dates, and substitute', () => {
    expect(mainTsx).toContain('ข้าพเจ้า');
    expect(mainTsx).toContain('มีความประสงค์ขอ');
    expect(mainTsx).toContain('ผู้ปฏิบัติงานแทน / รายละเอียด');
    expect(mainTsx).toContain('leave-print-applicant-sig');
  });

  test('shows system submission only when the submitter account is linked to this employee', () => {
    expect(mainTsx).toContain('leave-print-system-signature');
    expect(mainTsx).toContain('ลงนามในระบบแล้ว');
    expect(mainTsx).toContain('row.selfSubmitted === true');
    expect(mainTsx).not.toContain('row.createdByUserId &&');
  });

  test('renders quota statistics table with all 6 columns', () => {
    expect(mainTsx).toContain('สถิติการลาประเภทนี้ในปี');
    expect(mainTsx).toContain('<th>ประเภทการลา</th>');
    expect(mainTsx).toContain('<th>สิทธิ์ทั้งปี</th>');
    expect(mainTsx).toContain('<th>ลามาแล้ว</th>');
    expect(mainTsx).toContain('<th>ลาครั้งนี้</th>');
    expect(mainTsx).toContain('<th>รวมเป็น</th>');
    expect(mainTsx).toContain('<th>คงเหลือ</th>');
  });

  test('renders two side-by-side signature boxes for supervisor and HR', () => {
    expect(mainTsx).toContain('ความเห็นผู้บังคับบัญชา / ผู้อนุมัติ');
    expect(mainTsx).toContain('สำหรับบริษัท');
    expect(mainTsx).toContain('ผู้มีอำนาจอนุมัติ');
    expect(mainTsx).toContain('className="leave-print-notice">ทราบ /</span>');
    expect(mainTsx).toContain('className="leave-print-sig-label">ลงชื่อ</span>');
    expect(stylesCss).toContain('.leave-print-boxes-grid');
  });
});
