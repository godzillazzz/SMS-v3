import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const main = fs.readFileSync(path.join(root, 'main.tsx'), 'utf8');
const login = main.slice(main.indexOf('function Login() {'), main.indexOf('\nconst text = ', main.indexOf('function Login() {')));

describe('G04.1 registration OTP UX contract', () => {
  it('keeps public registration free of Employee/employeeCode/role authority', () => {
    expect(login).not.toContain('employeeCode');
    expect(login).not.toContain('employeeId');
    expect(login).not.toContain('matchedEmployeeId');
    expect(login).not.toContain('registrationEmployees');
    expect(login).not.toContain('available-employees');
    expect(login).not.toContain('name="role"');
  });

  it('moves to OTP verification only after requestRegistrationOtp resolves successfully', () => {
    const requestBlock = login.slice(login.indexOf('const requestRegistrationCode'), login.indexOf('const resendRegistrationCode'));
    expect(requestBlock).toMatch(/await api\.requestRegistrationOtp/);
    expect(requestBlock.indexOf('await api.requestRegistrationOtp')).toBeLessThan(requestBlock.indexOf("setMode('registerVerify')"));
  });

  it('provides 60-second resend cooldown and Spam/Junk guidance', () => {
    expect(login).toContain('setResendSeconds(60)');
    expect(login).toContain('ส่งรหัสอีกครั้ง');
    expect(login).toContain('Spam/Junk');
    expect(login).toContain('resendSeconds > 0');
  });

  it('shows safe Thai 429 and 503 OTP delivery errors', () => {
    expect(login).toContain('ส่งรหัสยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    expect(login).toContain('ไม่สามารถส่งรหัสยืนยันได้ในขณะนี้ กรุณาลองใหม่ภายหลัง');
  });

  it('shows masked email and consumes machine-readable registrationState without exposing internal ids', () => {
    expect(login).toContain("***@${domain}");
    expect(login).toContain('result.registrationState');
    expect(login).toContain("registrationState === 'EXISTING_ACCOUNT'");
    expect(login).toContain("registrationState === 'EMPLOYEE_ALREADY_HAS_ACCOUNT'");
    expect(login).not.toContain('User ID');
    expect(login).not.toContain('Employee ID');
  });
});
