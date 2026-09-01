import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const drawer = readFileSync(new URL('./components/personnel/PersonnelDetailDrawer.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
describe('Employee onboarding readiness authority', () => {
 it('loads the employee-target server readiness endpoint', () => { expect(api).toContain('employeeOnboardingReadiness'); expect(api).toContain('/onboarding-readiness'); expect(drawer).toContain('api.employeeOnboardingReadiness'); });
 it('never infers READY from client-only account/photo state', () => { expect(drawer).toContain("onboardingReadiness.status === 'READY'"); expect(drawer).toContain('Onboarding readiness authority ไม่พร้อม'); expect(drawer).toContain('ไม่คาดเดาสถานะจาก client'); });
 it('shows authoritative schedule site and cryptographic device blockers', () => { expect(drawer).toContain('Schedule / Shift'); expect(drawer).toContain('Security Site'); expect(drawer).toContain('Active cryptographic device'); expect(drawer).toContain('Blocking reasons'); });
});
