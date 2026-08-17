import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('G04 private registration UI contract', () => {
  const main = read('main.tsx');
  const api = read('api.ts');
  const review = read('pages/access-management/RegistrationReviewPanel.tsx');
  const login = main.slice(main.indexOf('function Login() {'), main.indexOf('\nconst text = ', main.indexOf('function Login() {')));

  it('public registration contains no Employee Master roster, search, autocomplete, employeeId, or role authority', () => {
    expect(login).not.toContain('registrationEmployees');
    expect(login).not.toContain('available-employees');
    expect(login).not.toContain('employeeId');
    expect(login).not.toContain('employeeCode');
    expect(login).not.toContain("name=\"role\"");
    expect(login).not.toMatch(/requestRegistrationOtp\(\{[^}]*role\s*:/s);
    expect(login).toContain('submittedName');
    expect(login).toContain('departmentHint');
  });

  it('API client removed the anonymous Employee directory and public request payload has no Employee/role authority', () => {
    expect(api).not.toContain('registrationEmployees:');
    expect(api).not.toContain('/auth/register/available-employees');
    expect(api).toContain('submittedName: string');
    expect(api).toContain('departmentHint?: string');
  });

  it('review UI requires explicit Match and exposes a fixed VIEWER approval with no role picker', () => {
    expect(review).toContain('Match');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).toContain('สิทธิ์เริ่มต้นหลังอนุมัติ');
    expect(review).not.toContain('<select');
    expect(review).not.toContain('api.updateUser');
    expect(review).not.toContain('api.createEmployee');
  });

  it('no-match guidance keeps Employee Master creation separate and ADMIN navigation-only', () => {
    expect(review).toContain('ไม่พบพนักงานใน Employee Master');
    expect(review).toContain('ไปที่ Employee Master');
    expect(review).toContain("role === 'ADMIN'");
    expect(review).toContain("setMatchState");
  });

  it('approval client sends no role value and candidate search is authenticated', () => {
    expect(api).toMatch(/approveRegistrationRequest:[\s\S]*body: '\{\}'/);
    expect(api).toMatch(/registrationCandidates:[\s\S]*Authorization: `Bearer \$\{token\}`/);
  });
});
