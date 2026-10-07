import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const drawer = readFileSync(new URL('./components/personnel/PersonnelDetailDrawer.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
describe('Employee onboarding readiness authority', () => {
 it('loads the employee-target server readiness endpoint', () => { expect(api).toContain('employeeOnboardingReadiness'); expect(api).toContain('/onboarding-readiness'); expect(drawer).toContain('api.employeeOnboardingReadiness'); });
 it('does not combine the legacy aggregate that includes the retired photo gate', () => { expect(drawer).not.toContain("onboardingReadiness.status === 'READY'"); expect(drawer).not.toContain('onboardingReadiness?.blockers'); expect(drawer).toContain('ไม่คำนวณผลรวม'); });
 it('shows schedule, site, and device checks as individual server results', () => { expect(drawer).toContain('scheduleCheck'); expect(drawer).toContain('siteCheck'); expect(drawer).toContain('deviceCheck'); expect(drawer).toContain('ระบบยืนยันอุปกรณ์ที่ยังใช้งานและผ่านการตรวจสอบ'); });
});
