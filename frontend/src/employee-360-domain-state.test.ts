import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const drawer=fs.readFileSync(path.join(__dirname,'components/personnel/PersonnelDetailDrawer.tsx'),'utf8');
describe('EMP-UX Employee 360 authoritative domain states',()=>{
 it('reads linked account and employee-filtered licenses through existing authorities',()=>{expect(drawer).toContain('api.users(token)');expect(drawer).toContain('getEmployeeLicenses(token, employee.id)');expect(drawer).toContain('getEmployeeLeaveQuota(token, quotaYear, employee.id)');});
 it('shows individual schedule/site/device authority without inventing an overall attendance result',()=>{expect(drawer).toContain('บัญชีผู้ใช้เชื่อมโยง');expect(drawer).toContain('api.employeeOnboardingReadiness');expect(drawer).toContain('อุปกรณ์ลงเวลาตามสัญญาระบบ');expect(drawer).toContain('ไม่คำนวณผลรวม');expect(drawer).not.toContain("onboardingReadiness.status === 'READY'");});
 it('keeps partial-source behavior fail-soft via Promise.allSettled',()=>{expect(drawer).toContain('Promise.allSettled');expect(drawer).toContain('statusUnavailable');});
});
