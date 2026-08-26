import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registrationResultPresentation } from './components/auth-experience';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const apiSource = read('api.ts');
const themeControl = read('components/ThemeControl.tsx');
const iconSource = read('components/SmsIcon.tsx');
const authCss = read('styles/auth-experience.css');
const designSystem = read('design-system.css');
const themeFoundation = read('styles/theme-foundation.css');
const login = main.slice(main.indexOf('function Login() {'), main.indexOf('\nconst text = ', main.indexOf('function Login() {')));

const apiSha256 = crypto.createHash('sha256').update(read('api.ts')).digest('hex');

describe('G04.2 UX-04 auth experience contract', () => {
  it('loads one final authoritative auth layer after data surfaces and removes legacy auth ownership where safe', () => {
    expect(main.indexOf("import './styles/data-surfaces.css';")).toBeLessThan(main.indexOf("import './styles/auth-experience.css';"));
    expect(authCss).toContain('authoritative public authentication experience');
    expect(themeFoundation).toContain('Public authentication ownership moved to styles/auth-experience.css in UX-04');
    expect(themeFoundation).not.toContain('.login-page {');
    expect(designSystem).toContain('Auth experience ownership moved to styles/auth-experience.css in UX-04');
    expect(designSystem).not.toContain('.login-page{');
  });

  it('keeps registration request on the exact existing API with the exact applicant-only payload and transitions after success', () => {
    const block = login.slice(login.indexOf('const requestRegistrationCode'), login.indexOf('const resendRegistrationCode'));
    expect(block).toContain('await api.requestRegistrationOtp({ submittedName: submittedName.trim(), email, password, departmentHint: departmentHint.trim() || undefined })');
    expect(block.indexOf('await api.requestRegistrationOtp')).toBeLessThan(block.indexOf("setMode('registerVerify')"));
    expect(apiSource).toContain("call('/auth/register/request-otp', { method: 'POST', body: JSON.stringify(data) })");
  });

  it('keeps existing-request resend on the same registration request path with the exact 60-second cooldown', () => {
    expect(login).toContain('try { await requestRegistrationCode(true); }');
    expect(login).toContain('if (busy || resendSeconds > 0) return;');
    expect(login).toContain('setResendSeconds(60)');
    expect(login).toContain('ส่งรหัสอีกครั้งใน ${resendSeconds} วินาที');
    expect(login).toContain('กรุณาตรวจสอบ Spam/Junk');
    expect((login.match(/resendRegistrationCode/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps one accessible numeric six-digit OTP input and the same verification API', () => {
    expect(login).toContain("api.verifyRegistrationOtp(email, code)");
    expect(login).toContain("replace(/\\D/g, '').slice(0, 6)");
    expect(login).toContain('inputMode="numeric"');
    expect(login).toContain('pattern="[0-9]{6}"');
    expect(login).toContain('maxLength={6}');
    expect(login).toContain('autoComplete="one-time-code"');
    expect((login.match(/id="otp-code"/g) || []).length).toBe(1);
  });

  it('preserves safe OTP request errors without mailer, SMTP, challenge, request, database, or existence details', () => {
    expect(login).toContain('ส่งรหัสยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    expect(login).toContain('ไม่สามารถส่งรหัสยืนยันได้ในขณะนี้ กรุณาลองใหม่ภายหลัง');
    for (const forbidden of ['SMTP', 'mailer', 'challengeId', 'requestId', 'database error']) expect(login).not.toContain(forbidden);
  });

  it('presents all six exact backend registration states without renaming or reinterpreting them', () => {
    const submitted = registrationResultPresentation('REQUEST_SUBMITTED');
    const pending = registrationResultPresentation('REQUEST_PENDING');
    const account = registrationResultPresentation('EXISTING_ACCOUNT');
    const employeeAccount = registrationResultPresentation('EMPLOYEE_ALREADY_HAS_ACCOUNT');
    const rejected = registrationResultPresentation('REQUEST_REJECTED');
    const support = registrationResultPresentation('REGISTRATION_SUPPORT_REQUIRED');
    expect(submitted).toMatchObject({ state: 'REQUEST_SUBMITTED', statusLabel: 'รอการตรวจสอบ', tone: 'warning', recovery: false });
    expect(pending).toMatchObject({ state: 'REQUEST_PENDING', tone: 'warning', recovery: false });
    expect(account).toMatchObject({ state: 'EXISTING_ACCOUNT', tone: 'info', recovery: true });
    expect(employeeAccount).toMatchObject({ state: 'EMPLOYEE_ALREADY_HAS_ACCOUNT', tone: 'info', recovery: true });
    expect(rejected).toMatchObject({ state: 'REQUEST_REJECTED', tone: 'danger', recovery: false });
    expect(support).toMatchObject({ state: 'REGISTRATION_SUPPORT_REQUIRED', tone: 'attention', recovery: false });
    expect(registrationResultPresentation('UNKNOWN_STATE')).toBeUndefined();
  });

  it('makes email verification success visually separate from registration approval', () => {
    expect(login).toContain('ยืนยันอีเมลสำเร็จ');
    expect(login).toContain('การยืนยันอีเมลยังไม่ใช่การอนุมัติบัญชี');
    expect(login).toContain('registrationResultPresentation(registrationState)');
    expect(login).not.toContain('{resultPresentation.state}');
  });

  it('keeps public registration free of Employee roster, employee identity authority, and role controls', () => {
    for (const forbidden of ['employeeCode', 'employeeId', 'matchedEmployeeId', 'registrationEmployees', 'available-employees', 'name="role"']) {
      expect(login).not.toContain(forbidden);
    }
    expect(login).toContain('submittedName');
    expect(login).toContain('departmentHint');
    expect(login).toContain('ข้อมูลนี้ไม่ใช่ข้อมูลยืนยันตัวบุคคลจาก Employee Master');
  });

  it('does not add demo credentials or fake public security claims', () => {
    expect(login).not.toMatch(/demo\s*(?:user|account|password|username)/i);
    expect(login).not.toContain('certified');
    expect(login).not.toContain('ผู้ใช้ออนไลน์');
    expect(login).not.toContain('บัญชีทดสอบ');
  });

  it('keeps password values local, masked by default, and uses an accessible SVG toggle without Unicode eye symbols', () => {
    expect(login).toContain("type={showPassword ? 'text' : 'password'}");
    expect(login).toContain("aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}");
    expect(login).toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(login).toContain("<SmsIcon name={showPassword ? 'eyeOff' : 'eye'}");
    expect(iconSource).toContain("| 'eye' | 'eyeOff'");
    expect(login).not.toContain(String.fromCodePoint(0x1f441));
    expect(login).not.toContain('console.log');
  });

  it('does not log or render an OTP except the user-controlled input value', () => {
    expect(login).not.toContain('console.log');
    expect(login).not.toContain('console.debug');
    expect(login).not.toMatch(/>\s*\{code\}\s*</);
    expect(login).toContain('value={code}');
  });

  it('keeps forgot-password request, safe non-enumeration copy, and reset completion behavior unchanged', () => {
    expect(login).toContain('await api.requestPasswordResetOtp(email)');
    expect(login).toContain("resetView('resetVerify')");
    expect(login).toContain('หากอีเมลนี้ใช้งานได้ ระบบได้ส่งรหัสยืนยันแล้ว');
    expect(login).toContain('api.completePasswordReset(email, code, password)');
    expect(apiSource).toContain("call('/auth/password-reset/request-otp', { method: 'POST', body: JSON.stringify({ email }) })");
    expect(apiSource).toContain("call('/auth/password-reset/complete', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) })");
  });

  it('keeps login behavior and browser autocomplete semantics intact', () => {
    expect(login).toContain("if (mode === 'login') await auth.login(email, password)");
    expect(apiSource).toContain("call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, clientType: 'browser' }) })");
    expect(login).toContain("autoComplete={mode === 'login' ? 'username' : 'email'}");
    expect(login).toContain("autoComplete={mode === 'login' ? 'current-password' : 'new-password'}");
  });

  it('locks the authorized V1.2 API source after the Passkey extension', () => {
    expect(apiSha256).toBe('98a10ea2a63e62f9e4b857f13d88df0996fe23d6ec50d89b186cf37439ed4c42');
  });

  it('keeps theme changes frontend-only and prevents theme controls from submitting or resetting auth form state', () => {
    expect(login).toContain('<ThemeControl compact />');
    expect(themeControl).toContain('type="button"');
    expect(themeControl).toContain('onClick={() => setPreference(option.value)}');
    expect(themeControl).not.toContain('location.reload');
    expect(themeControl).not.toContain('form.reset');
    const effects = Array.from(login.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)).map((match) => `${match[1]} ${match[2]}`);
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) {
      expect(effect).not.toContain('theme');
      expect(effect).not.toContain("setEmail('')");
      expect(effect).not.toContain("setPassword('')");
    }
  });

  it('meets auth geometry, readable typography, mobile containment, and reduced-motion contracts', () => {
    expect(authCss).toContain('height: 48px;');
    expect(authCss).toContain('min-height: 48px;');
    expect(authCss).toContain('font-size: 12px;');
    expect(authCss).toContain('.auth-theme-control .theme-control--compact button');
    expect(authCss).toContain('min-width: 40px;');
    expect(authCss).toContain('@media (max-width: 760px)');
    expect(authCss).toContain('grid-template-columns: 1fr;');
    expect(authCss).toContain('overflow-x: hidden;');
    expect(authCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(authCss).not.toMatch(/font-size:\s*(?:10|11)px/);
  });
});
