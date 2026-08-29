import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const main = source('src/main.tsx');
const css = source('src/styles/responsive-certification-v1.css');
const e2e = source('../e2e/smoke/responsive.spec.js');

describe('Responsive Certification V1', () => {
  test('loads certification overrides after the existing mobile and PWA layers', () => {
    expect(main).toContain("import './styles/responsive-certification-v1.css';");
    expect(main.indexOf("import './styles/responsive-certification-v1.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/pwa-shell.css';"));
  });

  test('covers phone, tablet, landscape and wide desktop breakpoints', () => {
    for (const contract of [
      '@media (max-width: 1024px)',
      '@media (max-width: 760px)',
      '@media (max-width: 430px)',
      '@media (max-width: 360px)',
      '@media (orientation: landscape) and (max-height: 500px) and (max-width: 900px)',
      '@media (min-width: 1600px)'
    ]) expect(css).toContain(contract);
  });

  test('hardens OpenStreetMap and narrow Attendance without removing intentional inner scrolling', () => {
    expect(css).toContain('.security-site-map-picker__canvas');
    expect(css).toContain('height: 250px');
    expect(css).toContain('.attendance-v4__readiness');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('overflow-x: clip');
  });

  test('defines representative iPhone Android iPad and computer viewport coverage', () => {
    for (const viewport of [
      "iphone-se-320', width: 320, height: 568",
      "android-compact-360', width: 360, height: 800",
      "iphone-390', width: 390, height: 844",
      "android-large-412', width: 412, height: 915",
      "iphone-max-430', width: 430, height: 932",
      "mobile-landscape-844', width: 844, height: 390",
      "ipad-portrait-768', width: 768, height: 1024",
      "ipad-landscape-1024', width: 1024, height: 768",
      "laptop-1280', width: 1280, height: 800",
      "desktop-1440', width: 1440, height: 900",
      "fullhd-1920', width: 1920, height: 1080"
    ]) expect(e2e).toContain(viewport);
  });

  test('certifies all primary Admin navigation surfaces on representative device families', () => {
    for (const label of [
      'ข้อมูลพนักงาน', 'ใบอนุญาต รปภ.', 'ลงเวลา', 'ลงเวลาแทนพนักงาน', 'อุปกรณ์ลงเวลา',
      'ตารางกะรายเดือน', 'รหัสกะและเวลา', 'คำขอลา', 'รออนุมัติ', 'ประวัติการลาทั้งหมด',
      'โควต้าวันลา', 'Approval Center', 'กฎการทำงาน', 'บันทึกการใช้งานระบบ', 'คุณภาพข้อมูล',
      'ผู้ใช้และสิทธิ์', 'รายงานและวิเคราะห์', 'Security Site & QR', 'ตั้งค่าระบบ'
    ]) expect(e2e).toContain(`'${label}'`);
    expect(e2e).toContain("'iphone-390'");
    expect(e2e).toContain("'android-large-412'");
    expect(e2e).toContain("'ipad-portrait-768'");
    expect(e2e).toContain("'ipad-landscape-1024'");
    expect(e2e).toContain("'desktop-1440'");
    expect(e2e).toContain('assertNoHorizontalOverflow(page)');
  });
});
