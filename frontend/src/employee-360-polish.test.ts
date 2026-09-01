import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read=(relative:string)=>fs.readFileSync(path.join(__dirname,relative),'utf8');
const drawer=read('components/personnel/PersonnelDetailDrawer.tsx');
const css=read('styles/personnel-directory.css');
describe('EMP-UX-02 Employee 360 polish',()=>{
  it('adds accessible in-drawer domain navigation without a duplicate edit entry',()=>{expect(drawer).toContain('personnel-360-jump-nav');expect(drawer).toContain('aria-label=\"เมนูย่อย Employee 360\"');expect(drawer.match(/onEdit/g)?.length).toBeGreaterThanOrEqual(2);expect(drawer).not.toContain('EmployeeLifecycleModal');});
  it('uses fail-safe attendance readiness instead of claiming READY without all authorities',()=>{expect(drawer).toContain("onboardingReadiness.status === 'READY'");expect(drawer).toContain('Schedule, Shift, Security Site และ cryptographic Attendance Device');expect(drawer).toContain('Onboarding readiness authority ไม่พร้อม');expect(drawer).toContain('ไม่คาดเดาสถานะจาก client');});
  it('uses human-readable account and reference-photo status wording',()=>{expect(drawer).toContain('บัญชีเข้าใช้งาน');expect(drawer).toContain('รูปอ้างอิงใบหน้า');expect(drawer).toContain('พร้อมใช้งาน');});
  it('keeps responsive and keyboard-visible navigation styling',()=>{expect(css).toContain('.personnel-360-jump-nav');expect(css).toContain(':focus-visible');expect(css).toContain('@media(max-width:700px)');expect(css).toContain('.personnel-readiness-summary--warning');});
});
