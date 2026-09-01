import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const drawer=fs.readFileSync(path.join(__dirname,'components/personnel/PersonnelDetailDrawer.tsx'),'utf8');
describe('EMP-UX Employee 360 authoritative domain states',()=>{
 it('reads linked account and licenses through existing APIs',()=>{expect(drawer).toContain('api.users(token)');expect(drawer).toContain('api.licenses(token, 1)');expect(drawer).toContain("String(row.employeeId || '') === employee.id");});
 it('surfaces account and expiring-license state without inventing device authority',()=>{expect(drawer).toContain('บัญชีผู้ใช้');expect(drawer).toContain('ใกล้หมดอายุภายใน 30 วัน');expect(drawer).toContain('Attendance Device');expect(drawer).toContain('api.employeeOnboardingReadiness');expect(drawer).toContain('Active cryptographic device');expect(drawer).toContain('ไม่คาดเดาสถานะจาก client');});
 it('keeps partial-source behavior fail-soft via Promise.allSettled',()=>{expect(drawer).toContain('Promise.allSettled');expect(drawer).toContain('statusUnavailable');});
});
