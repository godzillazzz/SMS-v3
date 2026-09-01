import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const page = read('pages/personnel/PersonnelDirectoryPage.tsx');
const main = read('main.tsx');
const css = read('styles/personnel-directory.css');

describe('EMP-UX Employee 360 summary contract', () => {
  it('reuses one Personnel drawer and one governed Edit entry point', () => {
    expect(drawer).toContain('Employee 360');
    expect(drawer).toContain('onEdit');
    expect(drawer).not.toContain('EmployeeLifecycleModal');
    expect(page).toContain('<PersonnelDetailDrawer');
  });
  it('loads only existing governed sources for pending changes lifecycle and Reference Photo', () => {
    expect(drawer).toContain('api.employeeChangeRequests');
    expect(drawer).toContain('api.employeeLifecycleHistory');
    expect(drawer).toContain('api.employeeReferencePhotos');
    expect(drawer).toContain('Promise.allSettled');
  });
  it('shows authoritative states without inventing account device or Site state', () => {
    expect(drawer).toContain('คำขอเปลี่ยนแปลง');
    expect(drawer).toContain('Future-effective');
    expect(drawer).toContain('Reference Photo');
    expect(drawer).toContain('อ้างอิงจาก Schedule / Security Site authority');
    expect(drawer).toContain('ไม่คาดเดาสถานะจาก client');
  });
  it('presents domain sections and immutable lifecycle timeline', () => {
    expect(drawer).toContain('ภาพรวมและข้อมูลทั่วไป');
    expect(drawer).toContain('การจ้างงานและโครงสร้าง');
    expect(drawer).toContain('Change History Timeline');
    expect(drawer).toContain('ประวัติ lifecycle แบบอ่านอย่างเดียว');
  });
  it('passes authenticated token from app to the Employee 360 drawer and keeps mobile layout', () => {
    expect(main).toContain('token={auth.token}');
    expect(page).toContain('token={token}');
    expect(css).toContain('.personnel-detail-drawer--360');
    expect(css).toContain('@media(max-width:700px){.personnel-360-state-strip{grid-template-columns:1fr}');
  });
});
