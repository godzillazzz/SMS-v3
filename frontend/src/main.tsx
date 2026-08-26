import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-500.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/noto-sans-thai/thai-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { api, setTokenRefreshHandler } from './api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from './request-error';
import { acquireDocumentScrollLock } from './document-scroll-lock';
import { LEAVE_QUOTA_DEFAULTS, buildLeaveQuotaProvisioningPayload, canProvisionLeaveQuota, currentBangkokQuotaYear, hasUnmatchedLegacyQuota, quotaProvisioningEmployeeOptions, thaiQuotaYearLabel } from './leave-quota-provisioning';
import { printScheduleDocument } from './schedule-print';
import { ReportCenterPage } from './pages/reports/ReportCenterPage';
import { currentBangkokMonth, formatThaiMonth, MonthGridPicker, normalizeMonthValue, parseMonthValue, shiftMonthValue } from './components/MonthGridPicker';
import './styles.css';
import './design-system.css';
import './styles/dashboard.css';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PersonnelDirectoryPage } from './pages/personnel/PersonnelDirectoryPage';
import { EmployeeGovernedEditModal } from './components/personnel/EmployeeGovernedEditModal';
import { EmployeeChangeReviewModal } from './components/personnel/EmployeeChangeReviewModal';
import { AuditCompliancePage } from './pages/audit/AuditCompliancePage';
import { defaultAuditFilters, type AuditFilters } from './components/audit/audit-types';
import { DataQualityCenterPage, type DataQualityFilters, type DataQualityIssue } from './pages/data-quality/DataQualityCenterPage';
import { AccessManagementPage } from './pages/access-management/AccessManagementPage';
import { AttendanceDevicePage } from './pages/attendance-device/AttendanceDevicePage';
import { PwaProfilePage } from './pages/pwa-profile/PwaProfilePage';
import { initialSmsPwaPage, isSmsPwaPage, isSmsPwaShellMode, type SmsPwaPage } from './pwa-mode';
import { registerSmsPwa } from './pwa';
import { AttendancePage } from './pages/attendance/AttendancePage';
import { RegistrationReviewPanel } from './pages/access-management/RegistrationReviewPanel';
import { canLoadAccessManagement } from './components/access-management/access-management-utils';
import type { DashboardFilters } from './components/dashboard/types';
import { LicenseEditModal, LicenseTableDocumentColumns } from './components/LicenseDocuments';
import { DataRowActionMenu } from './components/DataRowActionMenu';
import { TableActionCell, TableActionHeader } from './components/TableActionColumn';
import { OperationalRecordDrawer, type OperationalDrawerAction } from './components/OperationalRecordDrawer';
import { SmsIcon, type SmsIconName } from './components/SmsIcon';
import { ThemeControl } from './components/ThemeControl';
import { PasskeySecurityPanel } from './components/PasskeySecurityPanel';
import { AttendancePolicySettingsCard, attendancePolicyKeys, type AttendancePolicyForm } from './components/AttendancePolicySettingsCard';
import { registrationResultPresentation } from './components/auth-experience';
import { sanitizeLicenseDocumentError, type LicenseDocument } from './components/license-document-utils';
import './styles/license-table.css';
import './styles/responsive-shell.css';
import './styles/action-system.css';
import './styles/tokens.css';
import './styles/theme-foundation.css';
import './styles/app-shell.css';
import './styles/data-surfaces.css';
import './styles/auth-experience.css';
import './styles/visual-fidelity.css';
import './styles/signature-experience.css';
import './styles/signature-experience-v1-1.css';
import './styles/signature-experience-v1-2.css';
import './styles/production-mobile-responsive-v1.css';
import './styles/attendance-device.css';
import './styles/pwa-shell.css';

type User = { id: string; email: string; displayName: string; role: string; department?: string };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; displayName?: string; email?: string | null; phone?: string | null; department?: string; jobTitle?: string; hiredAt?: string | null; skill?: string | null; isActive: boolean; updatedAt?: string };
type Page = 'dashboard' | 'employees' | 'licenses' | 'attendance' | 'attendanceDevice' | 'profile' | 'shiftSetup' | 'schedule' | 'approvals' | 'rules' | 'leave' | 'leavePending' | 'leaveHistory' | 'quota' | 'users' | 'audit' | 'dataQuality' | 'reportCenter' | 'reports' | 'executiveReport' | 'settings';
type Auth = { token?: string; user?: User; originalUser?: User; loading: boolean; error?: string; isViewingAs: boolean; login(email: string, password: string): Promise<void>; passkeyLogin(): Promise<void>; logout(): Promise<void>; beginViewAs(userId: string): Promise<void>; endViewAs(): void };
type DataRow = Record<string, unknown>;
type DataResponse = { data?: DataRow[] | DataRow; summary?: { total?: number; critical?: number; warning?: number; info?: number }; meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number; statusCounts?: Record<string, number>; unmatchedLegacyCount?: number } };
type LicenseEmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';
type FormField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'date' | 'number' | 'select' | 'textarea' | 'file'; required?: boolean; accept?: string; hint?: string; min?: number; max?: number; options?: Array<{ value: string; label: string }> };
type Editor = { title: string; submitLabel: string; fields: FormField[]; values: Record<string, string>; notice?: string; experience?: 'personnel'; submit(values: Record<string, string>, files: Record<string, File>): Promise<void> };

const bangkokDateInput = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const AuthContext = createContext<Auth | undefined>(undefined);

const navigation: Array<{ label: string; items: Array<{ id: Page; icon: SmsIconName; label: string }> }> = [
  { label: 'ภาพรวม', items: [{ id: 'dashboard', icon: 'dashboard', label: 'Dashboard' }] },
  { label: 'พนักงาน', items: [
    { id: 'employees', icon: 'employees', label: 'ข้อมูลพนักงาน' },
    { id: 'licenses', icon: 'license', label: 'ใบอนุญาต รปภ.' },
    { id: 'attendance', icon: 'attendance', label: 'ลงเวลา' },
    { id: 'attendanceDevice', icon: 'key', label: 'อุปกรณ์ลงเวลา' }
  ] },
  { label: 'ตารางกะ', items: [
    { id: 'schedule', icon: 'calendar', label: 'ตารางกะรายเดือน' },
    { id: 'shiftSetup', icon: 'clock', label: 'รหัสกะและเวลา' }
  ] },
  { label: 'การลา', items: [
    { id: 'leave', icon: 'leave', label: 'คำขอลา' },
    { id: 'leavePending', icon: 'approval', label: 'รออนุมัติ' },
    { id: 'leaveHistory', icon: 'history', label: 'ประวัติการลาทั้งหมด' },
    { id: 'quota', icon: 'quota', label: 'โควต้าวันลา' }
  ] },
  { label: 'ตรวจสอบ', items: [
    { id: 'rules', icon: 'shield', label: 'กฎการทำงาน' },
    { id: 'audit', icon: 'audit', label: 'บันทึกการใช้งานระบบ' },
    { id: 'dataQuality', icon: 'quality', label: 'คุณภาพข้อมูล' }
  ] },
  { label: 'ผู้ใช้และสิทธิ์', items: [{ id: 'users', icon: 'users', label: 'ผู้ใช้และสิทธิ์' }] },
  { label: 'รายงาน', items: [{ id: 'reportCenter', icon: 'report', label: 'รายงานและวิเคราะห์' }] },
  { label: 'ตั้งค่า', items: [{ id: 'settings', icon: 'settings', label: 'ตั้งค่าระบบ' }] }
];

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<User>();
  const [viewAs, setViewAs] = useState<{ token: string; user: User }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    const result = await api.refresh();
    setToken(result.accessToken);
    setUser(result.user);
    setViewAs(undefined);
  };

  useEffect(() => {
    setTokenRefreshHandler((newToken, newUser) => {
      setToken(newToken);
      if (newUser) setUser(newUser);
    });
    refresh().catch(() => undefined).finally(() => setLoading(false));
    return () => setTokenRefreshHandler(null);
  }, []);

  const login = async (email: string, password: string) => {
    setError(undefined);
    try {
      const result = await api.login(email, password);
      setToken(result.accessToken);
      setUser(result.user);
      setViewAs(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเข้าสู่ระบบได้');
      throw reason;
    }
  };

  const passkeyLogin = async () => {
    setError(undefined);
    try {
      if (!browserSupportsWebAuthn()) throw new Error('เบราว์เซอร์หรืออุปกรณ์นี้ยังไม่รองรับ Passkey');
      const challenge = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: challenge.options });
      const result = await api.passkeyLoginVerify(challenge.challengeId, response);
      setToken(result.accessToken);
      setUser(result.user);
      setViewAs(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้');
      throw reason;
    }
  };

  const logout = async () => {
    await api.logout();
    setToken(undefined);
    setUser(undefined);
    setViewAs(undefined);
  };

  const beginViewAs = async (userId: string) => {
    if (!token || user?.role !== 'ADMIN') throw new Error('View As requires an Admin account.');
    const result = await api.viewAsUser(token, userId);
    setViewAs({ token: result.data.accessToken, user: result.data.user });
  };

  const endViewAs = () => setViewAs(undefined);

  return <AuthContext.Provider value={{ token: viewAs?.token || token, user: viewAs?.user || user, originalUser: user, loading, error, isViewingAs: Boolean(viewAs), login, passkeyLogin, logout, beginViewAs, endViewAs }}>{children}</AuthContext.Provider>;
}

function Logo() {
  return <span className="brand-mark" aria-label="SMS"><b>SMS</b></span>;
}

function readLeaveMonthFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const year = params.get('year');
  const month = params.get('month');
  return normalizeMonthValue(year && month ? `${year}-${month}` : undefined);
}

function writeLeaveMonthToUrl(value: string): void {
  const url = new URL(window.location.href);
  const { year, month } = parseMonthValue(value);
  url.searchParams.set('year', String(year));
  url.searchParams.set('month', String(month));
  window.history.pushState({ leaveMonth: `${year}-${String(month).padStart(2, '0')}` }, '', `${url.pathname}${url.search}${url.hash}`);
}

function AuthProgress({ flow, current }: { flow: 'registration' | 'reset'; current: number }) {
  const steps = flow === 'registration'
    ? ['ข้อมูลผู้สมัคร', 'ยืนยันอีเมล', 'รอการตรวจสอบ']
    : ['อีเมล', 'ยืนยัน OTP', 'ตั้งรหัสผ่านใหม่'];
  return <ol className="auth-progress" aria-label={flow === 'registration' ? 'ขั้นตอนการลงทะเบียน' : 'ขั้นตอนการรีเซ็ตรหัสผ่าน'}>
    {steps.map((label, index) => {
      const step = index + 1;
      const state = step < current ? 'complete' : step === current ? 'active' : 'upcoming';
      return <li className={`auth-progress__step is-${state}`} key={label} aria-current={state === 'active' ? 'step' : undefined}>
        <span className="auth-progress__number">{step}</span><span>{label}</span>
      </li>;
    })}
  </ol>;
}

function Login() {
  const auth = useContext(AuthContext)!;
  const [mode, setMode] = useState<'login' | 'register' | 'registerVerify' | 'reset' | 'resetVerify'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [departmentHint, setDepartmentHint] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [registrationState, setRegistrationState] = useState<string>();
  const [resendSeconds, setResendSeconds] = useState(0);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);

  useEffect(() => {
    api.passkeyConfig().then((result) => setPasskeyEnabled(Boolean(result?.enabled) && browserSupportsWebAuthn())).catch(() => setPasskeyEnabled(false));
  }, []);

  useEffect(() => {
    if (mode !== 'registerVerify' || resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [mode, resendSeconds]);

  const resetView = (next: typeof mode) => { setMode(next); setFormError(undefined); setFormMessage(undefined); setCode(''); setRegistrationState(undefined); if (next !== 'registerVerify') setResendSeconds(0); };
  const signInWithPasskey = async () => {
    setFormError(undefined); setFormMessage(undefined); setBusy(true);
    try { await auth.passkeyLogin(); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้'); }
    finally { setBusy(false); }
  };

  const resultPresentation = registrationResultPresentation(registrationState);
  const title = mode === 'login' ? 'ยินดีต้อนรับกลับ' : mode === 'register' ? 'ส่งคำขอลงทะเบียน' : mode === 'registerVerify' ? 'ยืนยันอีเมล' : mode === 'reset' ? 'ลืมรหัสผ่าน' : 'ตั้งรหัสผ่านใหม่';
  const lead = mode === 'login' ? 'เข้าสู่ระบบเพื่อใช้งาน Security Management System' : mode === 'register' ? 'กรอกข้อมูลสำหรับส่งคำขอให้ผู้ดูแลตรวจสอบ' : mode === 'registerVerify' ? 'ยืนยันความเป็นเจ้าของอีเมลด้วยรหัส 6 หลัก' : mode === 'reset' ? 'ระบุอีเมลเพื่อขอรหัสยืนยันสำหรับตั้งรหัสผ่านใหม่' : 'กรอกรหัส OTP พร้อมกำหนดรหัสผ่านใหม่';
  const submitDisabled = busy || (mode === 'register' && submittedName.trim().length < 2);
  const maskedEmail = (() => {
    const [local, domain] = email.trim().split('@');
    if (!local || !domain) return email;
    return `${local.slice(0, 1)}***@${domain}`;
  })();
  const registrationErrorMessage = (reason: unknown) => {
    const status = typeof reason === 'object' && reason && 'status' in reason ? Number((reason as { status?: unknown }).status) : 0;
    if (status === 429) return 'ส่งรหัสยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
    if (status === 503) return 'ไม่สามารถส่งรหัสยืนยันได้ในขณะนี้ กรุณาลองใหม่ภายหลัง';
    return reason instanceof Error ? reason.message : 'ไม่สามารถดำเนินการได้';
  };

  const requestRegistrationCode = async (isResend = false) => {
    const result = await api.requestRegistrationOtp({ submittedName: submittedName.trim(), email, password, departmentHint: departmentHint.trim() || undefined });
    setMode('registerVerify');
    setCode('');
    setResendSeconds(60);
    setFormMessage(isResend ? 'ส่งรหัสยืนยันใหม่แล้ว กรุณาตรวจสอบอีเมล รวมถึงโฟลเดอร์ Spam/Junk' : result.message);
  };

  const resendRegistrationCode = async () => {
    if (busy || resendSeconds > 0) return;
    setFormError(undefined); setFormMessage(undefined); setBusy(true);
    try { await requestRegistrationCode(true); }
    catch (reason) { setFormError(registrationErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(undefined); setFormMessage(undefined);
    setBusy(true);
    try {
      if (mode === 'login') await auth.login(email, password);
      else if (mode === 'register') {
        await requestRegistrationCode(false);
      } else if (mode === 'registerVerify') {
        const result = await api.verifyRegistrationOtp(email, code);
        setRegistrationState(result.registrationState);
        setMode('login'); setCode(''); setPassword(''); setResendSeconds(0); setFormMessage(result.message);
      } else if (mode === 'reset') {
        await api.requestPasswordResetOtp(email); resetView('resetVerify'); setFormMessage('หากอีเมลนี้ใช้งานได้ ระบบได้ส่งรหัสยืนยันแล้ว');
      } else {
        const result = await api.completePasswordReset(email, code, password); resetView('login'); setPassword(''); setFormMessage(result.message);
      }
    } catch (reason) {
      setFormError((mode === 'register' || mode === 'registerVerify') ? registrationErrorMessage(reason) : (reason instanceof Error ? reason.message : 'ไม่สามารถดำเนินการได้'));
    }
    finally { setBusy(false); }
  };

  const showAccountRecovery = registrationState === 'EXISTING_ACCOUNT' || registrationState === 'EMPLOYEE_ALREADY_HAS_ACCOUNT';
  const registrationStep = mode === 'registerVerify' ? 2 : 1;
  const resetStep = mode === 'resetVerify' ? 2 : 1;

  return (
    <main className="login-page auth-experience-page">
      <section className="login-shell auth-experience-shell" aria-label="เข้าสู่ระบบ Security Management System">
        <aside className="login-intro auth-brand-panel">
          <div className="intro-brand auth-brand"><Logo /><span><b>SMS</b><strong>Security Management System</strong></span></div>
          <div className="intro-copy auth-brand-copy">
            <p className="auth-brand-eyebrow">SECURITY MANAGEMENT SYSTEM</p>
            <h1>บริหารงานรักษาความปลอดภัย<br />ในพื้นที่เดียว</h1>
            <p>จัดการข้อมูลบุคลากร ตารางกะ การลา และกฎการทำงานด้วยประสบการณ์เดียวกันทั้งระบบ</p>
            <div className="auth-brand-points" aria-label="ความสามารถหลักของระบบ">
              <span><SmsIcon name="employees" size={18} />ข้อมูลบุคลากร</span>
              <span><SmsIcon name="calendar" size={18} />ตารางกะและการลา</span>
              <span><SmsIcon name="shield" size={18} />สิทธิ์และกฎการทำงาน</span>
            </div>
          </div>
          <div className="auth-pastel-illustration auth-security-shield-scene" aria-hidden="true">
            <svg className="auth-security-shield" viewBox="0 0 420 290" role="presentation" focusable="false">
              <defs>
                <linearGradient id="security-shield-outer" x1="0" y1="0" x2="1" y2="1">
                  <stop className="auth-security-shield__stop auth-security-shield__stop--violet" offset="0%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--indigo" offset="52%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--cyan" offset="100%" />
                </linearGradient>
                <linearGradient id="security-shield-middle" x1="0" y1="1" x2="1" y2="0">
                  <stop className="auth-security-shield__stop auth-security-shield__stop--lavender" offset="0%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--violet" offset="50%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--sky" offset="100%" />
                </linearGradient>
                <radialGradient id="security-shield-inner" cx="50%" cy="42%" r="64%">
                  <stop className="auth-security-shield__stop auth-security-shield__stop--light" offset="0%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--mint" offset="42%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--indigo" offset="100%" />
                </radialGradient>
                <linearGradient id="security-shield-lock" x1="0" y1="0" x2="0" y2="1">
                  <stop className="auth-security-shield__stop auth-security-shield__stop--lock-top" offset="0%" />
                  <stop className="auth-security-shield__stop auth-security-shield__stop--lock-bottom" offset="100%" />
                </linearGradient>
                <filter id="security-shield-bloom" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="14" />
                </filter>
              </defs>
              <ellipse className="auth-security-shield__floor" cx="210" cy="254" rx="92" ry="13" />
              <ellipse className="auth-security-shield__bloom" cx="210" cy="154" rx="104" ry="96" filter="url(#security-shield-bloom)" />
              <g className="auth-security-shield__orbits" fill="none">
                <ellipse cx="210" cy="157" rx="151" ry="73" />
                <ellipse cx="210" cy="157" rx="124" ry="97" />
              </g>
              <g className="auth-security-shield__nodes">
                <circle cx="69" cy="135" r="4" /><circle cx="351" cy="135" r="4" />
                <circle cx="104" cy="211" r="3.5" /><circle cx="316" cy="211" r="3.5" />
                <rect x="111" y="82" width="9" height="9" rx="2" transform="rotate(45 115.5 86.5)" />
                <rect x="300" y="82" width="9" height="9" rx="2" transform="rotate(45 304.5 86.5)" />
              </g>
              <g className="auth-security-shield__body">
                <path className="auth-security-shield__outer" d="M210 46 L304 82 V145 C304 207 266 246 210 266 C154 246 116 207 116 145 V82 Z" fill="url(#security-shield-outer)" />
                <path className="auth-security-shield__middle" d="M210 66 L282 92 V145 C282 193 253 224 210 242 C167 224 138 193 138 145 V92 Z" fill="url(#security-shield-middle)" />
                <path className="auth-security-shield__inner" d="M210 86 L260 104 V144 C260 177 241 199 210 214 C179 199 160 177 160 144 V104 Z" fill="url(#security-shield-inner)" />
                <path className="auth-security-shield__axis" d="M210 57 V244" />
              </g>
              <g className="auth-security-shield__lock">
                <path className="auth-security-shield__lock-shackle" d="M190 145 V132 C190 120.95 198.95 112 210 112 C221.05 112 230 120.95 230 132 V145" fill="none" />
                <rect className="auth-security-shield__lock-body" x="181" y="142" width="58" height="47" rx="13" fill="url(#security-shield-lock)" />
                <circle className="auth-security-shield__keyhole" cx="210" cy="162" r="5" />
                <path className="auth-security-shield__keyhole-stem" d="M210 166 V174" />
              </g>
            </svg>
          </div>          <p className="auth-brand-footnote"><SmsIcon name="shield" size={16} />การเข้าถึงข้อมูลเป็นไปตามสิทธิ์ของบัญชีผู้ใช้งาน</p>
        </aside>
        <section className="login-form-panel auth-card-panel">
          <div className="login-theme-control auth-theme-control"><ThemeControl compact /></div>
          <div className="auth-mobile-brand"><Logo /><span><b>SMS</b><strong>Security Management System</strong></span></div>
          <form className="login-form auth-form" onSubmit={submit} aria-busy={busy}>
            {resultPresentation ? <section className={`auth-result auth-result--${resultPresentation.tone}`} aria-live="polite" aria-labelledby="registration-result-title">
              <div className="auth-result__verified"><span className="auth-result__verified-icon"><SmsIcon name="approval" size={20} /></span><span><b>ยืนยันอีเมลสำเร็จ</b><small>การยืนยันอีเมลยังไม่ใช่การอนุมัติบัญชี</small></span></div>
              <div className="auth-result__body">
                <h2 id="registration-result-title">{resultPresentation.heading}</h2>
                <p>{resultPresentation.body}</p>
                {resultPresentation.statusLabel && <div className="auth-result__status"><span>สถานะ</span><strong>{resultPresentation.statusLabel}</strong></div>}
              </div>
              <div className="auth-result__actions">
                <button className="btn-primary auth-primary-action" type="button" onClick={() => resetView('login')}>กลับหน้าเข้าสู่ระบบ</button>
                {resultPresentation.recovery && <button className="auth-secondary-action" type="button" onClick={() => resetView('reset')}>ลืมรหัสผ่าน</button>}
              </div>
            </section> : <>
              <header className="auth-form-heading">
                <span className="auth-form-kicker">SMS</span>
                <h2>{title}</h2><p className="form-lead">{lead}</p>
              </header>
              {(mode === 'register' || mode === 'registerVerify') && <AuthProgress flow="registration" current={registrationStep} />}
              {(mode === 'reset' || mode === 'resetVerify') && <AuthProgress flow="reset" current={resetStep} />}
              {(formError || (mode === 'login' ? auth.error : undefined)) && <div className="alert alert-error auth-alert" role="alert" aria-live="assertive"><SmsIcon name="shield" size={18} /><span>{formError || auth.error}</span></div>}
              {formMessage && <div className="login-help-action auth-notice" role="status" aria-live="polite"><SmsIcon name="approval" size={18} /><span>{formMessage}</span></div>}

              {mode === 'register' && <>
                <label className="field-group auth-field" htmlFor="registration-name"><span>ชื่อ-นามสกุล</span><input id="registration-name" value={submittedName} onChange={(event) => setSubmittedName(event.target.value)} type="text" minLength={2} maxLength={200} required autoComplete="name" /><small className="field-hint">ใช้สำหรับส่งคำขอให้ผู้ดูแลตรวจสอบ ข้อมูลนี้ไม่ใช่ข้อมูลยืนยันตัวบุคคลจาก Employee Master</small></label>
                <label className="field-group auth-field" htmlFor="registration-department"><span>หน่วยงาน / พื้นที่ <em>ถ้ามี</em></span><input id="registration-department" value={departmentHint} onChange={(event) => setDepartmentHint(event.target.value)} type="text" maxLength={100} /><small className="field-hint">ระบุหน่วยงานหรือพื้นที่เพื่อช่วยผู้ดูแลตรวจสอบ ข้อมูลนี้ไม่แก้ไข Employee Master</small></label>
              </>}

              {mode === 'registerVerify' && <div className="auth-otp-intro"><span><SmsIcon name="shield" size={18} /></span><div><b>เราได้ส่งรหัส 6 หลักไปยัง</b><strong>{maskedEmail}</strong></div></div>}
              {mode === 'resetVerify' && <div className="auth-otp-intro"><span><SmsIcon name="shield" size={18} /></span><div><b>กรอกรหัสยืนยันที่ได้รับทางอีเมล</b><strong>{maskedEmail}</strong><small>OTP และรหัสผ่านใหม่จะถูกตรวจสอบพร้อมกันเมื่อกดยืนยัน</small></div></div>}

              <label className="field-group auth-field" htmlFor="email"><span>อีเมล</span><input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@company.com" required autoComplete={mode === 'login' ? 'username' : 'email'} disabled={mode === 'registerVerify'} /></label>

              {(mode === 'registerVerify' || mode === 'resetVerify') && <label className="field-group auth-field auth-otp-field" htmlFor="otp-code"><span>รหัส OTP 6 หลัก</span><input id="otp-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" aria-describedby={mode === 'registerVerify' ? 'registration-otp-help' : undefined} placeholder="000000" /></label>}

              {(mode === 'login' || mode === 'register' || mode === 'resetVerify') && <label className="field-group auth-field" htmlFor="password"><span>{mode === 'resetVerify' ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}</span><span className="password-field auth-password-field"><input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder={mode === 'resetVerify' ? 'อย่างน้อย 8 ตัวอักษร' : 'กรอกรหัสผ่าน'} minLength={mode === 'login' ? undefined : 8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button className="password-toggle auth-password-toggle" type="button" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword} onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword((visible) => !visible)}><SmsIcon name={showPassword ? 'eyeOff' : 'eye'} size={18} /><span>{showPassword ? 'ซ่อน' : 'แสดง'}</span></button></span></label>}

              <button className="btn-primary auth-primary-action" type="submit" disabled={submitDisabled}>{busy ? 'กำลังดำเนินการ…' : mode === 'login' ? 'เข้าสู่ระบบ' : mode === 'register' ? 'ส่งคำขอและรหัส OTP' : mode === 'registerVerify' ? 'ยืนยันอีเมล' : mode === 'reset' ? 'ส่งรหัส OTP' : 'ตั้งรหัสผ่านใหม่'}</button>

              {mode === 'login' && passkeyEnabled && <div className="auth-passkey-zone"><div className="auth-or-separator"><span>หรือ</span></div><button className="auth-passkey-action" type="button" disabled={busy} onClick={signInWithPasskey}><SmsIcon name="key" size={19} /><span><b>เข้าสู่ระบบด้วย Passkey</b><small>Face ID • ลายนิ้วมือ • Windows Hello</small></span></button></div>}

              {mode === 'registerVerify' && <div className="auth-resend" id="registration-otp-help"><p>หากยังไม่พบอีเมล กรุณาตรวจสอบ Spam/Junk</p><button type="button" disabled={busy || resendSeconds > 0} onClick={resendRegistrationCode}>{resendSeconds > 0 ? `ส่งรหัสอีกครั้งใน ${resendSeconds} วินาที` : 'ส่งรหัสอีกครั้ง'}</button></div>}

              {mode === 'login' ? <div className="login-links auth-links">{!showAccountRecovery && <button type="button" onClick={() => resetView('register')}>ส่งคำขอลงทะเบียน</button>}<button type="button" onClick={() => resetView('reset')}>ลืมรหัสผ่าน</button></div> : <div className="login-links auth-links auth-links--back"><button type="button" onClick={() => resetView('login')}>กลับหน้าเข้าสู่ระบบ</button></div>}
              <p className="login-help auth-support-note">พบปัญหาการใช้งาน กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน</p>
            </>}
          </form>
        </section>
      </section>
    </main>
  );
}
const text = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);

const semanticStatusTone = (value: unknown) => {
  const status = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['APPROVED', 'ACTIVE', 'COMPLETED', 'COMPLETE', 'DONE', 'VALID', 'ENABLED', 'SUCCESS'].includes(status)) return 'success';
  if (['PENDING', 'WAITING', 'SUBMITTED', 'REQUESTED', 'IN_REVIEW', 'UNDER_REVIEW'].includes(status)) return 'warning';
  if (['EXPIRING', 'ATTENTION', 'DUE_SOON', 'RETURNED_FOR_CORRECTION'].includes(status)) return 'attention';
  if (['REJECTED', 'EXPIRED', 'CRITICAL', 'SUSPENDED', 'REVOKED', 'FAILED', 'ERROR'].includes(status)) return 'danger';
  if (['INFO', 'INFORMATIONAL'].includes(status)) return 'info';
  return 'neutral';
};
function ErrorAlert({ message, className = '' }: { message?: RequestErrorInput; className?: string }) {
  return message ? <div className={`alert alert-error ${className}`.trim()} role="alert" aria-live="assertive"><strong>ดำเนินการไม่สำเร็จ</strong><RequestErrorContent error={message} /></div> : null;
}
const date = (value: unknown) => {
  if (!value) return '-';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const thaiYear = d.getUTCFullYear() + 543;
  const thaiDayMonth = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return `${thaiDayMonth} ${thaiYear}`;
};
const formatApprovalDateTime = (value: unknown) => {
  if (!value) return '-';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const datePart = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(d);
  const timePart = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(d);
  return `${datePart} ${timePart}`;
};
const inputDate = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : '';
const nested = (value: unknown): DataRow => value && typeof value === 'object' ? value as DataRow : {};
const formPayload = (values: Record<string, string>, nullable: string[] = []) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nullable.includes(key) && value === '' ? null : value]));
const csvValue = (value: unknown) => `"${(value && typeof value === 'object' ? JSON.stringify(value) : text(value)).replace(/"/g, '""')}"`;
const quotaBalanceText = (entitlement: unknown, used: unknown) => `${text(entitlement)} สิทธิ์ / ${text(used)} ใช้แล้ว`;
const quotaMatchStatusText = (value: unknown) => {
  const status = String(value || '');
  if (status === 'MATCHED' || status === 'DUPLICATE_MATCHED') return status === 'DUPLICATE_MATCHED' ? 'จับคู่แล้ว (พบชื่อซ้ำ)' : 'จับคู่แล้ว';
  if (status === 'UNMATCHED' || status === 'DUPLICATE_UNMATCHED') return status === 'DUPLICATE_UNMATCHED' ? 'ยังไม่จับคู่ (พบชื่อซ้ำ)' : 'ยังไม่จับคู่';
  return text(value);
};
function downloadCsv(rows: DataRow[], filename: string) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [`\uFEFF${headers.map(csvValue).join(',')}`, ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EditDialog({ editor, busy, error, onClose }: { editor: Editor; busy: boolean; error?: RequestErrorInput; onClose(): void }) {
  const [values, setValues] = useState(editor.values);
  const [files, setFiles] = useState<Record<string, File>>({});
  const dialogRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>('input:not([type="file"]), select, textarea, button[type="submit"]');
      firstField?.focus({ preventScroll: true });
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await editor.submit(values, files);
  };
  const personnelEditor = editor.experience === 'personnel';
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className={`edit-dialog${personnelEditor ? ' personnel-editor' : ''}`} role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
      <div className="dialog-heading"><div><p className="eyebrow">{personnelEditor ? 'EMPLOYEE MASTER' : 'SMS staging'}</p><h2 id="edit-dialog-title">{editor.title}</h2></div><button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}><SmsIcon name="close" size={20} /></button></div>
      {error && <div className="alert alert-error"><RequestErrorContent error={error} /></div>}
      {editor.notice && <div className="preview-warning"><strong>ตรวจสอบข้อมูลเดิม</strong><p>{editor.notice}</p></div>}
      <form onSubmit={submit}>
        <div className="dialog-grid">{editor.fields.map((field) => <label className={['textarea', 'file'].includes(field.type || '') ? 'field-group full' : 'field-group'} key={field.name}><span>{field.label}</span>
          {field.type === 'select' ? <select required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}><option value="">— เลือก —</option>{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
            : field.type === 'textarea' ? <textarea required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              : field.type === 'file' ? <><input required={field.required} type="file" accept={field.accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) setFiles({ ...files, [field.name]: file }); }} />{field.hint && <small className="field-hint">{field.hint}</small>}</>
                : <input required={field.required} type={field.type || 'text'} step={field.type === 'number' ? '0.01' : undefined} min={field.min} max={field.max} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />}
        </label>)}</div>
        <div className="dialog-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button><button className="btn-primary compact" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : editor.submitLabel}</button></div>
      </form>
    </section>
  </div>;
}

function EmployeeMagicWandModal({
  target,
  scheduleMonth,
  token,
  busy,
  onClose,
  onSubmit
}: {
  target: DataRow;
  scheduleMonth: string;
  token?: string;
  busy: boolean;
  onClose(): void;
  onSubmit(autoContinue: boolean, startPhase: string, patternType: string): Promise<void>;
}) {
  const isSupervisorTarget = String(target.jobTitle || '').toLowerCase().includes('supervisor') || String(target.jobTitle || '').includes('หัวหน้า');
  const [patternType, setPatternType] = useState<'SUPERVISOR' | 'ROTATE'>(isSupervisorTarget ? 'SUPERVISOR' : 'ROTATE');
  const [autoContinue, setAutoContinue] = useState(false);
  const [startPhase, setStartPhase] = useState('D1');
  const [analysisText, setAnalysisText] = useState('วิเคราะห์จากประวัติ: เริ่มกะเช้าวันที่ 1 (D1)');
  const [suggestedCode, setSuggestedCode] = useState('D1');
  const modalRoot = useShiftEditorModalRoot();
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(!busy);
  onCloseRef.current = onClose;
  canCloseRef.current = !busy;

  useEffect(() => {
    if (!token || !target.id) return;
    api.previewEmployeeAutoSchedule(token, scheduleMonth, String(target.id), 'AUTO', 'ROTATE')
      .then((res) => {
        const analysis = nested(res.data).analysis as DataRow;
        if (analysis?.text) setAnalysisText(text(analysis.text));
        if (analysis?.code) {
          const code = text(analysis.code);
          setSuggestedCode(code);
          setStartPhase(code);
        }
      })
      .catch(() => {});
  }, [token, scheduleMonth, target.id]);

  useEffect(() => {
    const releaseScrollLock = acquireDocumentScrollLock();
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canCloseRef.current) onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseScrollLock();
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
  }, []);

  const [yearStr, monthStr] = (scheduleMonth || '2026-08').split('-');
  const dateObj = new Date(Date.UTC(Number(yearStr || 2026), Number(monthStr || 8) - 1, 1));
  const thaiMonthName = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(dateObj);
  const thaiYearStr = Number(yearStr || 2026) + 543;
  const thaiFullDateStr = `1 ${thaiMonthName} ${thaiYearStr}`;

  const empName = text(target.displayName || `${text(target.firstName)} ${text(target.lastName)}`);
  const empCode = text(target.employeeCode);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(autoContinue, autoContinue ? suggestedCode : startPhase, patternType);
  };

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose();
  };

  return createPortal(
    <div className="employee-magic-wand-modal__viewport" role="presentation" onMouseDown={handleBackdropMouseDown}>
      <section className="employee-magic-wand-modal__dialog magic-wand-dialog" role="dialog" aria-modal="true" aria-labelledby="magic-wand-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading">
          <h2 id="magic-wand-title">🪄 จัดกะแพทเทิร์นด่วน</h2>
          <button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="magic-wand-body">
            <div className="wand-emp-badge">
              <span>พนักงาน: <strong>{empName} ({empCode})</strong></span>
            </div>
            <p className="wand-analysis-blue-text">การจัดครั้งนี้จะใส่เป็นฉบับร่างล่าสุดของพนักงานทั้งเดือน โดยคงเฉพาะวันลา (AL) และ Admin override ไว้ ต้องกดบันทึกการเปลี่ยนแปลงทั้งหมดเพื่อบันทึกจริง</p>

            <div className="wand-section">
              <h3 className="wand-section-title">1. เลือกรูปแบบแพทเทิร์น (Pattern)</h3>
              <div className="wand-options-list">
                <label className={`wand-option-card ${patternType === 'SUPERVISOR' ? 'selected' : ''}`}>
                  <input
                    ref={initialFocusRef}
                    type="radio"
                    name="pattern-type"
                    checked={patternType === 'SUPERVISOR'}
                    onChange={() => setPatternType('SUPERVISOR')}
                  />
                  <div className="option-text">
                    <strong>กะหัวหน้างาน (Supervisor)</strong>
                    <p>เข้ากะเช้า 6 วัน (จันทร์-เสาร์) และหยุดวันอาทิตย์ (OFF) ทุกสัปดาห์</p>
                  </div>
                </label>

                <label className={`wand-option-card ${patternType === 'ROTATE' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="pattern-type"
                    checked={patternType === 'ROTATE'}
                    onChange={() => setPatternType('ROTATE')}
                  />
                  <div className="option-text">
                    <strong>กะพนักงานเวียนลูป 1 เดือน</strong>
                    <p>กะเช้า 6 วัน -&gt; หยุด 1 วัน -&gt; กะดึก 6 วัน -&gt; หยุด 1 วัน (วนลูปต่อเนื่อง)</p>
                  </div>
                </label>
              </div>
            </div>

            {patternType === 'ROTATE' && (
              <div className="wand-section">
                <h3 className="wand-section-title">2. เลือกจุดเริ่มของเดือนนี้ (สำหรับวันที่ {thaiFullDateStr})</h3>
                <label className="wand-checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoContinue}
                    onChange={(e) => setAutoContinue(e.target.checked)}
                  />
                  <span>🔍 เชื่อมต่อลูปจากเดือนก่อนหน้าอัตโนมัติ</span>
                </label>

                {autoContinue && (
                  <div className="wand-analysis-blue-text">
                    {analysisText}
                  </div>
                )}

                <div className="field-group phase-select-box">
                  <select
                    id="phase-select"
                    disabled={autoContinue}
                    value={autoContinue ? suggestedCode : startPhase}
                    onChange={(e) => setStartPhase(e.target.value)}
                  >
                    <option value="D1">กะเช้า วันที่ 1 (D1)</option>
                    <option value="D2">กะเช้า วันที่ 2 (D2)</option>
                    <option value="D3">กะเช้า วันที่ 3 (D3)</option>
                    <option value="D4">กะเช้า วันที่ 4 (D4)</option>
                    <option value="D5">กะเช้า วันที่ 5 (D5)</option>
                    <option value="D6">กะเช้า วันที่ 6 (D6)</option>
                    <option value="OFF-D">วันหยุด (OFF)</option>
                    <option value="N1">กะดึก วันที่ 1 (N1)</option>
                    <option value="N2">กะดึก วันที่ 2 (N2)</option>
                    <option value="N3">กะดึก วันที่ 3 (N3)</option>
                    <option value="N4">กะดึก วันที่ 4 (N4)</option>
                    <option value="N5">กะดึก วันที่ 5 (N5)</option>
                    <option value="N6">กะดึก วันที่ 6 (N6)</option>
                    <option value="OFF-N">วันหยุด (OFF)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
            <button className="btn-primary compact wand-submit-btn" type="submit" disabled={busy}>
              {busy ? 'กำลังสร้างร่าง…' : '🪄 ใส่ลงในฉบับร่าง'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    modalRoot
  );
}

type OperationalPage = Exclude<Page, 'dashboard' | 'employees' | 'attendance' | 'attendanceDevice' | 'profile' | 'reportCenter' | 'reports' | 'executiveReport' | 'shiftSetup' | 'settings' | 'leavePending' | 'leaveHistory' | 'dataQuality'>;

const tablePages: Record<OperationalPage, { title: string; eyebrow: string; description: string; columns: Array<{ label: string; value: (row: DataRow) => React.ReactNode }> }> = {
  licenses: { title: 'ใบอนุญาตพนักงาน', eyebrow: 'จัดการบุคลากร', description: 'ตรวจสอบประเภท เลขที่ สถานะ และวันหมดอายุใบอนุญาต', columns: [
    { label: 'พนักงาน', value: (row) => { const employee = nested(row.employee); return `${text(employee.firstName)} ${text(employee.lastName)}`; } },
    { label: 'รหัส', value: (row) => text(nested(row.employee).employeeCode) }, { label: 'ประเภท', value: (row) => text(row.licenseType) },
    { label: 'เลขที่ใบอนุญาต', value: (row) => text(row.licenseNumber) }, { label: 'วันหมดอายุ', value: (row) => date(row.expiryDate) },
    { label: 'สถานะ', value: (row) => <span className={`status-badge status-badge--${semanticStatusTone(row.status)}`}>{text(row.status)}</span> }, { label: 'ดูไฟล์', value: () => null }
  ] },
  schedule: { title: 'ตารางกะ', eyebrow: 'ตารางและกฎการทำงาน', description: 'ตารางกะย้อนหลังเรียงจากวันที่ล่าสุด', columns: [
    { label: 'วันที่', value: (row) => date(row.workDate) }, { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) },
    { label: 'หน่วยงาน', value: (row) => text(row.departmentSnapshot) }, { label: 'กะ', value: (row) => text(nested(row.shiftType).code) },
    { label: 'เวลา', value: (row) => `${text(row.startTime)}–${text(row.endTime)}` }, { label: 'ชั่วโมง', value: (row) => text(row.hours) }
  ] },
  approvals: { title: 'อนุมัติตารางกะ', eyebrow: 'ตารางและกฎการทำงาน', description: 'ประวัติสถานะและ revision การอนุมัติตาราง', columns: [
    { label: 'เดือน', value: (row) => date(row.month) }, { label: 'Revision', value: (row) => text(row.revision) },
    { label: 'สถานะ', value: (row) => <span className={`status-badge status-badge--${semanticStatusTone(row.status)}`}>{text(row.status)}</span> },
    { label: 'ประเภทการเปลี่ยน', value: (row) => text(row.changeType) }, { label: 'อนุมัติเมื่อ', value: (row) => date(row.approvedAt) }, { label: 'หมายเหตุ', value: (row) => text(row.approvalNote) }
  ] },
  rules: { title: 'กฎการทำงาน', eyebrow: 'ตารางและกฎการทำงาน', description: 'กฎที่ใช้ตรวจสอบและจัดตารางกำลังคน', columns: [
    { label: 'รหัสกฎ', value: (row) => text(row.ruleId) }, { label: 'ชื่อกฎ', value: (row) => text(row.name) },
    { label: 'ค่า', value: (row) => text(row.value) }, { label: 'หน่วย', value: (row) => text(row.unit) },
    { label: 'สถานะ', value: (row) => <span className={`status-badge ${row.enabled ? 'status-badge--success' : 'status-badge--neutral'}`}>{row.enabled ? 'เปิดใช้' : 'ปิดใช้'}</span> }
  ] },
  leave: { title: 'คำขอลา', eyebrow: 'การลา', description: 'ประวัติคำขอลาและสถานะการอนุมัติ', columns: [
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) }, { label: 'ประเภท', value: (row) => text(row.leaveType) },
    { label: 'วันที่เริ่ม', value: (row) => date(row.startDate) }, { label: 'วันที่สิ้นสุด', value: (row) => date(row.endDate) },
    { label: 'จำนวนวัน', value: (row) => text(row.dayCount) }, { label: 'สถานะ', value: (row) => <span className={`status-badge status-badge--${semanticStatusTone(row.status)}`}>{text(row.status)}</span> }
  ] },
  quota: { title: 'โควตาวันลา', eyebrow: 'การลา', description: 'แสดงสิทธิ์รายปี ใช้แล้ว และคงเหลือจากใบลาที่อนุมัติ', columns: [
    { label: 'ปี', value: (row) => row.quotaYear ? thaiQuotaYearLabel(Number(row.quotaYear)) : 'ข้อมูลเดิม — ยังไม่ระบุปี' },
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) },
    { label: 'ลาป่วย', value: (row) => quotaBalanceText(row.sickLeave, row.sickLeaveUsed) },
    { label: 'ลากิจ', value: (row) => quotaBalanceText(row.personalLeave, row.personalLeaveUsed) },
    { label: 'ลาพักร้อน', value: (row) => quotaBalanceText(row.vacationLeave, row.vacationLeaveUsed) },
    { label: 'การจับคู่ข้อมูล', value: (row) => quotaMatchStatusText(row.matchStatus) }
  ] },
  users: { title: 'ผู้ใช้และสิทธิ์', eyebrow: 'ผู้ดูแลระบบ', description: 'บัญชี บทบาท สถานะ และข้อกำหนดเปลี่ยนรหัสผ่าน', columns: [
    { label: 'ชื่อผู้ใช้', value: (row) => text(row.displayName) }, { label: 'อีเมล', value: (row) => text(row.email) },
    { label: 'บทบาท', value: (row) => text(row.role) }, { label: 'สถานะบัญชี', value: (row) => text(row.accountStatus) },
    { label: 'เปลี่ยนรหัสผ่าน', value: (row) => row.passwordResetRequired ? 'จำเป็น' : 'ไม่จำเป็น' }
  ] },
  audit: { title: 'ประวัติการทำรายการ', eyebrow: 'ผู้ดูแลระบบ', description: 'เหตุการณ์สำคัญของระบบโดยไม่แสดง payload ที่อ่อนไหว', columns: [
    { label: 'เวลา', value: (row) => date(row.createdAt) }, { label: 'เหตุการณ์', value: (row) => text(row.action) },
    { label: 'ประเภทข้อมูล', value: (row) => text(row.entityType) }, { label: 'ผู้ดำเนินการ', value: (row) => text(nested(row.actor).displayName) }
  ] }
};

function OperationalTable({ page, response, loading, error, onPageChange, onAction, onCreate, onNavigate, role, token, refreshSignal, onLicenseDocumentChanged, onEditLicense, licenseEmployeeStatus = 'ACTIVE', onLicenseEmployeeStatusChange }: { page: OperationalPage; response: DataResponse; loading: boolean; error?: RequestErrorInput; onPageChange(page: number): void; onAction(row: DataRow, action: string): void; onCreate(): void; onNavigate(page: Page): void; role: string; token?: string; refreshSignal: number; onLicenseDocumentChanged(message: string): void; onEditLicense?: (row: DataRow) => void; licenseEmployeeStatus?: LicenseEmployeeStatus; onLicenseEmployeeStatusChange?(status: LicenseEmployeeStatus): void }) {
  const config = tablePages[page];
  const rows = Array.isArray(response.data) ? response.data : [];
  const [tableSearch, setTableSearch] = useState('');
  const [selectedRow, setSelectedRow] = useState<DataRow>();
  const selectedRowId = useRef<string>();
  useEffect(() => { setTableSearch(''); setSelectedRow(undefined); }, [page]);
  const visibleRows = useMemo(() => {
    if (page !== 'licenses') return rows;
    const term = tableSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const employee = nested(row.employee);
      return [employee.employeeCode, employee.firstName, employee.lastName, employee.department, row.licenseType, row.licenseNumber, row.status, row.remark].map(text).join(' ').toLowerCase().includes(term);
    });
  }, [page, rows, tableSearch]);
  const actionPages = ['licenses', 'schedule', 'approvals', 'rules', 'leave', 'quota', 'users'];
  const canManage = ['ADMIN', 'MANAGER'].includes(role);
  const canEditRows = canManage && (page !== 'approvals' || role === 'ADMIN');
  const rowActions = (row: DataRow) => {
    if (!canEditRows || !actionPages.includes(page)) return null;
    if (page === 'approvals') return <><button className="btn-success compact" onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button className="btn-danger-outline compact" onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'leave') return <><button className="btn-success compact" onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button className="btn-danger-outline compact" onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'rules') return <><button className="btn-info-outline data-row-primary-action" onClick={() => onAction(row, 'edit')}>แก้ไข</button><button className="btn-neutral" onClick={() => onAction(row, 'toggle')}>{row.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button></>;
    if (page === 'licenses') return <><button className="btn-info-outline data-row-primary-action" aria-label="แก้ไขใบอนุญาต" onClick={() => (onEditLicense ? onEditLicense(row) : onAction(row, 'edit'))}>จัดการ</button>{role === 'ADMIN' && <DataRowActionMenu label="การทำงานเพิ่มเติมของใบอนุญาต" actions={[{ label: 'ลบใบอนุญาต', tone: 'danger', onSelect: () => onAction(row, 'delete') }]} />}</>;
    if (page === 'quota') return <><button className="btn-info-outline data-row-primary-action" onClick={() => onAction(row, 'edit')}>แก้ไขโควตา</button>{role === 'ADMIN' && (row.quotaYear === null || row.quotaYear === undefined || row.quotaYear === '') && <button className="btn-info compact" onClick={() => onAction(row, 'link')}>{row.employeeId ? 'จัดประเภทปี' : 'จับคู่พนักงานและปี'}</button>}</>;
    if (page === 'schedule') return <><button className="btn-info-outline" onClick={() => onAction(row, 'edit')}>แก้ไข</button><button className="btn-neutral" onClick={() => onAction(row, 'toggle-lock')}>{row.locked ? 'ปลดล็อก' : 'ล็อก'}</button><button className="btn-danger-outline compact" onClick={() => onAction(row, 'delete')}>ลบ</button></>;
    return <><button className="btn-info-outline" onClick={() => onAction(row, 'edit')}>สิทธิ์</button><button className="btn-neutral" onClick={() => onAction(row, 'reset-password')}>ตั้งรหัสผ่าน</button><button className="btn-neutral" onClick={() => onAction(row, 'toggle-user')}>{row.isActive ? 'ระงับ' : 'เปิดใช้'}</button></>;
  };
  const showActions = canEditRows && actionPages.includes(page);
  const canCreate = page === 'leave' || (canManage && ['schedule'].includes(page)) || (role === 'ADMIN' && page === 'licenses') || (page === 'quota' && canProvisionLeaveQuota(role));
  const createLabel = page === 'leave' ? '+ ส่งคำขอลา' : page === 'quota' ? '+ กำหนดโควตา' : '+ เพิ่มรายการ';
  const related: Partial<Record<typeof page, { page: Page; label: string }>> = {
    licenses: { page: 'employees', label: 'ข้อมูลพนักงาน' }, schedule: { page: 'approvals', label: 'อนุมัติตารางกะ' }, approvals: { page: 'schedule', label: 'ตารางกะรายเดือน' }, leave: { page: 'quota', label: 'โควตาวันลา' }, quota: { page: 'leave', label: 'คำขอลา' }, audit: { page: 'settings', label: 'Settings' }
  };
  const relatedPage = related[page];
  const showRelated = relatedPage && (relatedPage.page !== 'approvals' || role === 'ADMIN') && (relatedPage.page !== 'quota' || role === 'ADMIN');
  const noResultsMessage = page === 'licenses' && tableSearch ? 'ไม่พบใบอนุญาตที่ตรงกับคำค้นหา' : 'ยังไม่มีข้อมูลในหมวดนี้';
  const currentPage = response.meta?.page ?? 1;
  const totalPages = response.meta?.totalPages ?? 0;
  const documentServices = {
    list: async (licenseId: string) => (await api.licenseDocuments(token!, licenseId))?.data as LicenseDocument[] || [],
    view: async (documentId: string) => (await api.viewLicenseDocument(token!, documentId))?.data,
    approve: async (documentId: string) => { await api.approveLicenseDocument(token!, documentId); },
    returnForCorrection: async (documentId: string, reason: string) => { await api.returnLicenseDocumentForCorrection(token!, documentId, reason); },
    resubmit: async (documentId: string, data: { licenseNumber: string; proposedStartDate: string; proposedExpiryDate: string; note?: string }, file?: File) => { await api.resubmitLicenseDocument(token!, documentId, data, file); },
    reject: async (documentId: string, reason: string) => { await api.rejectLicenseDocument(token!, documentId, reason); },
    cancel: async (documentId: string) => { await api.cancelLicenseDocument(token!, documentId); },
    permanentlyDelete: async (documentId: string) => { await api.permanentlyDeleteLicenseDocument(token!, documentId); }
  };
  const tableValue = (row: DataRow, column: { label: string; value: (row: DataRow) => React.ReactNode }) => column.value(row);
  const licenseIdentity = (row: DataRow) => { const employee = nested(row.employee); return { id: String(row.id), licenseNumber: row.licenseNumber ? String(row.licenseNumber) : null, licenseType: row.licenseType ? String(row.licenseType) : null, issueDate: row.issueDate ? String(row.issueDate) : null, expiryDate: row.expiryDate ? String(row.expiryDate) : null, status: row.status ? String(row.status) : null, employee: { employeeCode: String(employee.employeeCode || ''), firstName: String(employee.firstName || ''), lastName: String(employee.lastName || ''), department: employee.department ? String(employee.department) : undefined } }; };
  const renderLicenseCell = (row: DataRow, column: { label: string; value: (row: DataRow) => React.ReactNode }) => {
    if (column.label === 'สถานะ' && token) return <LicenseTableDocumentColumns key={column.label} license={licenseIdentity(row)} summary={row.documentSummary as never} services={documentServices} isAdmin={role === 'ADMIN'} onChanged={onLicenseDocumentChanged} />;
    if (column.label === 'ดูไฟล์') return null;
    return <td key={column.label}>{tableValue(row, column)}</td>;
  };
  const selectRow = (row: DataRow) => { selectedRowId.current = String(row.id || ''); setSelectedRow(row); };
  const closeDrawer = () => {
    const id = selectedRowId.current;
    setSelectedRow(undefined);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-operational-row="${id}"]`)?.focus());
  };
  const selectedEmployee = selectedRow ? nested(selectedRow.employee) : {};
  const drawerTitle = selectedRow ? (page === 'licenses' ? `${text(selectedEmployee.firstName)} ${text(selectedEmployee.lastName)}`.trim() || text(selectedRow.licenseNumber) : page === 'quota' ? text(selectedRow.employeeNameSnapshot) : text(selectedRow.name || selectedRow.title || selectedRow.displayName || selectedRow.ruleType || selectedRow.id)) : '';
  const drawerSubtitle = selectedRow ? (page === 'licenses' ? [selectedEmployee.employeeCode, selectedEmployee.department, selectedRow.licenseType].filter(Boolean).map(text).join(' · ') : page === 'quota' ? (selectedRow.quotaYear ? thaiQuotaYearLabel(Number(selectedRow.quotaYear)) : 'ข้อมูลเดิม — ยังไม่ระบุปี') : config.description) : '';
  const drawerFields = selectedRow ? config.columns.filter((column) => column.label !== 'ดูไฟล์').slice(0, 8).map((column) => ({ label: column.label, value: tableValue(selectedRow, column) })) : [];
  let primaryAction: OperationalDrawerAction | undefined;
  const secondaryActions: OperationalDrawerAction[] = [];
  if (selectedRow && canEditRows) {
    if (page === 'licenses') primaryAction = { label: 'จัดการใบอนุญาตและเอกสาร', icon: 'license', onSelect: () => { const row = selectedRow; closeDrawer(); (onEditLicense ? onEditLicense(row) : onAction(row, 'edit')); } };
    else if (page === 'quota') primaryAction = { label: 'แก้ไขโควตา', icon: 'edit', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'edit'); } };
    else if (page === 'rules') primaryAction = { label: 'แก้ไขกฎ', icon: 'edit', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'edit'); } };
    else if (page === 'schedule') primaryAction = { label: 'แก้ไขกะ', icon: 'calendar', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'edit'); } };
    else if (page === 'approvals' || page === 'leave') primaryAction = { label: 'อนุมัติ', icon: 'check', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'approve'); } };
    if (page === 'rules') secondaryActions.push({ label: selectedRow.enabled ? 'ปิดใช้กฎ' : 'เปิดใช้กฎ', tone: 'secondary', icon: 'pause', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'toggle'); } });
    if (page === 'quota' && role === 'ADMIN' && (selectedRow.quotaYear === null || selectedRow.quotaYear === undefined || selectedRow.quotaYear === '')) secondaryActions.push({ label: selectedRow.employeeId ? 'จัดประเภทปี' : 'จับคู่พนักงานและปี', tone: 'secondary', icon: 'users', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'link'); } });
    if (page === 'licenses' && role === 'ADMIN') secondaryActions.push({ label: 'ลบใบอนุญาต', tone: 'danger', icon: 'close', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'delete'); } });
  }
  return <section className={`view-pane data-surface-page data-surface-page--${page}`}>
    <div className="page-heading signature-page-header"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div><div className="heading-actions signature-page-actions">{showRelated && <button className="btn-neutral small-action" onClick={() => onNavigate(relatedPage.page)}>{relatedPage.label}</button>}{canCreate && <button className="btn-primary compact" onClick={onCreate}>{createLabel}</button>}<span className="record-chip">ทั้งหมด {response.meta?.total ?? rows.length} รายการ</span><div className="signature-page-utilities"><button className="btn-info small-action" disabled={!visibleRows.length} onClick={() => downloadCsv(visibleRows, page)}>CSV</button><button className="btn-info small-action" onClick={() => window.print()}>พิมพ์ / PDF</button></div></div></div>
    <ErrorAlert message={error} />
    {page === 'licenses' && <div className="toolbar data-toolbar signature-filter-bar"><label className="search-box data-search-control"><span aria-hidden="true"><SmsIcon name="search" size={17} /></span><input aria-label="ค้นหาใบอนุญาต" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="ค้นหารหัสพนักงาน ชื่อ เลขที่ใบอนุญาต หรือสถานะ" /></label><label className="license-employee-status-filter"><span>สถานะพนักงาน</span><select aria-label="กรองสถานะพนักงาน" value={licenseEmployeeStatus} onChange={(event) => { onLicenseEmployeeStatusChange?.(event.target.value as LicenseEmployeeStatus); onPageChange(1); }}><option value="ACTIVE">ปฏิบัติงาน</option><option value="INACTIVE">พ้นสภาพ</option><option value="ALL">ทั้งหมด</option></select></label><span className="toolbar-count data-result-count">แสดง {visibleRows.length} จาก {rows.length} รายการ</span>{tableSearch && <button className="btn-neutral small-action" type="button" onClick={() => setTableSearch('')}>ล้างคำค้นหา</button>}</div>}
    <div className="table-card data-surface-card signature-data-surface">{loading ? <div className="signature-table-skeleton" role="status" aria-label="กำลังอ่านข้อมูล">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div> : <><div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table"><thead><tr>{config.columns.map((column) => <th key={column.label}>{column.label}</th>)}{showActions && <TableActionHeader label="ดำเนินการ" />}</tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={text(row.id) + index} className="signature-data-row" data-operational-row={text(row.id)} tabIndex={0} aria-label={`เปิดรายละเอียด ${config.title}`} onClick={() => selectRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRow(row); } }}>{config.columns.map((column) => page === 'licenses' ? renderLicenseCell(row, column) : <td key={column.label}>{tableValue(row, column)}</td>)}{showActions && <TableActionCell className="row-actions data-row-actions" onClick={(event) => event.stopPropagation()}>{rowActions(row)}</TableActionCell>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows data-table-empty-cell"><div className="empty-state data-state data-state--empty"><span aria-hidden="true">⌁</span><strong>{noResultsMessage}</strong><p>{page === 'licenses' && tableSearch ? 'ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองแล้วค้นหาอีกครั้ง' : 'ยังไม่มีรายการที่ต้องดำเนินการในขอบเขตนี้'}</p>{canCreate && !(page === 'licenses' && tableSearch) && <button className="btn-neutral small-action" onClick={onCreate}>{createLabel}</button>}</div></td></tr>}</tbody></table></div><div className="signature-mobile-records">{visibleRows.map((row) => <button type="button" key={`mobile-${text(row.id)}`} className="signature-mobile-record" data-operational-row={text(row.id)} onClick={() => selectRow(row)}><span className="signature-mobile-record__eyebrow">{config.eyebrow}</span><strong>{page === 'licenses' ? `${text(nested(row.employee).firstName)} ${text(nested(row.employee).lastName)}` : text(row.employeeNameSnapshot || row.name || row.displayName || row.ruleType || row.id)}</strong><div>{config.columns.slice(0, 3).map((column) => <span key={column.label}><small>{column.label}</small>{tableValue(row, column)}</span>)}</div><em>แตะเพื่อเปิดรายละเอียด</em></button>)}</div></>}</div>
    {totalPages > 1 && <div className="pagination-bar data-pagination"><button aria-label="หน้าก่อนหน้า" disabled={currentPage <= 1 || loading} onClick={() => onPageChange(currentPage - 1)}>‹ ก่อนหน้า</button><span>หน้า {currentPage} จาก {totalPages}</span><button aria-label="หน้าถัดไป" disabled={currentPage >= totalPages || loading} onClick={() => onPageChange(currentPage + 1)}>หน้าถัดไป ›</button></div>}
    <OperationalRecordDrawer open={Boolean(selectedRow)} eyebrow={config.eyebrow} title={drawerTitle || config.title} subtitle={drawerSubtitle} status={selectedRow?.status ? <span className={`status-badge status-badge--${semanticStatusTone(selectedRow.status)}`}>{text(selectedRow.status)}</span> : undefined} fields={drawerFields} primaryAction={primaryAction} secondaryActions={secondaryActions} onClose={closeDrawer} />
  </section>;
}
const defaultNewLeaveTemplate = `🔔 [คำขอลางานใหม่] รอตรวจรับเอกสาร
--------------------------------
👤 พนักงาน: {Name}
📍 แผนก/พื้นที่: {Department}
📋 ประเภท: {Type} ({Days} วัน)
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}
📎 ไฟล์แนบ: {FileUrl}
--------------------------------
⚙️ จัดการใบลาคลิกที่ระบบ Security Management System`;
const defaultLeaveStatusTemplate = `📢 [อัปเดตสถานะใบลาจากระบบ]
--------------------------------
👤 พนักงาน: {Name}
📋 ประเภท: {Type} ({Days} วัน)
🔄 ผลการตรวจรับ: {Status}
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}`;

function SettingsPage({ settings, loading, error, onRefresh, onSaveTemplates, onSaveAttendancePolicy, onAudit }: { settings: DataRow[]; loading: boolean; error?: RequestErrorInput; onRefresh(): void; onSaveTemplates(newLeave: string, leaveStatus: string): Promise<void>; onSaveAttendancePolicy(policy: AttendancePolicyForm): Promise<void>; onAudit(): void }) {
  const readSetting = (key: string, fallback: string) => String(settings.find((setting) => setting.key === key)?.value || fallback);
  const [newLeaveTemplate, setNewLeaveTemplate] = useState(defaultNewLeaveTemplate);
  const [leaveStatusTemplate, setLeaveStatusTemplate] = useState(defaultLeaveStatusTemplate);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setNewLeaveTemplate(readSetting('LINE_TEMPLATE_NEW_LEAVE', defaultNewLeaveTemplate));
    setLeaveStatusTemplate(readSetting('LINE_TEMPLATE_LEAVE_STATUS', defaultLeaveStatusTemplate));
  }, [settings]);
  const attendanceSettingKeys = new Set<string>(Object.values(attendancePolicyKeys));
  const visibleSettings = settings.filter((setting) => !['LINE_TEMPLATE_NEW_LEAVE', 'LINE_TEMPLATE_LEAVE_STATUS'].includes(String(setting.key)) && !attendanceSettingKeys.has(String(setting.key)));
  const saveTemplates = async () => {
    setSaving(true); setNotice(undefined);
    try { await onSaveTemplates(newLeaveTemplate, leaveStatusTemplate); setNotice('บันทึกเทมเพลตการแจ้งเตือนสำเร็จแล้ว'); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'บันทึกเทมเพลตไม่สำเร็จ'); }
    finally { setSaving(false); }
  };
  return <section className="view-pane settings-page">
    <div className="page-heading settings-heading"><div><h1>Settings</h1><p>ตั้งค่าระบบและการแจ้งเตือน โดยไม่เก็บ token หรือความลับไว้ในฐานข้อมูล</p></div><div className="heading-actions"><button className="btn-neutral small-action" disabled={!visibleSettings.length} onClick={() => downloadCsv(visibleSettings, 'smsv3-settings')}>⇧ Export</button><button className="btn-neutral small-action" onClick={onAudit}>Audit Log</button><button className="btn-primary compact" disabled title="SMS ไม่ใช้ Google Sheets เป็นแหล่งข้อมูลหลัก">↻ Google Sheets ถูกยกเลิก</button></div></div>
    {error && <div className="alert alert-error"><RequestErrorContent error={error} /></div>}
    <div className="table-card settings-table-card">{loading ? <div className="loading-row">กำลังอ่านข้อมูล Settings…</div> : <div className="table-scroll"><table className="data-table settings-table"><thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead><tbody>{visibleSettings.length ? visibleSettings.map((setting) => <tr key={text(setting.key)}><td><code>{text(setting.key)}</code></td><td>{setting.configured === undefined ? text(setting.value) : <span className={setting.configured ? 'status-badge active' : 'status-badge inactive'}>{setting.configured ? 'Configured' : 'Not configured'}</span>}</td><td>{text(setting.description)}</td></tr>) : <tr><td colSpan={3} className="no-rows">ยังไม่มีข้อมูล Settings ที่นำเข้าจากระบบเดิม</td></tr>}</tbody></table></div>}</div>
    <AttendancePolicySettingsCard settings={settings} onSave={onSaveAttendancePolicy} onRefresh={onRefresh} />
    <section className="line-settings-card">
      <div className="line-settings-title"><span>💬</span><div><h2>LINE Notification Settings (ตั้งค่าแจ้งเตือน LINE)</h2><p>รูปแบบเดิมถูกคงไว้ แต่ credential ต้องตั้งค่าที่ Vercel Environment Variables เท่านั้น</p></div></div>
      <div className="line-secure-grid"><label className="field-group"><span>LINE Access Token / Channel Access Token</span><input type="password" value="••••••••••••••••" disabled aria-label="LINE access token is managed securely" /><small>ไม่แสดงและไม่บันทึก token ในหน้าจอนี้</small></label><label className="field-group"><span>LINE Group ID / Target ID</span><input type="text" value="จัดการผ่าน deployment configuration" disabled /><small>ตั้งค่าจาก Vercel Environment Variables เมื่อเปิดใช้ provider ที่อนุมัติ</small></label></div>
      <div className="line-template-grid"><label className="field-group"><span>🔔 เทมเพลตคำขอลางานใหม่ (New Leave Request Template)</span><textarea rows={7} value={newLeaveTemplate} onChange={(event) => setNewLeaveTemplate(event.target.value)} maxLength={2000} /></label><label className="field-group"><span>📢 เทมเพลตอัปเดตสถานะใบลา (Leave Status Update Template)</span><textarea rows={7} value={leaveStatusTemplate} onChange={(event) => setLeaveStatusTemplate(event.target.value)} maxLength={2000} /></label></div>
      <div className="template-help"><strong>💡 ตัวแปรที่ใช้ในข้อความได้</strong><span><code>{'{Name}'}</code> พนักงาน</span><span><code>{'{Department}'}</code> แผนก</span><span><code>{'{Type}'}</code> ประเภทการลา</span><span><code>{'{Days}'}</code> จำนวนวัน</span><span><code>{'{StartDate}'}</code> / <code>{'{EndDate}'}</code> วันที่ลา</span><span><code>{'{Reason}'}</code> เหตุผล</span><span><code>{'{FileUrl}'}</code> ไฟล์แนบ</span><span><code>{'{Status}'}</code> สถานะ</span></div>
      {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
      <div className="line-settings-actions"><button className="btn-primary compact" disabled={saving} onClick={saveTemplates}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึกเทมเพลตการแจ้งเตือน'}</button><button className="btn-neutral small-action" disabled title="การส่ง LINE ยังไม่เปิดใช้ใน staging">🔔 ทดสอบส่งข้อความแจ้งเตือน</button><button className="btn-neutral small-action" onClick={onRefresh}>↻ รีเฟรช</button></div>
      <p className="line-settings-footnote">สถานะปัจจุบัน: การส่ง LINE ยังไม่เปิดใช้งานใน staging — การบันทึกด้านบนเก็บเฉพาะเทมเพลตที่ไม่มีข้อมูลลับ</p>
    </section>
  </section>;
}

interface ShiftEditorModalProps {
  shift?: DataRow;
  defaults?: Record<string, string>;
  employees: DataRow[];
  shiftTypes: DataRow[];
  licenses: DataRow[];
  isAdmin: boolean;
  onClose: () => void;
  onSubmit: (data: {
    employeeId: string;
    workDate: string;
    shiftTypeId: string;
    remark: string;
    licenseOverride: boolean;
    overrideReason: string;
  }) => void;
}

let ownedModalRoot: HTMLElement | null = null;
let modalRootUsers = 0;

function getOrCreateModalRoot() {
  const existingRoot = document.getElementById('modal-root');
  if (existingRoot) return existingRoot;

  const modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  document.body.appendChild(modalRoot);
  ownedModalRoot = modalRoot;
  return modalRoot;
}

function useShiftEditorModalRoot() {
  const [modalRoot] = useState<HTMLElement>(getOrCreateModalRoot);

  useEffect(() => {
    modalRootUsers += 1;

    return () => {
      modalRootUsers = Math.max(0, modalRootUsers - 1);
      window.setTimeout(() => {
        if (modalRootUsers === 0 && modalRoot === ownedModalRoot && modalRoot.childElementCount === 0) {
          modalRoot.remove();
          ownedModalRoot = null;
        }
      }, 0);
    };
  }, [modalRoot]);

  return modalRoot;
}

function ShiftEditorModal({ shift, defaults, employees, shiftTypes, licenses, isAdmin, onClose, onSubmit }: ShiftEditorModalProps) {
  const initialEmpId = String(shift?.employeeId || defaults?.employeeId || employees[0]?.id || '');
  const initialDate = shift ? inputDate(shift.workDate) : String(defaults?.workDate || '');
  const initialType = String(shift?.shiftTypeId || nested(shift?.shiftType).id || defaults?.shiftTypeId || shiftTypes[0]?.id || '');
  const initialRemark = String(shift?.remark || '');
  const initialOverride = Boolean(shift?.licenseOverride);
  const initialOverrideReason = String(shift?.overrideReason || '');

  const [employeeId, setEmployeeId] = useState(initialEmpId);
  const [workDate, setWorkDate] = useState(initialDate);
  const [shiftTypeId, setShiftTypeId] = useState(initialType);
  const [remark, setRemark] = useState(initialRemark);
  const [licenseOverride, setLicenseOverride] = useState(initialOverride);
  const [overrideReason, setOverrideReason] = useState(initialOverrideReason);
  const [modalError, setModalError] = useState<string | null>(null);
  const modalRoot = useShiftEditorModalRoot();
  const initialFocusRef = useRef<HTMLSelectElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const selectedEmp = employees.find((e) => String(e.id) === employeeId);
  const empName = selectedEmp ? String(selectedEmp.displayName || `${String(selectedEmp.firstName || '')} ${String(selectedEmp.lastName || '')}`).trim() : 'พนักงาน';

  const dateVal = workDate ? new Date(`${workDate}T00:00:00Z`) : null;
  const dayNameStr = dateVal ? new Intl.DateTimeFormat('th-TH', { weekday: 'long', timeZone: 'UTC' }).format(dateVal) : '';
  const dayNumStr = dateVal ? dateVal.getUTCDate() : '';
  const monthNameStr = dateVal ? new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: 'UTC' }).format(dateVal) : '';
  const formattedTitleDate = dateVal ? `${dayNameStr} ${dayNumStr} ${monthNameStr}` : workDate;

  const titleStr = shift ? `แก้กะ: ${empName} · ${formattedTitleDate}` : `เพิ่มกะ: ${empName} · ${formattedTitleDate}`;

  const selectedType = shiftTypes.find((t) => String(t.id) === shiftTypeId);
  const shiftCode = String(selectedType?.code || '').toUpperCase();
  const isWorkingShift = !['OFF', 'AL'].includes(shiftCode);

  const empLicenses = licenses.filter((l) => {
    const eId = String(l.employeeId || nested(l.employee).id || '');
    return eId === employeeId;
  });
  const activeLicenses = empLicenses.filter((l) => ['active', 'valid'].includes(String(l.status || '').trim().toLowerCase()));
  const validLic = activeLicenses.find((l) => {
    const issue = l.issueDate ? inputDate(l.issueDate) : '';
    const expiry = l.expiryDate ? inputDate(l.expiryDate) : '';
    return issue && expiry && issue <= workDate && expiry >= workDate;
  });

  const isInvalidLicense = isWorkingShift && !validLic;

  const formatThaiYearDate = (dStr?: unknown) => {
    if (!dStr) return '';
    const d = new Date(String(dStr));
    if (isNaN(d.getTime())) return String(dStr);
    const day = d.getUTCDate();
    const monthName = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(d);
    const thaiYear = d.getUTCFullYear() + 543;
    return `${day} ${monthName} ${thaiYear}`;
  };

  let warningDetailText = 'ไม่พบข้อมูลใบอนุญาต รปภ. ในระบบที่ครอบคลุมวันที่จัดกะนี้';
  if (activeLicenses.length > 0) {
    const lic = activeLicenses[0];
    const issueStr = formatThaiYearDate(lic.issueDate);
    const expiryStr = formatThaiYearDate(lic.expiryDate);
    if (lic.issueDate && inputDate(lic.issueDate) > workDate) {
      warningDetailText = `ใบอนุญาตยังไม่ถึงวันเริ่มใช้งาน · วันหมดอายุ ${expiryStr}`;
    } else if (lic.expiryDate && inputDate(lic.expiryDate) < workDate) {
      warningDetailText = `ใบอนุญาตหมดอายุแล้วเมื่อ ${expiryStr}`;
    } else {
      warningDetailText = `ใบอนุญาตไม่อยู่ในสถานะที่ใช้งานได้ · วันหมดอายุ ${expiryStr}`;
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (isInvalidLicense && !licenseOverride) {
      setModalError('ใบอนุญาตไม่ผ่านเกณฑ์ กรุณายืนยัน Override (เฉพาะ Admin) หรือเปลี่ยนเป็นกะ OFF / AL');
      return;
    }

    if (isInvalidLicense && licenseOverride && overrideReason.trim().length < 5) {
      setModalError('กรุณาระบุเหตุผล Override อย่างน้อย 5 ตัวอักษร');
      return;
    }

    onSubmit({
      employeeId,
      workDate,
      shiftTypeId,
      remark: remark || 'Manual batch edit',
      licenseOverride: isInvalidLicense ? licenseOverride : false,
      overrideReason: isInvalidLicense && licenseOverride ? overrideReason : ''
    });
  };

  useEffect(() => {
    const releaseScrollLock = acquireDocumentScrollLock();
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseScrollLock();
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
  }, []);

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div className="shift-editor-modal__viewport" role="presentation" onMouseDown={handleBackdropMouseDown}>
      <section
        className="shift-editor-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="shift-editor-title" style={{ margin: '0 0 16px 0', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
          {titleStr}
        </h3>

        {modalError && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 600 }}>
            {modalError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="schedule-modal-form-grid" style={{ display: 'grid', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Shift
              </label>
              <select
                ref={initialFocusRef}
                value={shiftTypeId}
                onChange={(e) => setShiftTypeId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: 600 }}
              >
                {shiftTypes.map((t) => (
                  <option key={String(t.id)} value={String(t.id)}>
                    {String(t.code || '')} · {String(t.name || '')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                หมายเหตุ
              </label>
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Manual batch edit"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff' }}
              />
            </div>
          </div>

          {isInvalidLicense && (
            <div style={{
              backgroundColor: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px',
              color: '#9f1239'
            }}>
              <div style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', color: '#be123c', marginBottom: '6px' }}>
                <span>⚠️</span> ไม่สามารถลงกะทำงานตามปกติได้
              </div>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#881337', lineHeight: '1.5' }}>
                {warningDetailText}
              </p>

              {isAdmin ? (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', color: '#0f172a', cursor: 'pointer', marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={licenseOverride}
                      onChange={(e) => setLicenseOverride(e.target.checked)}
                    />
                    Admin ยืนยันจัดกะแบบ Manual แม้ใบอนุญาตไม่ผ่าน
                  </label>

                  {licenseOverride && (
                    <div style={{ marginTop: '10px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        เหตุผล Override *
                      </label>
                      <textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="ระบุเหตุผลอย่างน้อย 5 ตัวอักษร"
                        rows={2}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                  <small style={{ display: 'block', color: '#be123c', marginTop: '8px', fontSize: '11px', lineHeight: '1.4' }}>
                    การอนุมัตินี้จะถูกบันทึกใน License Audit Log พร้อมชื่อ Admin และเวลา
                  </small>
                </>
              ) : (
                <small style={{ color: '#be123c', fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '4px' }}>
                  * เฉพาะ Admin เท่านั้นที่สามารถ Overrule ใบอนุญาตที่ไม่ผ่านได้
                </small>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 18px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ยกเลิก
            </button>

            <button
              type="submit"
              style={{
                padding: '9px 20px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.4)'
              }}
            >
              เก็บรายการนี้ (ยังไม่บันทึก)
            </button>
          </div>
        </form>
      </section>
    </div>,
    modalRoot
  );
}

function LeaveManagementPage({ rows, loading, error, linked, remaining, quotaYear, employeeId, currentUserId, currentUserRole, canManage, canSubmit, canCancelApprovedLeave, mutationsEnabled = true, mode = 'all', historyScope = 'mine', historyMonth, historyTotal, historyPage, historyTotalPages, historyStatusCounts, employeeOptions, onSubmit, onApprove, onReject, onReturnForCorrection, onEditReturned, onCancel, onRefresh, onHistoryMonthChange, onHistoryMonthStep, onHistoryPageChange, onAttachment, onPrint }: { rows: DataRow[]; loading: boolean; error?: RequestErrorInput; linked: boolean; remaining: DataRow; quotaYear?: number; employeeId?: string; currentUserId?: string; currentUserRole?: string; canManage: boolean; canSubmit: boolean; canCancelApprovedLeave: boolean; mutationsEnabled?: boolean; mode?: 'all' | 'pending' | 'history'; historyScope?: 'mine' | 'all'; historyMonth?: string; historyTotal?: number; historyPage?: number; historyTotalPages?: number; historyStatusCounts?: Record<string, number>; employeeOptions: Array<{ value: string; label: string }>; onSubmit(values: Record<string, string>, file?: File): Promise<void>; onApprove(row: DataRow): void; onReject(row: DataRow): void; onReturnForCorrection(row: DataRow): void; onEditReturned(row: DataRow): void; onCancel(row: DataRow): void; onRefresh(): void; onHistoryMonthChange?(value: string): void; onHistoryMonthStep?(delta: number): void; onHistoryPageChange?(page: number): void; onAttachment(row: DataRow): void; onPrint(row: DataRow): void }) {
  const [form, setForm] = useState({ employeeId: '', leaveType: '', startDate: '', endDate: '', substitute: '', reason: '' });
  const [file, setFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [submitError, setSubmitError] = useState<RequestErrorInput>();
  const [selectedPendingId, setSelectedPendingId] = useState<string>();
  const pendingRows = rows.filter((row) => row.status === 'PENDING');
  const historyRows = historyScope === 'all' ? rows : rows.filter((row) => String(row.employeeId || '') === String(employeeId || ''));
  const days = form.startDate && form.endDate ? Math.max(0, Math.floor((Date.parse(`${form.endDate}T00:00:00Z`) - Date.parse(`${form.startDate}T00:00:00Z`)) / 86400000) + 1) : 0;
  const requiresAttachment = form.leaveType.includes('ป่วย') && days > 3;

  const todayBkk = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const todayString = `${todayBkk.getFullYear()}-${String(todayBkk.getMonth() + 1).padStart(2, '0')}-${String(todayBkk.getDate()).padStart(2, '0')}`;
  const isRetroactive = form.startDate ? form.startDate < todayString : false;

  const formReady = Boolean((canManage ? form.employeeId : linked) && form.leaveType && form.startDate && form.endDate && form.substitute.trim() && (!isRetroactive || form.reason.trim()) && (!requiresAttachment || file));
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mutationsEnabled || !formReady) return;
    setSubmitting(true); setNotice(undefined); setSubmitError(undefined);
    try {
      const payload: Record<string, string> = { ...form };
      if (!canManage) delete payload.employeeId;
      await onSubmit(payload, file);
      setForm({ employeeId: '', leaveType: '', startDate: '', endDate: '', substitute: '', reason: '' }); setFile(undefined); setSubmitError(undefined); setNotice('ส่งคำขอลาสำเร็จแล้ว');
    }
    catch (reason) { setNotice(undefined); setSubmitError(toRequestErrorState(reason, 'ส่งคำขอลาไม่สำเร็จ')); }
    finally { setSubmitting(false); }
  };
  const status = (row: DataRow) => { const actorName = row.approvedByDisplayName ? String(row.approvedByDisplayName) : ''; const actorRole = String(row.approvedByRole || 'ผู้อนุมัติ'); const actionDate = row.approvedAt ? String(date(row.approvedAt)) : ''; return <div className="leave-status-cell"><span className={`status-badge status-badge--${semanticStatusTone(row.status)}`}>{String(text(row.status))}</span>{actorName ? <small className="leave-action-log">ดำเนินการโดย {actorName} ({actorRole})<br />วันที่ {actionDate}</small> : null}</div>; };
  const leaveEmployeeContext = (row: DataRow) => {
    const employee = nested(row.employee);
    return [employee.employeeCode, row.departmentSnapshot]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map(String)
      .join(' · ');
  };
  const leaveTable = (items: DataRow[], actions = false, emptyMessage = 'ไม่มีรายการ', mobileHistory = false) => {
    const showHistoryActions = !actions && (canCancelApprovedLeave || items.some((row) => Boolean(row.canEditReturned || row.canCancelReturned)));
    const renderHistoryActions = (row: DataRow) => <>
      {row.status === 'RETURNED_FOR_CORRECTION' && row.canEditReturned ? <button className="btn-primary compact" disabled={!mutationsEnabled} onClick={() => onEditReturned(row)}>แก้ไขและส่งตรวจสอบอีกครั้ง</button> : null}
      {row.status === 'RETURNED_FOR_CORRECTION' && row.canCancelReturned ? <button className="danger-action" disabled={!mutationsEnabled} onClick={() => onCancel(row)}>ยกเลิกคำขอ</button> : null}
      {row.status === 'APPROVED' && canCancelApprovedLeave ? <button className="danger-action" disabled={!mutationsEnabled} onClick={() => onCancel(row)}>ยกเลิกใบลาที่อนุมัติแล้ว</button> : null}
    </>;
    return <>
      <div className={`table-scroll data-table-scroll ${mobileHistory ? 'leave-history-desktop-table' : ''}`.trim()}>
        <table className="data-table leave-data-table data-surface-table">
          <thead><tr><th>พนักงาน</th><th>ประเภทลา</th><th>วันที่ลา</th><th>วัน</th><th>แทน / เหตุผล</th><th>เอกสาร</th>{!actions && <th>สถานะ</th>}<th>พิมพ์</th>{(actions || showHistoryActions) && <th>จัดการ</th>}</tr></thead>
          <tbody>{items.length ? items.map((row) => <tr key={text(row.id)}>
            <td className="employee-name">{text(row.employeeNameSnapshot)}<small className="cell-note">{text(row.departmentSnapshot)}</small></td>
            <td>{text(row.leaveType)}{row.isRetroactive ? <span className="status-badge status-badge--attention leave-retro-badge">ย้อนหลัง</span> : null}</td>
            <td>{date(row.startDate)} – {date(row.endDate)}</td>
            <td>{text(row.dayCount)}</td>
            <td>{text(row.reasonDetail || row.reason)}{row.status === 'RETURNED_FOR_CORRECTION' && row.returnReason ? <small className="cell-note">ส่งกลับ: {text(row.returnReason)}{row.returnedByDisplayName ? ` · ${text(row.returnedByDisplayName)}` : ''}</small> : null}</td>
            <td>{row.attachmentUrl ? <button className="attachment-link" onClick={() => onAttachment(row)}>เปิดเอกสาร</button> : <span className="muted-text">–</span>}</td>
            {!actions && <td>{status(row)}</td>}
            <td>{row.status === 'APPROVED' ? <button className="btn-info leave-print-button" onClick={() => onPrint(row)}>พิมพ์ A4</button> : <span className="muted-text">–</span>}</td>
            {actions && <td className="row-actions data-row-actions">{String(row.employeeId || '') === String(employeeId || '') ? <span className="muted-text" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 4 }}>ไม่สามารถตรวจสอบใบลาของตนเอง</span> : <><button className="btn-success" disabled={!mutationsEnabled} onClick={() => onApprove(row)}>อนุมัติ</button><button className="btn-warning" disabled={!mutationsEnabled} onClick={() => onReturnForCorrection(row)}>ส่งกลับไปแก้ไข</button><button className="danger-action" disabled={!mutationsEnabled} onClick={() => onReject(row)}>ไม่อนุมัติ</button></>}</td>}
            {showHistoryActions && <td className="row-actions data-row-actions">{renderHistoryActions(row)}</td>}
          </tr>) : <tr><td colSpan={(actions || showHistoryActions) ? 9 : 8} className="no-rows data-table-empty-cell"><div className="empty-state data-state data-state--empty"><strong>{emptyMessage}</strong></div></td></tr>}</tbody>
        </table>
      </div>
      {mobileHistory && <div className="leave-history-mobile-list">{items.length ? items.map((row) => {
        const employeeContext = leaveEmployeeContext(row);
        const substitute = row.substitute || row.substituteName;
        const hasActions = Boolean(row.attachmentUrl || row.status === 'APPROVED' || row.canEditReturned || row.canCancelReturned);
        return <article className="leave-history-mobile-card" key={`leave-mobile-${text(row.id)}`}>
          <header><div><small>พนักงาน</small><h3>{text(row.employeeNameSnapshot)}</h3>{employeeContext && <small>{employeeContext}</small>}</div>{status(row)}</header>
          <dl>
            <div><dt>ประเภทการลา</dt><dd>{text(row.leaveType)}{row.isRetroactive ? <><br /><span className="status-badge status-badge--attention leave-retro-badge">ย้อนหลัง</span></> : null}</dd></div>
            <div><dt>จำนวนวัน</dt><dd>{text(row.dayCount)} วัน</dd></div>
            <div className="leave-history-mobile-wide"><dt>วันที่ลา</dt><dd>{date(row.startDate)} – {date(row.endDate)}</dd></div>
            <div className="leave-history-mobile-wide"><dt>ผู้ปฏิบัติงานแทน</dt><dd>{text(substitute)}</dd></div>
            <div className="leave-history-mobile-wide"><dt>เหตุผล / รายละเอียด</dt><dd>{text(row.reasonDetail || row.reason)}</dd></div>
            {row.status === 'RETURNED_FOR_CORRECTION' && row.returnReason ? <div className="leave-history-mobile-wide"><dt>เหตุผลที่ส่งกลับ</dt><dd>{text(row.returnReason)}{row.returnedByDisplayName ? ` · ${text(row.returnedByDisplayName)}` : ''}</dd></div> : null}
          </dl>
          {hasActions && <footer>{Boolean(row.attachmentUrl) && <button className="attachment-link" onClick={() => onAttachment(row)}>เปิดเอกสาร</button>}{row.status === 'APPROVED' && <button className="btn-info leave-print-button" onClick={() => onPrint(row)}>พิมพ์ A4</button>}{renderHistoryActions(row)}</footer>}
        </article>;
      }) : <div className="empty-state data-state data-state--empty"><strong>{emptyMessage}</strong></div>}</div>}
    </>;
  };
  const quotaCards: Array<[string, string, unknown, string]> = [['🩺', 'ลาป่วยคงเหลือ', remaining.sickLeave, 'green'], ['🏢', 'ลากิจคงเหลือ', remaining.personalLeave, 'blue'], ['🌴', 'ลาพักร้อนคงเหลือ', remaining.vacationLeave, 'amber']];
  const selectedPending = pendingRows.find((row) => String(row.id) === selectedPendingId) || pendingRows[0];
  const selectedPendingIsSelf = Boolean(selectedPending && String(selectedPending.employeeId || '') === String(employeeId || ''));
  if (mode === 'pending') {
    return <section className="view-pane leave-page leave-mode-pending leave-decision-page data-surface-page" aria-label="Leave Approval Workspace">
      <div className="leave-hero signature-page-header"><div><div><p className="eyebrow">การลา</p><h1>อนุมัติคำขอลา</h1><p>ตรวจสอบคำขอและตัดสินใจจากพื้นที่ทำงานเดียว โดยยังใช้สิทธิ์และกฎอนุมัติเดิมของระบบ</p></div></div><button type="button" onClick={onRefresh}>↻ รีเฟรช</button></div>
      <ErrorAlert message={error} className="leave-error" />
      <div className="leave-decision-workspace">
        <aside className="leave-decision-queue" aria-label="รายการรออนุมัติ">
          <header><div><span>คิวงาน</span><h2>รออนุมัติ</h2></div><b>{pendingRows.length}</b></header>
          {loading ? <div className="signature-table-skeleton compact-skeleton" role="status" aria-label="กำลังโหลดคำขอลา">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div> : pendingRows.length ? <div className="leave-decision-list">{pendingRows.map((row) => {
            const active = selectedPending && String(selectedPending.id) === String(row.id);
            return <button type="button" key={text(row.id)} className={`leave-decision-item ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={() => setSelectedPendingId(String(row.id))}><span><strong>{text(row.employeeNameSnapshot)}</strong><small>{text(row.departmentSnapshot)}</small></span><span><b>{text(row.leaveType)}</b><small>{date(row.startDate)} – {date(row.endDate)}</small></span></button>;
          })}</div> : <div className="data-state data-state--empty"><span aria-hidden="true">✓</span><h2>ไม่มีคำขอที่รออนุมัติ</h2><p>ขณะนี้ไม่มีรายการที่ต้องตัดสินใจในขอบเขตสิทธิ์ของคุณ</p></div>}
        </aside>
        <main className="leave-decision-detail">
          {selectedPending ? <>
            <header><div><p className="eyebrow">คำขอที่เลือก</p><h2>{text(selectedPending.employeeNameSnapshot)}</h2><span>{text(selectedPending.departmentSnapshot)} · {text(selectedPending.leaveType)}</span></div><span className={`status-badge status-badge--${semanticStatusTone(selectedPending.status)}`}>{text(selectedPending.status)}</span></header>
            <div className="leave-decision-summary"><div><span>วันที่ลา</span><strong>{date(selectedPending.startDate)} – {date(selectedPending.endDate)}</strong></div><div><span>จำนวนวัน</span><strong>{text(selectedPending.dayCount)} วัน</strong></div><div><span>ประเภท</span><strong>{text(selectedPending.leaveType)}</strong></div><div><span>คำขอย้อนหลัง</span><strong>{selectedPending.isRetroactive ? 'ใช่' : 'ไม่ใช่'}</strong></div></div>
            <section className="leave-decision-copy"><div><span>เหตุผล / รายละเอียด</span><p>{text(selectedPending.reason)}</p></div><div><span>ผู้ปฏิบัติงานแทน</span><p>{text(selectedPending.substitute || selectedPending.substituteName || '-')}</p></div></section>
            {selectedPending.attachmentUrl && <button type="button" className="btn-neutral leave-decision-attachment" onClick={() => onAttachment(selectedPending)}>📎 เปิดเอกสารแนบ</button>}
          </> : <div className="data-state data-state--empty"><h2>เลือกรายการเพื่อดูรายละเอียด</h2><p>รายละเอียดคำขอและการตัดสินใจจะแสดงในพื้นที่นี้</p></div>}
        </main>
        <aside className="leave-decision-actions" aria-label="การตัดสินใจ">
          <div><p className="eyebrow">การตัดสินใจ</p><h2>ดำเนินการ</h2><p>ตรวจสอบข้อมูลคำขอให้ครบก่อนเลือกผลการพิจารณา</p></div>
          {selectedPendingIsSelf ? <div className="leave-self-approval-block"><strong>ไม่สามารถอนุมัติใบลาของตนเอง</strong><p>ระบบยังคงบังคับกฎ self-approval เดิม รายการนี้ต้องให้ผู้มีอำนาจคนอื่นพิจารณา</p></div> : selectedPending ? <div className="leave-decision-buttons"><button type="button" className="btn-success" disabled={!mutationsEnabled} onClick={() => onApprove(selectedPending)}><SmsIcon name="check" size={18} />อนุมัติคำขอ</button><button type="button" className="btn-warning" disabled={!mutationsEnabled} onClick={() => onReturnForCorrection(selectedPending)}>ส่งกลับไปแก้ไข</button><button type="button" className="btn-danger-outline" disabled={!mutationsEnabled} onClick={() => onReject(selectedPending)}>ไม่อนุมัติ</button></div> : <p className="muted-text">ยังไม่มีรายการที่เลือก</p>}
          <small>การไม่อนุมัติยังใช้ขั้นตอนและ validation เดิมของระบบ ไม่มีการเปลี่ยน authority หรือ backend behavior</small>
        </aside>
      </div>
    </section>;
  }
  return <section className={`view-pane leave-page leave-mode-${mode} data-surface-page`}>
    <div className="leave-hero"><div><span>🗓️</span><div><h1>ระบบจัดการการลา (Leave Management)</h1><p>ยื่นคำขอลา ตรวจสอบโควตา และอนุมัติรายการเข้าสู่ตารางกะ</p></div></div><button onClick={onRefresh}>↻ รีเฟรชข้อมูล</button></div>
    {canManage && (
      <div className="leave-quota-grid" style={{ marginBottom: '20px' }}>
        <article className="leave-quota-card amber">
          <div>
            <p>⏳ คำขอรออนุมัติ</p>
            <strong>{mode === 'history' ? historyStatusCounts?.PENDING ?? 0 : pendingRows.length}</strong>
            <small>รายการรอผู้บริหารอนุมัติ</small>
          </div>
          <span style={{ background: '#fef3c7', color: '#d97706' }}>⏳</span>
        </article>
        <article className="leave-quota-card green">
          <div>
            <p>✓ อนุมัติแล้ว</p>
            <strong>{mode === 'history' ? historyStatusCounts?.APPROVED ?? 0 : rows.filter((r) => r.status === 'APPROVED').length}</strong>
            <small>รายการลงตารางกะเรียบร้อย</small>
          </div>
          <span style={{ background: '#d1fae5', color: '#059669' }}>✓</span>
        </article>
        <article className="leave-quota-card red" style={{ borderLeftColor: '#ef4444' }}>
          <div>
            <p>✕ ไม่อนุมัติ</p>
            <strong>{mode === 'history' ? historyStatusCounts?.REJECTED ?? 0 : rows.filter((r) => r.status === 'REJECTED').length}</strong>
            <small>รายการที่ไม่ผ่านการอนุมัติ</small>
          </div>
          <span style={{ background: '#fee2e2', color: '#dc2626' }}>✕</span>
        </article>
      </div>
    )}
    {linked ? <div className="leave-quota-grid">{quotaCards.map(([icon, label, value, tone]) => <article className={`leave-quota-card ${tone}`} key={label}><div><p>{icon} {label}</p><strong>{text(value)}</strong><small>ตามสิทธิ์ที่กำหนด (วัน)</small></div><span>{icon}</span></article>)}</div> : !canManage && <div className="alert alert-error">บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อ Admin ก่อนส่งคำขอลา</div>}
    <div className="leave-main-grid"><section className="leave-submit-card"><header><span>✍️</span><div><h2>ยื่นคำขอลาพัก (Submit Leave Request)</h2><p>กรอกข้อมูลให้ครบก่อนส่งเข้าคิวอนุมัติ</p></div></header><form onSubmit={submit}>{canManage && <label className="field-group"><span>👤 พนักงาน <b>*</b></span><select required value={form.employeeId} onChange={(event) => update('employeeId', event.target.value)}><option value="">-- เลือกพนักงาน --</option>{employeeOptions.map((employee) => <option key={employee.value} value={employee.value}>{employee.label}</option>)}</select></label>}<label className="field-group"><span>📌 ประเภทการลา <b>*</b></span><select required value={form.leaveType} onChange={(event) => update('leaveType', event.target.value)}><option value="">-- กรุณาเลือกประเภทการลา --</option><option value="ลาป่วย">🩺 ลาป่วย (Sick Leave)</option><option value="ลากิจ">🏢 ลากิจ (Personal Leave)</option><option value="ลาพักร้อน">🌴 ลาพักร้อน (Vacation Leave)</option></select></label><div className="leave-date-grid"><label className="field-group"><span>📅 วันที่เริ่มต้น <b>*</b></span><input required type="date" min={!canManage ? todayString : undefined} value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></label><label className="field-group"><span>🏁 วันที่สิ้นสุด <b>*</b></span><input required type="date" min={form.startDate || (!canManage ? todayString : undefined)} value={form.endDate} onChange={(event) => update('endDate', event.target.value)} /></label></div>{days > 0 && <div className="leave-days-note">ระยะเวลาการลา: <strong>{days}</strong> วัน</div>}<label className="field-group"><span>👥 ผู้ปฏิบัติงานแทน <b>*</b></span><input required value={form.substitute} placeholder="ระบุชื่อ-นามสกุล ผู้เข้าเวร/ปฏิบัติงานแทน" onChange={(event) => update('substitute', event.target.value)} /></label><label className="field-group"><span>📝 เหตุผลการลา {isRetroactive && <b>*</b>}</span><textarea required={isRetroactive} rows={3} value={form.reason} placeholder={isRetroactive ? "ต้องระบุเหตุผลเมื่อเลือกวันลาย้อนหลัง" : "ระบุเหตุผลหรือความจำเป็นในการลา... (ไม่บังคับ)"} onChange={(event) => update('reason', event.target.value)} /></label><label className="leave-file-field"><span>📎 แนบไฟล์เอกสาร (ใบรับรองแพทย์/รูปภาพ/PDF)</span><small>จำเป็นเมื่อลาป่วยเกิน 3 วัน · PDF, JPG หรือ PNG ไม่เกิน 4 MB</small><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0])} />{file && <em>เลือกไฟล์แล้ว: {file.name}</em>}</label>{notice && <div className="settings-notice success">{notice}</div>}{submitError && <ErrorAlert message={submitError} className="leave-submit-error" />}<button className="leave-submit-button" disabled={!mutationsEnabled || !canSubmit || !formReady || submitting} type="submit">🚀 {submitting ? 'กำลังส่งคำขอลา…' : 'ยืนยันและส่งคำขอลา'}</button></form></section>
      <section className="leave-history-card data-surface-card"><header><span>📋</span><div><h2>{mode === 'history' ? 'ประวัติการลาพนักงานทั้งหมด (All Employee Leaves & Print A4)' : 'ประวัติคำขอลาของฉัน (My Leave History)'}</h2><p>{mode === 'history' ? 'สำหรับหัวหน้างานและ Admin ตรวจสอบรายการลาทั้งหมด และพิมพ์ใบลาอนุมัติ' : 'วันที่ลา ประเภทการลา และสถานะคำขอลา'}</p></div>{mode === 'history' && <button className="btn-neutral small-action" onClick={onRefresh}>↻ รีเฟรชข้อมูล</button>}</header>{mode === 'history' && historyMonth && onHistoryMonthChange && onHistoryMonthStep && <div className="leave-history-filter data-toolbar-panel"><div><strong>แสดงข้อมูล: {formatThaiMonth(historyMonth)}</strong><small>รายการลาที่มีช่วงวันทับซ้อนกับเดือนที่เลือก</small></div><div className="leave-history-month-controls"><MonthGridPicker value={historyMonth} onChange={onHistoryMonthChange} /><button className="btn-neutral small-action" onClick={() => onHistoryMonthStep(-1)}>‹ เดือนก่อน</button><button className="btn-neutral small-action" onClick={() => onHistoryMonthStep(1)}>เดือนถัดไป ›</button></div></div>}{mode !== 'history' && <><div className="my-leave-quota-heading">โควต้าคงเหลือ{quotaYear ? ` · ${thaiQuotaYearLabel(quotaYear)}` : ''}</div><div className="my-leave-quota-grid">{quotaCards.map(([icon, label, value, tone]) => <article className={`leave-quota-card ${tone}`} key={`my-${label}`}><div><p>{icon} {label}</p><strong>{text(value)}</strong><small>ตามสิทธิ์ที่กำหนด (วัน)</small></div><span>{icon}</span></article>)}</div></>}{loading ? <div className="loading-row data-state-inline data-state--loading" role="status">กำลังดึงประวัติการลา…</div> : leaveTable(historyRows, false, mode === 'history' && historyMonth ? `ไม่พบประวัติการลาในเดือน${formatThaiMonth(historyMonth)}` : 'ไม่มีรายการ', true)}{mode === 'history' && historyTotalPages && historyTotalPages > 1 && onHistoryPageChange && <div className="pagination-bar data-pagination"><button aria-label="หน้าก่อนหน้า" disabled={(historyPage || 1) <= 1 || loading} onClick={() => onHistoryPageChange((historyPage || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {historyPage || 1} จาก {historyTotalPages}</span><button aria-label="หน้าถัดไป" disabled={(historyPage || 1) >= historyTotalPages || loading} onClick={() => onHistoryPageChange((historyPage || 1) + 1)}>หน้าถัดไป ›</button></div>}{mode === 'history' && <div className="leave-history-total">ทั้งหมด {historyTotal ?? historyRows.length} รายการในเดือนที่เลือก</div>}</section>
    </div>
    <ErrorAlert message={error} className="leave-error" />
    {canManage && <section className="leave-pending-card data-surface-card"><header><span>⚡</span><div><h2>รายการใบลาที่รออนุมัติ</h2><p>สำหรับหัวหน้างาน (Manager) และผู้ดูแลระบบ (Admin) ในการตรวจสอบสิทธิ์และอนุมัติวันลา</p></div><b>🛡️ สิทธิ์ผู้บริหาร/หัวหน้างาน</b></header>{loading ? <div className="loading-row data-state-inline data-state--loading">กำลังตรวจสอบรายการที่รออนุมัติ…</div> : leaveTable(pendingRows, true)}</section>}
  </section>;
}

function LeavePrintDocument({ row }: { row: DataRow }) {
  const leaveDates = inputDate(row.startDate) === inputDate(row.endDate) ? date(row.startDate) : `${date(row.startDate)} – ${date(row.endDate)}`;
  return <section className="leave-print-document" aria-hidden="true">
    <style media="print">{'@page { size: A4 portrait; margin: 10mm 15mm; }'}</style>
    <div className="leave-print-topline"><span>{formatApprovalDateTime(new Date())}</span><span>Security Management System — แบบบันทึกการลาพนักงานรักษาความปลอดภัย</span></div>
    <div className="leave-print-heading"><h1>ใบขออนุมัติลางาน</h1><p>พนักงานรักษาความปลอดภัย</p></div>
    <div className="leave-print-person"><strong>ชื่อพนักงาน: {text(row.employeeNameSnapshot)}</strong><strong>วันที่พิมพ์: {date(new Date())}</strong></div>
    <table className="leave-print-table"><thead><tr><th>วันที่ลางาน</th><th>ประเภทการลา</th><th>จำนวนวัน</th><th>ผู้ปฏิบัติงานแทน / รายละเอียด</th></tr></thead><tbody><tr><td>{leaveDates}</td><td>{text(row.leaveType)}</td><td>{text(row.dayCount)} วัน</td><td>{text(row.reason)}</td></tr></tbody></table>
    <div className="leave-print-signatures">
      <div className="leave-print-signature-block">
        <div className="leave-print-signature-line">
          <span className="leave-print-sig-label">ลงชื่อ</span>
          <span className="leave-print-dots">........................................................</span>
        </div>
        <div className="leave-print-name">(........................................................)</div>
        <strong className="leave-print-title">หัวหน้าพนักงานรักษาความปลอดภัย</strong>
      </div>
      <div className="leave-print-signature-block">
        <div className="leave-print-signature-line">
          <span className="leave-print-notice">ทราบ /</span>
          <span className="leave-print-sig-label">ลงชื่อ</span>
          <span className="leave-print-dots">........................................................</span>
        </div>
        <div className="leave-print-name">(........................................................)</div>
        <strong className="leave-print-title">ผู้จัดการเขต (ผู้อนุมัติ)</strong>
      </div>
    </div>
    <footer className="leave-print-footer"><span>Security Management System</span><span>1/1</span></footer>
  </section>;
}

function Dashboard() {
  const auth = useContext(AuthContext)!;
  const pwaShell = useMemo(() => isSmsPwaShellMode(), []);
  const [activePage, setActivePage] = useState<Page>(() => pwaShell ? initialSmsPwaPage() : 'dashboard');
  const [pwaOnline, setPwaOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [empLoading, setEmpLoading] = useState(false);
  const [fetchError, setFetchError] = useState<RequestErrorInput>();
  const [search, setSearch] = useState('');
  const [operationResponse, setOperationResponse] = useState<DataResponse>({});
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<RequestErrorInput>();
  const [leavePrintTarget, setLeavePrintTarget] = useState<DataRow>();
  const [operationPage, setOperationPage] = useState(1);
  const [licenseEmployeeStatus, setLicenseEmployeeStatus] = useState<LicenseEmployeeStatus>('ACTIVE');
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(defaultAuditFilters);
  const [dataQualityPageSize, setDataQualityPageSize] = useState(25);
  const [dataQualityFilters, setDataQualityFilters] = useState<DataQualityFilters>({ severity: '', module: '', rule: '', department: '', search: '' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pwaShell) return;
    const update = () => setPwaOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [pwaShell]);

  useEffect(() => {
    if (pwaShell && !isSmsPwaPage(activePage)) setActivePage('attendance');
  }, [activePage, pwaShell]);

  const selectPwaPage = (page: SmsPwaPage) => {
    setActivePage(page);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('pwa', '1');
      url.searchParams.set('page', page);
      window.history.replaceState(window.history.state, '', url);
    }
  };
  const [mobileUtilityOpen, setMobileUtilityOpen] = useState(false);
  const [passkeyPanelOpen, setPasskeyPanelOpen] = useState(false);
  const mobileUtilityTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const releaseScrollLock = acquireDocumentScrollLock();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenuOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      mobileMenuTriggerRef.current?.focus();
    };
  }, [mobileMenuOpen]);
  useEffect(() => {
    if (!mobileUtilityOpen) return;
    const releaseScrollLock = acquireDocumentScrollLock();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileUtilityOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      mobileUtilityTriggerRef.current?.focus();
    };
  }, [mobileUtilityOpen]);
  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileUtilityOpen(false);
    if (activePage !== 'employees') {
      setEmployeeGovernedEditTarget(undefined);
      setEmployeeChangeReviewOpen(false);
    }
  }, [activePage]);
  const [operationRefresh, setOperationRefresh] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [employeeRefresh, setEmployeeRefresh] = useState(0);
  const [shiftTypes, setShiftTypes] = useState<DataRow[]>([]);
  const [editor, setEditor] = useState<Editor>();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<RequestErrorInput>();
  const [employeeGovernedEditTarget, setEmployeeGovernedEditTarget] = useState<Employee>();
  const [employeeChangeReviewOpen, setEmployeeChangeReviewOpen] = useState(false);
  const [licenseEditTarget, setLicenseEditTarget] = useState<DataRow>();
  const [dashboardSummary, setDashboardSummary] = useState<DataRow>({});
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<RequestErrorInput>();
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>(() => { const date = bangkokDateInput(); return { date, month: date.slice(0, 7), department: '' }; });
  const [scheduleMonth, setScheduleMonth] = useState(currentBangkokMonth);
  const [leaveMonth, setLeaveMonth] = useState(readLeaveMonthFromUrl);
  const [quotaYear, setQuotaYear] = useState(currentBangkokQuotaYear);
  const [showLegacyQuotas, setShowLegacyQuotas] = useState(false);
  const [legacyQuotaRows, setLegacyQuotaRows] = useState<DataRow[]>([]);
  const [scheduleDepartment, setScheduleDepartment] = useState('');
  const [leaveSummary, setLeaveSummary] = useState<DataRow>({});
  const [ruleCheckResponse, setRuleCheckResponse] = useState<DataRow>({});
  const [autoSchedulePreview, setAutoSchedulePreview] = useState<DataRow>();
  const [autoScheduleBusy, setAutoScheduleBusy] = useState(false);
  const [employeeAutoScheduleBusyId, setEmployeeAutoScheduleBusyId] = useState<string>();
  const [employeeAutoScheduleTarget, setEmployeeAutoScheduleTarget] = useState<DataRow>();
  const [employeeAutoContinue, setEmployeeAutoContinue] = useState(true);
  const [employeeAutoStartPhase, setEmployeeAutoStartPhase] = useState('D1');
  const [scheduleExportBusy, setScheduleExportBusy] = useState(false);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, { action: 'create' | 'update' | 'delete'; id?: string; employeeId: string; workDate: string; shiftTypeId?: string; shiftCode?: string; shiftName?: string; startTime?: string; endTime?: string; color?: string; remark?: string; licenseStatus?: string; licenseOverride?: boolean; overrideReason?: string; payload?: unknown }>>({});
  const [batchSaveBusy, setBatchSaveBusy] = useState(false);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [deptMenuOpen, setDeptMenuOpen] = useState(false);

  const changeLeaveMonth = (value: string) => {
    const normalized = normalizeMonthValue(value);
    setLeaveMonth(normalized);
    setOperationPage(1);
    writeLeaveMonthToUrl(normalized);
  };

  useEffect(() => {
    const handlePopState = () => setLeaveMonth(readLeaveMonthFromUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!leavePrintTarget) return;
    document.body.classList.add('printing-leave');
    const timer = window.setTimeout(() => window.print(), 80);
    const finishPrint = () => setLeavePrintTarget(undefined);
    window.addEventListener('afterprint', finishPrint, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finishPrint);
      document.body.classList.remove('printing-leave');
    };
  }, [leavePrintTarget]);

  const saveAllDrafts = async () => {
    if (!auth.token || !Object.keys(scheduleDrafts).length) return;
    setBatchSaveBusy(true); setOperationError(undefined);
    try {
      const defaultType = shiftTypes.find((t) => String(t.code).toUpperCase() === 'D') || shiftTypes[0];
      const validDefaultTypeId = String(defaultType?.id || '');

      const changes = Object.values(scheduleDrafts)
        .filter((d) => Boolean(d.employeeId && d.workDate))
        .map((d) => {
          const shiftTypeId = (d.shiftTypeId && d.shiftTypeId.length >= 10) ? d.shiftTypeId : validDefaultTypeId;
          return {
            action: d.action,
            id: d.id,
            payload: d.action === 'delete' ? undefined : {
              employeeId: String(d.employeeId),
              shiftTypeId,
              workDate: String(d.workDate),
              remark: String(d.remark || 'จัดตารางกะ'),
              locked: true,
              licenseOverride: Boolean(d.licenseOverride),
              overrideReason: String(d.overrideReason || '')
            }
          };
        });

      if (!changes.length) {
        setScheduleDrafts({});
        setBatchSaveBusy(false);
        return;
      }

      await api.batchSaveShifts(auth.token, changes);
      setScheduleDrafts({});
      const updated = await api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment);
      setOperationResponse(updated);
    } catch (reason) {
      setOperationError(toRequestErrorState(reason, 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ'));
    } finally {
      setBatchSaveBusy(false);
    }
  };

  useEffect(() => {
    if (!auth.token || !['employees', 'licenses', 'schedule', 'leave', 'leavePending', 'leaveHistory', 'quota'].includes(activePage)) return;
    setEmpLoading(true);
    setFetchError(undefined);
    api.employees(auth.token)
      .then((result) => {
        const records = result?.data || [];
        setEmployees(records);
        setTotalCount(result?.meta?.total ?? records.length);
      })
      .catch((reason) => {
        setFetchError(toRequestErrorState(reason, 'ไม่สามารถอ่านข้อมูลพนักงานได้'));
        setEmployees([]);
        setTotalCount(0);
      })
      .finally(() => setEmpLoading(false));
  }, [activePage, auth.token, employeeRefresh]);

  useEffect(() => {
    if (!auth.token || !['schedule', 'shiftSetup'].includes(activePage)) return;
    api.shiftTypes(auth.token).then((result) => setShiftTypes(result?.data || [])).catch(() => setShiftTypes([]));
  }, [activePage, auth.token, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'dashboard') return;
    setDashboardLoading(true);
    setDashboardError(undefined);
    api.dashboard(auth.token, dashboardFilters)
      .then((result) => setDashboardSummary(result?.data || {}))
      .catch((reason) => setDashboardError(toRequestErrorState(reason, 'ไม่สามารถอ่าน Dashboard ได้')))
      .finally(() => setDashboardLoading(false));
  }, [activePage, auth.token, operationRefresh, dashboardFilters.date, dashboardFilters.month, dashboardFilters.department]);

  useEffect(() => {
    if (!auth.token || !['leave', 'leavePending', 'leaveHistory'].includes(activePage)) return;
    api.leaveSummary(auth.token).then((result) => setLeaveSummary(result?.data || {})).catch(() => setLeaveSummary({ linked: false }));
  }, [activePage, auth.token, operationRefresh]);

  useEffect(() => {
    if (!auth.token || !['ADMIN', 'MANAGER'].includes(auth.user?.role || '')) { setPendingLeaveCount(0); return; }
    api.leaveRequests(auth.token, 1).then((result) => setPendingLeaveCount((Array.isArray(result.data) ? result.data : []).filter((row: DataRow) => row.status === 'PENDING').length)).catch(() => setPendingLeaveCount(0));
  }, [auth.token, auth.user?.role, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'rules') return;
    api.ruleChecks(auth.token, scheduleMonth).then((result) => setRuleCheckResponse(result?.data || {})).catch((reason) => setOperationError(toRequestErrorState(reason, 'ไม่สามารถตรวจสอบกฎได้')));
  }, [activePage, auth.token, operationRefresh, scheduleMonth]);

  useEffect(() => {
    if (!auth.token || activePage !== 'audit') return;
    setOperationLoading(true); setOperationError(undefined);
    api.auditEvents(auth.token, operationPage, auditPageSize, auditFilters)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(toRequestErrorState(reason, 'ไม่สามารถอ่านบันทึกการตรวจสอบได้')))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, auditPageSize, auditFilters, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'dataQuality') return;
    setOperationLoading(true); setOperationError(undefined);
    api.dataQualityIssues(auth.token, operationPage, dataQualityPageSize, dataQualityFilters)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(toRequestErrorState(reason, 'ไม่สามารถอ่านข้อมูลคุณภาพข้อมูลได้')))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, dataQualityPageSize, dataQualityFilters, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage === 'dashboard' || activePage === 'employees' || activePage === 'attendance' || activePage === 'attendanceDevice' || activePage === 'profile' || activePage === 'shiftSetup' || activePage === 'schedule' || activePage === 'audit' || activePage === 'dataQuality' || activePage === 'reportCenter' || activePage === 'reports' || activePage === 'executiveReport') return;
    if (activePage === 'users' && !canLoadAccessManagement(auth.user?.role || 'VIEWER')) {
      setOperationLoading(false);
      setOperationError(undefined);
      setOperationResponse({ data: [] });
      return;
    }
    const loaders: Record<Exclude<Page, 'dashboard' | 'employees' | 'attendance' | 'attendanceDevice' | 'profile' | 'shiftSetup' | 'schedule' | 'dataQuality' | 'reportCenter' | 'reports' | 'executiveReport'>, (token: string, page: number) => Promise<DataResponse>> = {
      licenses: api.licenses, approvals: api.scheduleApprovals,
      rules: api.schedulingRules, leave: api.leaveRequests, leavePending: api.leaveRequests, leaveHistory: api.leaveRequests, quota: api.leaveQuotas,
      users: api.users, audit: api.auditEvents, settings: api.systemSettings
    };
    let active = true;
    setOperationLoading(true);
    setOperationError(undefined);
    if (activePage !== 'leaveHistory') setOperationResponse({});
    const request = activePage === 'licenses'
      ? api.licenses(auth.token, operationPage, licenseEmployeeStatus)
      : activePage === 'leaveHistory'
      ? api.leaveRequests(auth.token, operationPage, parseMonthValue(leaveMonth))
      : activePage === 'quota'
        ? api.leaveQuotas(auth.token, operationPage, showLegacyQuotas ? { legacy: true } : { year: quotaYear })
        : loaders[activePage](auth.token, operationPage);
    request
      .then((response) => { if (active) setOperationResponse(response); })
      .catch((reason) => { if (active) setOperationError(toRequestErrorState(reason, 'ไม่สามารถอ่านข้อมูลได้')); })
      .finally(() => { if (active) setOperationLoading(false); });
    return () => { active = false; };
  }, [activePage, auth.token, auth.user?.role, leaveMonth, licenseEmployeeStatus, operationPage, operationRefresh, quotaYear, showLegacyQuotas]);

  useEffect(() => {
    if (!auth.token || activePage !== 'quota' || auth.user?.role !== 'ADMIN') return;
    let active = true;
    api.leaveQuotas(auth.token, 1, { legacy: true })
      .then((response) => { if (active) setLegacyQuotaRows(Array.isArray(response.data) ? response.data : []); })
      .catch(() => { if (active) setLegacyQuotaRows([]); });
    return () => { active = false; };
  }, [activePage, auth.token, auth.user?.role, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'schedule') return;
    setOperationLoading(true); setOperationError(undefined);
    api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(toRequestErrorState(reason, 'ไม่สามารถอ่านตารางกะรายเดือนได้')))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, operationRefresh, scheduleDepartment, scheduleMonth]);

  useEffect(() => { setOperationPage(1); }, [activePage, leaveMonth, quotaYear, showLegacyQuotas]);
  useEffect(() => { setOperationPage(1); }, [scheduleDepartment, scheduleMonth]);
  useEffect(() => { setAutoSchedulePreview(undefined); }, [scheduleMonth]);

  const parentPage: Partial<Record<Page, Page>> = { executiveReport: 'reportCenter', reports: 'reportCenter' };
  const navigationPage = parentPage[activePage] || activePage;
  const pageTitle = activePage === 'profile' ? 'โปรไฟล์' : navigation.flatMap((section) => section.items).find((item) => item.id === navigationPage)?.label || tablePages[activePage as keyof typeof tablePages]?.title || 'Dashboard';
  const pageSubtitle: Record<Page, string> = {
    dashboard: 'ภาพรวม KPI และสถานะการปฏิบัติงาน',
    employees: 'ข้อมูลพนักงานและใบอนุญาตปฏิบัติงาน',
    licenses: 'ทะเบียนใบอนุญาตของพนักงาน',
    attendance: 'ลงเวลาเข้า/ออกด้วย QR, GPS และ Server authority',
    attendanceDevice: 'ลงทะเบียนและตรวจสอบอุปกรณ์หลักสำหรับ Attendance/Patrol',
    profile: 'ข้อมูลบัญชีและความปลอดภัย',
    shiftSetup: 'กำหนดประเภทกะและเวลาปฏิบัติงาน',
    schedule: 'จัดตารางกะรายเดือนและส่งอนุมัติ',
    approvals: 'ตรวจสอบและอนุมัติตารางกะ',
    leave: 'ยื่นคำขอลา',
    leavePending: 'รายการใบลาที่รออนุมัติ',
    leaveHistory: 'ประวัติการลาพนักงานทั้งหมด',
    quota: 'สิทธิ์และโควต้าวันลา',
    rules: 'ตรวจสอบกฎการทำงานและความพร้อมของกำลังพล',
    dataQuality: 'ตรวจสอบความผิดปกติของข้อมูลแบบอ่านอย่างเดียว',
    reportCenter: 'ศูนย์รายงานและวิเคราะห์สำหรับผู้บริหารและงานปฏิบัติการ',
    reports: 'รายงานสรุปข้อมูลการปฏิบัติงาน',
    executiveReport: 'สรุปข้อมูลสำคัญสำหรับการติดตามและบริหารงาน',
    users: 'กำหนด Role และแผนกก่อนอนุมัติบัญชี',
    settings: 'การตั้งค่าระบบและข้อมูลความปลอดภัย',
    audit: 'ประวัติการใช้งานและการเปลี่ยนแปลงข้อมูล',
  };
  const initials = auth.user?.displayName?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM';
  const canManage = !auth.isViewingAs && ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
  const canViewPage = (page: Page) => {
    if (page === 'leavePending') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    if (page === 'audit') return auth.user?.role === 'ADMIN';
    if (page === 'dataQuality') return auth.user?.role === 'ADMIN';
    if (page === 'settings') return auth.user?.role === 'ADMIN';
    if (page === 'users') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    if (page === 'quota') return auth.user?.role === 'ADMIN';
    if (['licenses', 'reportCenter', 'reports', 'executiveReport'].includes(page)) return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    return true;
  };
  const visibleNavigation = navigation
    .map((section) => ({ ...section, items: section.items.filter((item) => canViewPage(item.id)) }))
    .filter((section) => section.items.length > 0);
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: `${employee.employeeCode} · ${employee.firstName} ${employee.lastName}` }));
  const quotaRows = Array.isArray(operationResponse.data) ? operationResponse.data : [];
  const quotaEmployeeOptions = quotaProvisioningEmployeeOptions(employees, [...quotaRows, ...legacyQuotaRows], quotaYear);
  const showQuotaLegacyWarning = Number(operationResponse.meta?.unmatchedLegacyCount || 0) > 0 || hasUnmatchedLegacyQuota([...quotaRows, ...legacyQuotaRows]);
  const quotaYearOptions: Array<{ value: string; label: string }> = Array.from({ length: 7 }, (_, index) => currentBangkokQuotaYear() - 2 + index).map((year) => ({ value: String(year), label: thaiQuotaYearLabel(year) }));
  const shiftTypeOptions = shiftTypes.map((shiftType) => ({ value: String(shiftType.id), label: `${text(shiftType.code)} · ${text(shiftType.name)}` }));

  const runEditor = (definition: Omit<Editor, 'submit'>, action: (values: Record<string, string>, files: Record<string, File>) => Promise<unknown>, refresh: 'employees' | 'operations' = 'operations') => {
    setEditorError(undefined);
    setEditor({
      ...definition,
      submit: async (values, files) => {
        setEditorBusy(true); setEditorError(undefined);
        try {
          await action(values, files);
          setEditor(undefined);
          if (refresh === 'employees') setEmployeeRefresh((value) => value + 1);
          else setOperationRefresh((value) => value + 1);
        } catch (reason) {
          setEditorError(toRequestErrorState(reason, 'บันทึกข้อมูลไม่สำเร็จ'));
        } finally { setEditorBusy(false); }
      }
    });
  };

  const licenseDocumentServices = {
    list: async (licenseId: string) => (await api.licenseDocuments(auth.token!, licenseId))?.data as LicenseDocument[] || [],
    view: async (documentId: string) => (await api.viewLicenseDocument(auth.token!, documentId))?.data,
    approve: async (documentId: string) => { await api.approveLicenseDocument(auth.token!, documentId); },
    returnForCorrection: async (documentId: string, reason: string) => { await api.returnLicenseDocumentForCorrection(auth.token!, documentId, reason); },
    resubmit: async (documentId: string, data: { licenseNumber: string; proposedStartDate: string; proposedExpiryDate: string; note?: string }, file?: File) => { await api.resubmitLicenseDocument(auth.token!, documentId, data, file); },
    reject: async (documentId: string, reason: string) => { await api.rejectLicenseDocument(auth.token!, documentId, reason); },
    cancel: async (documentId: string) => { await api.cancelLicenseDocument(auth.token!, documentId); },
    permanentlyDelete: async (documentId: string) => { await api.permanentlyDeleteLicenseDocument(auth.token!, documentId); }
  };
  const openLicenseEdit = (row: DataRow) => { if (auth.token) setLicenseEditTarget(row); };

  const employeeFields: FormField[] = [
    { name: 'employeeCode', label: 'รหัสภายใน', required: true }, { name: 'firstName', label: 'ชื่อ', required: true },
    { name: 'lastName', label: 'นามสกุล', required: true }, { name: 'email', label: 'อีเมล', type: 'email' },
    { name: 'phone', label: 'โทรศัพท์' }, { name: 'department', label: 'หน่วยงาน' },
    { name: 'jobTitle', label: 'ตำแหน่ง' }, { name: 'hiredAt', label: 'วันที่เริ่มงาน', type: 'date' }
  ];
  const employeeProfileFields: FormField[] = [
    { name: 'employeeCode', label: 'รหัสภายใน', required: true },
    { name: 'email', label: 'อีเมล', type: 'email' },
    { name: 'phone', label: 'โทรศัพท์' },
    { name: 'hiredAt', label: 'วันที่เริ่มงาน', type: 'date' }
  ];

  const openEmployeeEditor = (employee?: Employee) => {
    if (!auth.token) return;
    if (employee) {
      setEmployeeGovernedEditTarget(employee);
      return;
    }
    const fields = employeeFields;
    runEditor(
      { title: 'เพิ่มพนักงาน', submitLabel: 'เพิ่มพนักงาน', fields, values: {}, experience: 'personnel' },
      (form) => api.createEmployee(auth.token!, formPayload(form, ['email', 'phone', 'department', 'jobTitle', 'hiredAt'])),
      'employees'
    );
  };

  const [shiftEditorTarget, setShiftEditorTarget] = useState<{ shift?: DataRow; defaults?: Record<string, string>; clickPos?: { x: number; y: number } } | null>(null);
  const [licensesData, setLicensesData] = useState<DataRow[]>([]);

  useEffect(() => {
    if (auth.token) {
      api.licenses(auth.token).then(res => setLicensesData(Array.isArray(res.data) ? res.data : [])).catch(() => undefined);
    }
  }, [auth.token, operationRefresh]);

  const openShiftEditor = (shift?: DataRow, defaults: Record<string, string> = {}, e?: React.MouseEvent) => {
    if (!auth.token) return;
    const clickPos = e ? { x: e.clientX, y: e.clientY } : undefined;
    if ((activePage as string) === 'schedule') {
      setShiftEditorTarget({ shift, defaults, clickPos });
      return;
    }
    const fields: FormField[] = [
      { name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions },
      { name: 'shiftTypeId', label: 'ประเภทกะ', type: 'select', required: true, options: shiftTypeOptions },
      { name: 'workDate', label: 'วันที่', type: 'date', required: true },
      { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }
    ];
    if (auth.user?.role === 'ADMIN') fields.push(
      { name: 'licenseOverride', label: 'ยืนยัน Override ใบอนุญาต', type: 'select', options: [{ value: 'false', label: 'ไม่ Override' }, { value: 'true', label: 'Override โดย Admin' }] },
      { name: 'overrideReason', label: 'เหตุผล Override', type: 'textarea' }
    );
    const values: Record<string, string> = shift ? {
      employeeId: String(shift.employeeId || ''), shiftTypeId: String(shift.shiftTypeId || nested(shift.shiftType).id || ''),
      workDate: inputDate(shift.workDate), remark: String(shift.remark || ''), licenseOverride: String(Boolean(shift.licenseOverride)), overrideReason: String(shift.overrideReason || '')
    } : { licenseOverride: 'false', ...defaults };
    runEditor({ title: shift ? 'แก้ไขตารางกะ (ใส่ในร่าง)' : 'เพิ่มตารางกะ (ใส่ในร่าง)', submitLabel: shift ? 'ใส่ตารางกะ (ฉบับร่าง)' : 'บันทึกเข้าฉบับร่าง', fields, values }, (form) => {
      if (activePage === 'schedule') {
        const key = `${form.employeeId}_${form.workDate}`;
        const selectedType = shiftTypes.find((t) => String(t.id) === form.shiftTypeId);
        const payload: Record<string, unknown> = formPayload(form, ['remark', 'overrideReason']);
        payload.licenseOverride = form.licenseOverride === 'true';
        setScheduleDrafts((prev) => ({
          ...prev,
          [key]: {
            action: shift ? 'update' : 'create',
            id: shift ? String(shift.id) : undefined,
            employeeId: form.employeeId,
            workDate: form.workDate,
            shiftTypeId: form.shiftTypeId,
            shiftCode: String(selectedType?.code || ''),
            shiftName: String(selectedType?.name || ''),
            startTime: String(selectedType?.startTime || ''),
            endTime: String(selectedType?.endTime || ''),
            color: String(selectedType?.color || '#64748B'),
            remark: form.remark,
            licenseOverride: form.licenseOverride === 'true',
            overrideReason: form.overrideReason,
            payload
          }
        }));
        return Promise.resolve();
      }
      const payload: Record<string, unknown> = formPayload(form, ['remark', 'overrideReason']);
      payload.licenseOverride = form.licenseOverride === 'true';
      return shift ? api.updateShift(auth.token!, String(shift.id), payload) : api.createShift(auth.token!, payload);
    });
  };

  const openCreateOperation = () => {
    if (!auth.token) return;
    if (activePage === 'quota' && auth.user?.role === 'ADMIN') runEditor({
      title: `กำหนดโควตาวันลา ปี ${thaiQuotaYearLabel(quotaYear)}`, submitLabel: 'บันทึกโควตา',
      notice: showQuotaLegacyWarning ? 'มีรายการโควตาเดิมที่ยังไม่จับคู่ หากเป็นข้อมูลของพนักงานรายนี้ให้ตรวจสอบและใช้ “จับคู่พนักงาน” แทนการสร้างรายการใหม่' : undefined,
      fields: [
        { name: 'employeeId', label: 'พนักงาน (รหัส · ชื่อ · หน่วยงาน)', type: 'select', required: true, options: quotaEmployeeOptions },
        { name: 'sickLeave', label: 'ลาป่วย', type: 'number', required: true, min: 0, max: 999 },
        { name: 'personalLeave', label: 'ลากิจ', type: 'number', required: true, min: 0, max: 999 },
        { name: 'vacationLeave', label: 'ลาพักร้อน', type: 'number', required: true, min: 0, max: 999 }
      ],
      values: { ...LEAVE_QUOTA_DEFAULTS, quotaYear: String(quotaYear) }
    }, (form) => api.createLeaveQuota(auth.token!, buildLeaveQuotaProvisioningPayload({ ...form, quotaYear })));
    if (activePage === 'licenses') runEditor({
      title: 'เพิ่มใบอนุญาตพนักงาน', submitLabel: 'บันทึกใบอนุญาต',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต', required: true }, { name: 'issueDate', label: 'วันที่ออก', type: 'date', required: true }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date', required: true }, { name: 'status', label: 'สถานะ', type: 'select', required: true, options: ['Active', 'Suspended', 'Revoked', 'Inactive'].map((value) => ({ value, label: value })) }, { name: 'documentUrl', label: 'ลิงก์เอกสาร' }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
      values: { status: 'Active' }
    }, (form) => api.createLicense(auth.token!, formPayload(form, ['documentUrl', 'remark'])));
    if (activePage === 'schedule') openShiftEditor();
    if (activePage === 'leave') runEditor({
      title: 'สร้างคำขอลา', submitLabel: 'ส่งคำขอลา',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: auth.user?.role !== 'VIEWER', options: employeeOptions }, { name: 'leaveType', label: 'ประเภทการลา', type: 'select', required: true, options: ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน'].map((value) => ({ value, label: value })) }, { name: 'startDate', label: 'วันที่เริ่ม', type: 'date', required: true }, { name: 'endDate', label: 'วันที่สิ้นสุด', type: 'date', required: true }, { name: 'substitute', label: 'ผู้เข้าเวร / ปฏิบัติงานแทน', required: true }, { name: 'reason', label: 'เหตุผล', type: 'textarea' }, { name: 'attachment', label: 'ไฟล์แนบ (ถ้ามี)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', hint: 'PDF, JPG หรือ PNG ขนาดไม่เกิน 4 MB' }],
      values: {}
    }, (form, files) => files.attachment ? api.createLeaveRequestWithAttachment(auth.token!, form, files.attachment) : api.createLeaveRequest(auth.token!, formPayload(form)));
  };

  const shiftTypeEditorFields: FormField[] = [
    { name: 'code', label: 'Shift Code', required: true },
    { name: 'name', label: 'ชื่อกะ', required: true },
    { name: 'startTime', label: 'เวลาเริ่ม' },
    { name: 'endTime', label: 'เวลาเลิก' },
    { name: 'hours', label: 'ชั่วโมง', type: 'number', required: true, min: 0, max: 24 },
    { name: 'color', label: 'สี HEX', required: true }
  ];

  const openShiftTypeCreator = () => runEditor({
    title: 'เพิ่มรหัสกะ', submitLabel: 'บันทึกรหัสกะ',
    fields: shiftTypeEditorFields,
    values: { color: '#2F80FF', hours: '8' }
  }, (form) => api.createShiftType(auth.token!, formPayload(form, ['startTime', 'endTime'])));

  const openShiftTypeEditor = (shiftType: DataRow) => {
    const isCoreShiftType = ['D', 'N', 'OFF', 'AL'].includes(String(shiftType.code || '').toUpperCase());
    return runEditor({
      title: `แก้ไขรหัสกะ ${text(shiftType.code)}`,
      submitLabel: 'บันทึกการแก้ไข',
      notice: isCoreShiftType ? 'รหัสกะหลัก D / N / OFF / AL ถูกใช้เป็นกฎหลักของระบบ จึงแก้ Shift Code ไม่ได้ แต่ยังแก้ชื่อ เวลา ชั่วโมง และสีได้' : undefined,
      fields: isCoreShiftType ? shiftTypeEditorFields.filter((field) => field.name !== 'code') : shiftTypeEditorFields,
      values: {
        code: String(shiftType.code || ''),
        name: String(shiftType.name || ''),
        startTime: String(shiftType.startTime || ''),
        endTime: String(shiftType.endTime || ''),
        hours: String(shiftType.hours ?? ''),
        color: String(shiftType.color || '#2F80FF')
      }
    }, (form) => api.updateShiftType(auth.token!, String(shiftType.id), formPayload(form, ['startTime', 'endTime'])));
  };

  const handleOperationAction = async (row: DataRow, action: string) => {
    if (!auth.token || !row.id) return;
    const id = String(row.id);
    if (action === 'link' && activePage === 'quota') {
      runEditor({ title: row.employeeId ? 'จัดประเภทปีให้ข้อมูลโควตาเดิม' : 'จับคู่ข้อมูลเดิมกับพนักงานและปี', submitLabel: 'ยืนยันการจัดประเภท', fields: [{ name: 'employeeId', label: 'พนักงาน (รหัส · ชื่อ · หน่วยงาน)', type: 'select', required: true, options: row.employeeId ? employeeOptions.filter((option) => option.value === String(row.employeeId)) : employeeOptions }, { name: 'quotaYear', label: 'ปีสิทธิ์', type: 'select', required: true, options: quotaYearOptions }], values: { employeeId: String(row.employeeId || ''), quotaYear: String(quotaYear) } }, (form) => api.linkLeaveQuota(auth.token!, id, form.employeeId, Number(form.quotaYear)));
      return;
    }
    if (action === 'document' && activePage === 'licenses') {
      const employee = nested(row.employee);
      runEditor({
        title: `แนบใบอนุญาต · ${text(employee.employeeCode)} ${text(employee.firstName)} ${text(employee.lastName)}`,
        submitLabel: 'ส่งตรวจสอบ',
      fields: [{ name: 'licenseNumber', label: 'เลขใบอนุญาต', required: true }, { name: 'document', label: 'ไฟล์ใบอนุญาต', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', hint: 'PDF, JPG หรือ PNG ขนาดไม่เกิน 2 MB' }, { name: 'proposedStartDate', label: 'วันที่เริ่มต้น', type: 'date', required: true }, { name: 'proposedExpiryDate', label: 'วันหมดอายุ', type: 'date', required: true }, { name: 'note', label: 'หมายเหตุ', type: 'textarea' }],
        values: { licenseNumber: String(row.licenseNumber || ''), proposedStartDate: inputDate(row.issueDate), proposedExpiryDate: inputDate(row.expiryDate) }
      }, (form, files) => {
        const document = files.document;
        if (!document) return Promise.reject(new Error('กรุณาเลือกไฟล์ใบอนุญาต'));
        if (document.size > 2 * 1024 * 1024) return Promise.reject(new Error('ไฟล์ต้องมีขนาดไม่เกิน 2 MB'));
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(document.type)) return Promise.reject(new Error('รองรับเฉพาะ PDF, JPG และ PNG'));
        if (!form.proposedStartDate || !form.proposedExpiryDate || form.proposedStartDate > form.proposedExpiryDate) return Promise.reject(new Error('วันที่เริ่มต้นต้องไม่เกินวันหมดอายุ'));
        return api.uploadLicenseDocument(auth.token!, id, { licenseNumber: form.licenseNumber, proposedStartDate: form.proposedStartDate, proposedExpiryDate: form.proposedExpiryDate, note: form.note }, document).catch((reason: unknown) => Promise.reject(toRequestErrorState(reason, sanitizeLicenseDocumentError(reason))));
      });
      return;
    }
    if (action === 'edit') {
      if (activePage === 'licenses') runEditor({
        title: 'แก้ไขใบอนุญาต', submitLabel: 'บันทึกการแก้ไข',
        fields: [{ name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต', required: true }, { name: 'issueDate', label: 'วันที่ออก', type: 'date', required: true }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date', required: true }, { name: 'status', label: 'สถานะ', type: 'select', required: true, options: ['Active', 'Suspended', 'Revoked', 'Inactive'].map((value) => ({ value, label: value })) }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
        values: { licenseType: String(row.licenseType || ''), licenseNumber: String(row.licenseNumber || ''), issueDate: inputDate(row.issueDate), expiryDate: inputDate(row.expiryDate), status: String(row.status || ''), remark: String(row.remark || '') }
      }, (form) => api.updateLicense(auth.token!, id, formPayload(form, ['remark'])));
      else if (activePage === 'schedule') openShiftEditor(row);
      else if (activePage === 'rules') runEditor({
        title: 'แก้ไขกฎการทำงาน', submitLabel: 'บันทึกกฎ',
        fields: [{ name: 'value', label: 'ค่า', required: true }, { name: 'unit', label: 'หน่วย' }],
        values: { value: String(row.value || ''), unit: String(row.unit || '') }
      }, (form) => api.updateSchedulingRule(auth.token!, id, formPayload(form, ['unit'])));
      else if (activePage === 'quota') runEditor({
        title: 'แก้ไขโควตาวันลา', submitLabel: 'บันทึกโควตา',
        fields: [{ name: 'sickLeave', label: 'ลาป่วย', type: 'number', required: true }, { name: 'personalLeave', label: 'ลากิจ', type: 'number', required: true }, { name: 'vacationLeave', label: 'ลาพักร้อน', type: 'number', required: true }],
        values: { sickLeave: String(row.sickLeave || '0'), personalLeave: String(row.personalLeave || '0'), vacationLeave: String(row.vacationLeave || '0') }
      }, (form) => api.updateLeaveQuota(auth.token!, id, form));
      else if (activePage === 'users') runEditor({
        title: 'แก้ไขผู้ใช้และสิทธิ์', submitLabel: 'บันทึกสิทธิ์',
        fields: [{ name: 'role', label: 'บทบาท', type: 'select', required: true, options: ['ADMIN', 'MANAGER', 'VIEWER'].map((value) => ({ value, label: value })) }, { name: 'department', label: 'หน่วยงาน' }, { name: 'accountStatus', label: 'สถานะบัญชี', type: 'select', required: true, options: ['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].map((value) => ({ value, label: value })) }],
        values: { role: String(row.role || ''), department: String(row.department || ''), accountStatus: String(row.accountStatus || '') }
      }, (form) => api.updateUser(auth.token!, id, form));
      return;
    }
    if (action === 'reset-password') {
      runEditor({
        title: 'ตั้งรหัสผ่านใหม่', submitLabel: 'ตั้งรหัสผ่านและยกเลิก session เดิม',
        fields: [{ name: 'newPassword', label: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)', type: 'password', required: true }],
        values: {}
      }, (form) => api.resetUserPassword(auth.token!, id, form.newPassword));
      return;
    }
    let workflowReason = '';
    if (['return', 'cancel'].includes(action) && ['leave', 'leavePending', 'leaveHistory'].includes(activePage)) {
      const promptLabel = action === 'return'
        ? 'ระบุเหตุผลที่ส่งกลับไปแก้ไข (จำเป็น)'
        : row.status === 'APPROVED'
          ? 'ระบุเหตุผลการยกเลิกใบลาที่อนุมัติแล้ว (จำเป็น)'
          : 'ระบุเหตุผลการยกเลิกคำขอ (จำเป็น)';
      workflowReason = String(window.prompt(promptLabel) || '').trim();
      if (workflowReason.length < 3) {
        setOperationError({ message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' });
        return;
      }
    }
    const confirmMessage = action === 'return'
      ? 'ยืนยันส่งคำขอนี้กลับไปให้ผู้ขอแก้ไข?'
      : action === 'cancel'
        ? 'ยืนยันยกเลิกคำขอนี้? การดำเนินการจะถูกบันทึกใน Audit'
        : 'ยืนยันการดำเนินการนี้?';
    if (!window.confirm(confirmMessage)) return;
    setOperationLoading(true); setOperationError(undefined);
    try {
      if (action === 'delete' && activePage === 'licenses') await api.deleteLicense(auth.token, id);
      else if (action === 'delete' && activePage === 'schedule') await api.deleteShift(auth.token, id);
      else if (activePage === 'approvals') await api.updateScheduleApproval(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
      else if (['leave', 'leavePending', 'leaveHistory'].includes(activePage) && action === 'return') await api.returnLeaveRequestForCorrection(auth.token, id, workflowReason);
      else if (['leave', 'leavePending', 'leaveHistory'].includes(activePage) && action === 'cancel') await api.cancelLeaveRequest(auth.token, id, workflowReason);
      else if (['leave', 'leavePending', 'leaveHistory'].includes(activePage)) await api.updateLeaveRequest(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
      else if (activePage === 'rules') await api.updateSchedulingRule(auth.token, id, { enabled: !row.enabled });
      else if (activePage === 'schedule') await api.updateShift(auth.token, id, { locked: !row.locked });
      else if (activePage === 'users') await api.updateUser(auth.token, id, { isActive: !row.isActive, accountStatus: row.isActive ? 'SUSPENDED' : 'ACTIVE' });
      setOperationRefresh((value) => value + 1);
    } catch (reason) { setOperationError(toRequestErrorState(reason, 'ดำเนินการไม่สำเร็จ')); }
    finally { setOperationLoading(false); }  };

  const content = () => {
    if (activePage === 'dashboard') return <DashboardPage summary={dashboardSummary} loading={dashboardLoading} error={dashboardError} user={auth.user} canManage={canManage} filters={dashboardFilters} onFiltersChange={(next) => setDashboardFilters((current) => ({ ...current, ...next }))} onNavigate={setActivePage} />;
    // The former inline dashboard is intentionally disabled. DashboardPage above
    // is the only runtime dashboard presentation.
    if (false) {
      const pendingTotal = Number(dashboardSummary.pendingLeaves || 0) + Number(dashboardSummary.pendingUsers || 0) + Number(dashboardSummary.expiringLicenses || 0);
      const todayThaiStr = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

      return (
        <section className="view-pane dashboard-page">
          <div className="dashboard-greeting-banner" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #2563eb 100%)', borderRadius: '16px', padding: '24px 28px', color: '#ffffff', marginBottom: '24px', boxShadow: '0 10px 25px -8px rgba(37, 99, 235, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className="avatar" style={{ width: '48px', height: '48px', fontSize: '18px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>{initials}</div>
              <div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>สวัสดี, {auth.user?.displayName || 'ผู้ดูแลระบบ'} 👋</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)' }}>{todayThaiStr} · บทบาท: <strong style={{ color: '#60a5fa' }}>{auth.user?.role || 'VIEWER'}</strong></p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="live-status" style={{ background: 'rgba(255, 255, 255, 0.15)', borderColor: 'rgba(255, 255, 255, 0.3)', color: '#ffffff' }}><i style={{ background: '#4ade80' }} /> ระบบพร้อมใช้งาน</span>
              <button className="btn-secondary compact action-nowrap" onClick={() => setActivePage('schedule')}>🗓️ ตารางกะรายเดือน</button>
            </div>
          </div>

          <div className="metrics-grid" style={{ marginBottom: '24px' }}>
            <article className="metric-card" style={{ borderLeft: '4px solid #2563eb' }}>
              <span className="metric-icon blue">👥</span>
              <div>
                <p>พนักงานทั้งหมด</p>
                <strong>{text(dashboardSummary.totalEmployees || 0)}</strong>
                <small>ใช้งานจริง <strong style={{ color: '#16a34a' }}>{text(dashboardSummary.activeEmployees || 0)}</strong> คน</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #10b981' }}>
              <span className="metric-icon green">📅</span>
              <div>
                <p>กะเดือนนี้</p>
                <strong>{text(dashboardSummary.monthShifts || 0)}</strong>
                <small>รวม <strong style={{ color: '#2563eb' }}>{text(dashboardSummary.totalHours || 0)}</strong> ชั่วโมง</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <span className="metric-icon amber">⚠️</span>
              <div>
                <p>ใบอนุญาตใกล้หมดอายุ</p>
                <strong style={{ color: Number(dashboardSummary.expiringLicenses || 0) > 0 ? '#d97706' : '#1e293b' }}>{text(dashboardSummary.expiringLicenses || 0)}</strong>
                <small>{Number(dashboardSummary.expiringLicenses || 0) > 0 ? 'ต้องต่ออายุภายใน 60 วัน' : 'ไม่มีใบอนุญาตติดบล็อก'}</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #8b5cf6' }}>
              <span className="metric-icon violet">📝</span>
              <div>
                <p>คำขอลาค้างอนุมัติ</p>
                <strong style={{ color: Number(dashboardSummary.pendingLeaves || 0) > 0 ? '#7c3aed' : '#1e293b' }}>{text(dashboardSummary.pendingLeaves || 0)}</strong>
                <small>{Number(dashboardSummary.pendingLeaves || 0) > 0 ? 'รอผู้บริหารอนุมัติวันลา' : 'ไม่มีคำขอลาค้าง'}</small>
              </div>
            </article>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', marginBottom: '24px' }}>
            <div className="table-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>📊 สัดส่วนกะปฏิบัติงานประจำเดือน</h3>
                <span className="record-chip">รวม {text(dashboardSummary.monthShifts || 0)} กะ</span>
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>การกระจายกำลังพลรักษาความปลอดภัยตามประเภทกะเดือนนี้</p>

              <div style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#15803d' }}>☀️ กะเช้า (D 07:00–19:00)</span>
                    <span style={{ color: '#15803d' }}>48%</span>
                  </div>
                  <div style={{ height: '8px', background: '#dcfce7', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '48%', height: '100%', background: '#22c55e', borderRadius: '999px' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#6b21a8' }}>🌙 กะดึก (N 19:00–07:00)</span>
                    <span style={{ color: '#6b21a8' }}>38%</span>
                  </div>
                  <div style={{ height: '8px', background: '#f3e8ff', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '38%', height: '100%', background: '#a855f7', borderRadius: '999px' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#be185d' }}>🏖️ วันหยุด (OFF / AL)</span>
                    <span style={{ color: '#be185d' }}>14%</span>
                  </div>
                  <div style={{ height: '8px', background: '#ffe4e6', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '14%', height: '100%', background: '#f43f5e', borderRadius: '999px' }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="table-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>⚡ รายการแจ้งเตือนและการดําเนินการ</h3>
                <span className={`status-badge ${pendingTotal > 0 ? 'pending' : 'active'}`}>
                  {pendingTotal > 0 ? `${pendingTotal} รายการด่วน` : 'ปกติดี'}
                </span>
              </div>

              <div style={{ display: 'grid', gap: '12px' }}>
                {Number(dashboardSummary.expiringLicenses || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>⚠️</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#92400e' }}>มีใบอนุญาต {text(dashboardSummary.expiringLicenses)} รายการใกล้หมดอายุ</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>ตรวจสอบและอัปเดตวันหมดอายุเพื่อป้องกัน License Block</p>
                      </div>
                    </div>
                    <button className="btn-warning compact action-nowrap" onClick={() => setActivePage('licenses')}>จัดการ</button>
                  </div>
                )}

                {Number(dashboardSummary.pendingLeaves || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>⏳</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#1e40af' }}>มี {text(dashboardSummary.pendingLeaves)} คำขอลาพักรอการอนุมัติ</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#1d4ed8' }}>อนุมัติหรือปฏิเสธคำขอลาเข้าสู่ตารางกะ</p>
                      </div>
                    </div>
                    <button className="btn-info compact action-nowrap" onClick={() => setActivePage('leavePending')}>ตรวจอนุมัติ</button>
                  </div>
                )}

                {Number(dashboardSummary.pendingUsers || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>👤</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#92400e' }}>มี {text(dashboardSummary.pendingUsers)} บัญชีผู้ใช้ใหม่รออนุมัติสิทธิ์</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>กำหนดบทบาท Role และเปิดสิทธิ์เข้าใช้งาน</p>
                      </div>
                    </div>
                    <button className="btn-warning compact action-nowrap" onClick={() => setActivePage('users')}>อนุมัติบัญชี</button>
                  </div>
                )}

                {pendingTotal === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', color: '#166534' }}>
                    <span style={{ fontSize: '28px', display: 'block', marginBottom: '4px' }}>✓</span>
                    <strong style={{ fontSize: '15px' }}>ไม่พบรายการแจ้งเตือนด่วน</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#15803d' }}>ระบบตารางกะและใบอนุญาตทั้งหมดอยู่ในสถานะปกติ</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="table-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', background: '#f8fafc' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🚀</span>
              <div>
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>ทางลัดการใช้งานระบบ (Quick Actions)</strong>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>เข้าสู่เมนูหลักต่างๆ ได้อย่างรวดเร็ว</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button className="btn-neutral small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('schedule')}>🗓️ จัดตารางกะ</button>
              <button className="btn-neutral small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('employees')}>👤 ข้อมูลพนักงาน</button>
              <button className="btn-neutral small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('licenses')}>▣ ใบอนุญาต</button>
              <button className="btn-neutral small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('leave')}>▥ คำขอลา</button>
              <button className="btn-neutral small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('rules')}>🛡️ กฎการทำงาน</button>
            </div>
          </div>
        </section>
      );
    }
    if (activePage === 'employees') return <PersonnelDirectoryPage employees={employees} totalCount={totalCount} loading={empLoading} error={typeof fetchError === 'string' ? fetchError : fetchError?.message} canManage={canManage} role={auth.user?.role || 'VIEWER'} searchValue={search} onSearchValueChange={setSearch} onAdd={() => openEmployeeEditor()} onReviewChanges={() => { if (auth.user?.role === 'ADMIN' && !auth.isViewingAs) setEmployeeChangeReviewOpen(true); }} onEdit={openEmployeeEditor} onRefresh={() => setEmployeeRefresh((value) => value + 1)} />;
    if (activePage === 'audit') {
      const auditRows = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <AuditCompliancePage rows={auditRows} total={operationResponse.meta?.total ?? auditRows.length} page={operationResponse.meta?.page || operationPage} totalPages={operationResponse.meta?.totalPages || 1} pageSize={auditPageSize} loading={operationLoading} error={typeof operationError === 'string' ? operationError : operationError?.message} permissionDenied={auth.user?.role !== 'ADMIN'} filters={auditFilters} onFiltersChange={(filters) => { setAuditFilters(filters); setOperationPage(1); }} onRefresh={() => setOperationRefresh((value) => value + 1)} onPageChange={setOperationPage} onPageSize={(value) => { setAuditPageSize(value); setOperationPage(1); }} onExport={(rows) => downloadCsv(rows as DataRow[], 'audit-events')} onPrint={() => window.print()} />;
    }
    if (activePage === 'dataQuality') {
      const qualityRows = Array.isArray(operationResponse.data) ? operationResponse.data as DataQualityIssue[] : [];
      return <DataQualityCenterPage rows={qualityRows} summary={operationResponse.summary} total={operationResponse.meta?.total ?? operationResponse.summary?.total ?? qualityRows.length} page={operationResponse.meta?.page || operationPage} pageSize={operationResponse.meta?.pageSize || dataQualityPageSize} totalPages={operationResponse.meta?.totalPages || 0} loading={operationLoading} error={typeof operationError === 'string' ? operationError : operationError?.message} permissionDenied={auth.user?.role !== 'ADMIN'} filters={dataQualityFilters} onFiltersChange={(filters) => { setDataQualityFilters(filters); setOperationPage(1); }} onRefresh={() => setOperationRefresh((value) => value + 1)} onPageChange={setOperationPage} onPageSize={(value) => { setDataQualityPageSize(value); setOperationPage(1); }} onNavigate={(page) => setActivePage(page)} />;
    }
    if (activePage === 'shiftSetup') return (
      <section className="view-pane">
        <div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>Shift Setup</h1><p>กำหนดรหัสกะ และเวลาปฏิบัติงานที่ใช้ใน ตารางกะรายเดือน</p></div><div className="heading-actions">{auth.user?.role === 'ADMIN' && <button className="btn-primary compact" onClick={openShiftTypeCreator}>+ เพิ่มรหัสกะ</button>}<span className="record-chip">ทั้งหมด {shiftTypes.length} รหัสกะ</span></div></div>
        <ErrorAlert message={operationError} />
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Shift Code</th><th>ชื่อกะ</th><th>เวลาเริ่ม</th><th>เวลาเลิก</th><th>ชั่วโมง</th><th>สี</th>{auth.user?.role === 'ADMIN' && <th>จัดการ</th>}</tr></thead><tbody>{shiftTypes.length ? shiftTypes.map((shiftType) => <tr key={text(shiftType.id)}><td><code>{text(shiftType.code)}</code></td><td className="employee-name">{text(shiftType.name)}</td><td>{text(shiftType.startTime)}</td><td>{text(shiftType.endTime)}</td><td>{text(shiftType.hours)}</td><td><span className="shift-color" style={{ backgroundColor: String(shiftType.color || '#2F80FF') }} /> {text(shiftType.color)}</td>{auth.user?.role === 'ADMIN' && <td className="row-actions data-row-actions"><button className="btn-secondary compact" onClick={() => openShiftTypeEditor(shiftType)}>แก้ไข</button><button className="danger-action" disabled={['D', 'N', 'OFF', 'AL'].includes(String(shiftType.code))} onClick={async () => { if (!auth.token || !window.confirm(`ยืนยันการลบรหัสกะ ${text(shiftType.code)}?`)) return; try { await api.deleteShiftType(auth.token, String(shiftType.id)); setOperationRefresh((value) => value + 1); } catch (reason) { setOperationError(toRequestErrorState(reason, 'ลบรหัสกะไม่สำเร็จ')); } }}>ลบ</button></td>}</tr>) : <tr><td colSpan={auth.user?.role === 'ADMIN' ? 7 : 6} className="no-rows">ยังไม่มีข้อมูลรหัสกะ</td></tr>}</tbody></table></div></div>
      </section>
    );
    if (activePage === 'schedule') {
      const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
      const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
      const allCalendarEmployees = [...rawCalendarEmployees].sort((a, b) => (String(a.employeeCode || '')).localeCompare(String(b.employeeCode || ''), undefined, { numeric: true }));
      const calendarEmployees = selectedDepartments.length > 0
        ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
        : allCalendarEmployees;
      const approval = nested(calendar.approval);
      const [yStr, mStr] = scheduleMonth.split('-');
      const thaiYearNum = Number(yStr) + 543;
      const monthNameOnly = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1)));
      const monthLabel = `${monthNameOnly} พ.ศ. ${thaiYearNum}`;
      const departments = Array.from(new Set(employees.map((employee) => employee.department || '').filter(Boolean))).sort();
      const moveMonth = (delta: number) => { const value = new Date(`${scheduleMonth}-01T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + delta); setScheduleMonth(value.toISOString().slice(0, 7)); };
      const previewRows = Array.isArray(autoSchedulePreview?.rows) ? autoSchedulePreview.rows as DataRow[] : [];
      const previewWarnings = Array.isArray(autoSchedulePreview?.warnings) ? autoSchedulePreview.warnings : [];
      const previewSummary = nested(autoSchedulePreview?.summary);

      const applyPreviewToDrafts = (previewRowsParam: DataRow[], replaceEmployeeId?: string) => {
        const newDrafts = { ...scheduleDrafts };
        if (replaceEmployeeId) {
          for (const key of Object.keys(newDrafts)) {
            if (key.startsWith(`${replaceEmployeeId}_`) && String(newDrafts[key].workDate || '').startsWith(scheduleMonth)) delete newDrafts[key];
          }
        }
        for (const row of previewRowsParam) {
          const workDateStr = inputDate(row.date);
          const empId = String(row.employeeId || '');
          if (!empId || !workDateStr) continue;
          const key = `${empId}_${workDateStr}`;
          const codeStr = String(row.code || 'OFF').toUpperCase();
          const selectedType = shiftTypes.find((t) => String(t.code).toUpperCase() === codeStr)
            || shiftTypes.find((t) => String(t.id) === row.shiftTypeId)
            || shiftTypes[0];
          const validShiftTypeId = String(selectedType?.id || '');
          if (!validShiftTypeId || validShiftTypeId.length < 10) continue;

          newDrafts[key] = {
            action: row.existingShiftId ? 'update' : 'create',
            id: row.existingShiftId ? String(row.existingShiftId) : undefined,
            employeeId: empId,
            workDate: workDateStr,
            shiftTypeId: validShiftTypeId,
            shiftCode: codeStr,
            shiftName: String(selectedType?.name || codeStr),
            startTime: String(selectedType?.startTime || (codeStr === 'N' ? '22:00' : codeStr === 'D' ? '08:00' : '00:00')),
            endTime: String(selectedType?.endTime || (codeStr === 'N' ? '06:00' : codeStr === 'D' ? '16:00' : '00:00')),
            color: String(selectedType?.color || (codeStr === 'D' ? '#2563eb' : codeStr === 'N' ? '#7c3aed' : '#64748b')),
            remark: String(row.remark || 'จัดด้วยไม้กายสิทธิ์ (ฉบับร่าง)'),
            licenseStatus: String(row.licenseStatus || ''),
            licenseOverride: Boolean(row.licenseOverride),
            overrideReason: String(row.overrideReason || ''),
            payload: {
              employeeId: empId,
              workDate: workDateStr,
              shiftTypeId: validShiftTypeId,
              remark: String(row.remark || 'จัดด้วยไม้กายสิทธิ์'),
              licenseOverride: Boolean(row.licenseOverride),
              overrideReason: String(row.overrideReason || '')
            }
          };
        }
        setScheduleDrafts(newDrafts);
      };

      const previewAutoSchedule = async () => {
        if (!auth.token) return;
        setAutoScheduleBusy(true); setOperationError(undefined);
        try { const result = await api.previewAutoSchedule(auth.token, scheduleMonth); setAutoSchedulePreview(result.data || {}); }
        catch (reason) { setOperationError(toRequestErrorState(reason, 'สร้างตัวอย่างตารางอัตโนมัติไม่สำเร็จ')); }
        finally { setAutoScheduleBusy(false); }
      };
      const saveAutoSchedule = () => {
        applyPreviewToDrafts(previewRows);
        setAutoSchedulePreview(undefined);
      };
      const openEmployeeScheduleWizard = (employee: DataRow) => {
        if (employeeAutoScheduleBusyId) return;
        setEmployeeAutoContinue(true); setEmployeeAutoStartPhase('D1'); setEmployeeAutoScheduleTarget(employee);
      };
      const exportApprovedExcel = async () => {
        if (!auth.token) return;
        setScheduleExportBusy(true); setOperationError(undefined);
        try {
          const result = await api.exportScheduleExcel(auth.token, { month: scheduleMonth, scope: selectedDepartments.length ? 'selected' : 'all', departments: selectedDepartments });
          downloadBlob(result.blob, result.fileName || `SMS-Schedule-${scheduleMonth}.xlsx`);
        } catch (reason) { setOperationError(toRequestErrorState(reason, 'ส่งออก Excel ไม่สำเร็จ')); }
        finally { setScheduleExportBusy(false); }
      };
      return <section className="view-pane schedule-calendar-page">
        <div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>ตารางกะรายเดือน</h1><p>จัดกะรายเดือน (โหมดบันทึกด้วยตนเอง: แก้ไขกะหรือลบกะในตารางได้ต่อเนื่อง แล้วกด 💾 บันทึกการเปลี่ยนแปลง เพื่อบันทึกทีเดียว)</p></div><div className="heading-actions">{auth.user?.role === 'ADMIN' && !auth.isViewingAs && <button className="btn-neutral small-action" onClick={() => setActivePage('approvals')}>ประวัติการอนุมัติ</button>}{approval.status === 'APPROVED' && <><button className="excel-action" disabled={scheduleExportBusy} onClick={exportApprovedExcel}>▦ {scheduleExportBusy ? 'กำลังสร้าง Excel…' : `Export Excel${selectedDepartments.length ? ` · ${selectedDepartments.length} แผนก` : ''}`}</button><button className="btn-info small-action" onClick={() => void printScheduleDocument()}>📄 Export PDF</button></>}</div></div>
        <div className={`approval-banner ${approval.status === 'APPROVED' ? 'approved' : 'pending'}`}><div><strong>{approval.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : '● รออนุมัติ'} · {monthLabel}</strong><small>Revision {text(approval.revision || 1)}{approval.approvedAt ? ` · อนุมัติโดย ${text(approval.approvedBy || approval.approvedByDisplayName || 'Admin')} เมื่อ ${date(approval.approvedAt)}` : ' · การแก้ตารางจะสร้าง revision ใหม่โดยอัตโนมัติ'}</small></div>{auth.user?.role === 'ADMIN' && approval.status !== 'APPROVED' && <button className="btn-primary compact" style={{ backgroundColor: '#059669', borderColor: '#047857', fontWeight: 'bold' }} onClick={async () => { if (!auth.token || !window.confirm(`ยืนยันอนุมัติตารางกะประจำเดือน ${monthLabel}?`)) return; setOperationError(undefined); try { if (approval.id) { await api.updateScheduleApproval(auth.token, String(approval.id), { status: 'APPROVED' }); } else { await api.approveScheduleMonth(auth.token, scheduleMonth); } const updated = await api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment); setOperationResponse(updated); } catch (reason) { setOperationError(toRequestErrorState(reason, 'อนุมัติตารางไม่สำเร็จ')); } }}>อนุมัติ ตารางเดือนนี้</button>}</div>
        <div className="calendar-toolbar-box schedule-workbench" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px 20px', margin: '14px 0 16px 0', boxShadow: '0 2px 6px rgba(37, 99, 235, 0.05)' }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e40af', marginBottom: '8px' }}>
            เลือกเดือนที่จะจัดกะ: {monthLabel} (สูงสุด 1 เดือน)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <MonthGridPicker value={scheduleMonth} onChange={setScheduleMonth} />
            <button className="btn-neutral small-action" onClick={() => moveMonth(-1)}>‹ เดือนก่อน</button>
            <button className="btn-neutral small-action" onClick={() => moveMonth(1)}>เดือนถัดไป ›</button>

            <div className="schedule-department-control">
              <button
                type="button"
                className="btn-neutral small-action schedule-department-trigger"
                onClick={() => setDeptMenuOpen((prev) => !prev)}
              >
                🏢 แผนก: {selectedDepartments.length === 0 ? 'ทุกแผนก' : `${selectedDepartments.length} แผนกที่เลือก`} ▾
              </button>
              {deptMenuOpen && (
                <div className="schedule-department-popover">
                  <div className="schedule-department-popover-header">
                    <span>เลือกแผนกที่ต้องการกรอง</span>
                    <button type="button" className="schedule-department-clear" onClick={() => setSelectedDepartments([])}>แสดงทุกแผนก</button>
                  </div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {departments.map((dept) => {
                      const checked = selectedDepartments.includes(dept);
                      return (
                        <label key={dept} className="schedule-department-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDepartments((prev) => [...prev, dept]);
                              } else {
                                setSelectedDepartments((prev) => prev.filter((d) => d !== dept));
                              }
                            }}
                          />
                          <span>{dept}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {auth.user?.role === 'ADMIN' && (
              <button className="btn-primary compact" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 100%)', border: 'none', fontWeight: 'bold', padding: '8px 14px', borderRadius: '8px' }} disabled={autoScheduleBusy} onClick={previewAutoSchedule}>
                {autoScheduleBusy ? 'กำลังคำนวณ…' : '✨ ดูตัวอย่างจัดกะอัตโนมัติ'}
              </button>
            )}
            <span className="toolbar-count" style={{ marginLeft: 'auto' }}>แสดง {calendarEmployees.length} จาก {operationResponse.meta?.total || 0} คน</span>
          </div>
          <div title="ไม้กายสิทธิ์สำหรับ Admin — จัดกะทุกคนด้วย Shared Pattern Engine เดียวกับไม้กายสิทธิ์รายบุคคล" style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
            Auto Continue แบบเดียวกับไม้กายสิทธิ์รายบุคคล · Supervisor ทำงาน จ.-ส. / OFF อาทิตย์ · พนักงานทั่วไป 6D / OFF / 6N / OFF · คง AL และ Admin license override
          </div>

          <div className="schedule-draft-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', paddingTop: '12px', borderTop: '1px dashed #bfdbfe' }}>
            <button type="button" className="btn-primary compact" style={{ padding: '8px 18px', fontWeight: 'bold', fontSize: '14px', borderRadius: '8px' }} disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0} onClick={saveAllDrafts}>
              {batchSaveBusy ? 'กำลังบันทึก…' : `บันทึกการเปลี่ยนแปลงทั้งหมด (${Object.keys(scheduleDrafts).length})`}
            </button>
            <button
              className="btn-danger compact"
              style={{ fontSize: '13px', fontWeight: 'bold', padding: '8px 16px', borderRadius: '8px' }}
              disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0}
              onClick={() => { if (Object.keys(scheduleDrafts).length > 0 && window.confirm('ยกเลิกรายการเปลี่ยนแปลงทั้งหมดที่ยังไม่ได้บันทึกหรือไม่?')) { setScheduleDrafts({}); } }}
            >
              ยกเลิกรายการเปลี่ยนแปลงทั้งหมด
            </button>
            <span style={{ fontSize: '13px', color: '#475569' }}>
              คลิกช่องกะเพื่อแก้หลายรายการ แล้วค่อยบันทึกครั้งเดียว
            </span>
          </div>
        </div>
        {auth.user?.role === 'ADMIN' && autoSchedulePreview && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !autoScheduleBusy) setAutoSchedulePreview(undefined); }}>
            <section className="edit-dialog" style={{ maxWidth: '780px', backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div className="dialog-heading" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>🪄 ตัวอย่างตารางจัดกะอัตโนมัติ ( Auto Schedule Preview )</h2>
                <button type="button" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}>×</button>
              </div>

              <div className="preview-summary" style={{ display: 'flex', gap: '16px', marginBottom: '14px', fontSize: '13px', color: '#334155' }}>
                <span><b>{text(previewSummary.employees)}</b> พนักงาน</span>
                <span><b>{text(previewSummary.totalRows)}</b> กะทั้งหมด</span>
                <span><b>{text(previewSummary.manualLocked)}</b> รายการที่คงไว้</span>
                <span><b>{previewWarnings.length}</b> คำเตือน</span>
              </div>

              {previewWarnings.length > 0 && (
                <div className="preview-warning" style={{ backgroundColor: '#fff7ed', border: '1px solid #ffedd5', color: '#c2410c', padding: '12px', borderRadius: '10px', marginBottom: '14px', fontSize: '13px' }}>
                  <strong>รายการที่ต้องตรวจสอบ:</strong>
                  {previewWarnings.slice(0, 8).map((warning, index) => <p key={`${String(warning)}-${index}`} style={{ margin: '4px 0 0 0' }}>• {text(warning)}</p>)}
                </div>
              )}

              <div className="table-scroll preview-table-wrap" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <table className="data-table preview-table" style={{ width: '100%' }}>
                  <thead>
                    <tr><th>พนักงาน</th><th>วันที่</th><th>กะ</th><th>เหตุผล</th></tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 50).map((row, index) => (
                      <tr key={`${text(row.employeeId)}-${text(row.date)}-${index}`}>
                        <td>{text(row.employeeName)}</td>
                        <td>{date(row.date)}</td>
                        <td><span className={`status-badge ${row.code === 'OFF' ? 'inactive' : 'active'}`}>{text(row.code)}</span></td>
                        <td>{text(row.remark)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="preview-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button className="btn-secondary" style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}>ยกเลิก Preview</button>
                <button className="btn-primary compact" style={{ padding: '9px 20px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={saveAutoSchedule}>🪄 ใส่ลงในฉบับร่าง (ยังไม่บันทึก)</button>
              </div>
            </section>
          </div>
        )}
        <ErrorAlert message={operationError} />
        <div className="table-card calendar-card">{operationLoading && !calendarEmployees.length ? <div className="loading-row">กำลังอ่านตารางกะรายเดือน…</div> : <div className="table-scroll" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return; const el = e.currentTarget; el.dataset.isDown = 'true'; el.dataset.startX = String(e.pageX - el.offsetLeft); el.dataset.startY = String(e.pageY - el.offsetTop); el.dataset.scrollLeft = String(el.scrollLeft); el.dataset.scrollTop = String(el.scrollTop); }} onMouseLeave={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseUp={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseMove={(e) => { const el = e.currentTarget; if (el.dataset.isDown !== 'true') return; e.preventDefault(); const x = e.pageX - el.offsetLeft; const y = e.pageY - el.offsetTop; const walkX = (x - Number(el.dataset.startX || 0)) * 1.5; const walkY = (y - Number(el.dataset.startY || 0)) * 1.5; el.scrollLeft = Number(el.dataset.scrollLeft || 0) - walkX; el.scrollTop = Number(el.dataset.scrollTop || 0) - walkY; }}><table className="schedule-grid"><thead><tr><th className="employee-sticky">พนักงาน</th>{dates.map((day) => { const dayValue = new Date(`${day}T00:00:00Z`); const weekend = [0, 6].includes(dayValue.getUTCDay()); return <th key={day} className={weekend ? 'weekend' : ''}><b>{dayValue.getUTCDate()}</b><small>{new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(dayValue)}</small></th>; })}</tr></thead><tbody>{calendarEmployees.length ? calendarEmployees.map((employee) => { const employeeShifts = Array.isArray(employee.shifts) ? employee.shifts as DataRow[] : []; const isSchedulingEmployee = employeeAutoScheduleBusyId === String(employee.id); return <tr key={text(employee.id)}><td className="employee-sticky"><strong>{text(employee.displayName || `${text(employee.firstName)} ${text(employee.lastName)}`)}{canManage && <button className="employee-magic-button" disabled={Boolean(employeeAutoScheduleBusyId)} title="🪄 จัดกะแพทเทิร์นด่วน: 6 วันทำงาน / 1 วันหยุด" onClick={() => openEmployeeScheduleWizard(employee)}>{isSchedulingEmployee ? '…' : '🪄'}</button>}</strong><small>{text(employee.employeeCode)} · {text(employee.department)}</small></td>{dates.map((day) => { const draftKey = `${employee.id}_${day}`; const draftItem = scheduleDrafts[draftKey]; const shift = employeeShifts.find((item) => inputDate(item.workDate) === day); const shiftType = nested(shift?.shiftType); const shiftCode = text(shiftType.code).toLowerCase(); const coreShift = ['d', 'n', 'off', 'al'].includes(shiftCode); const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()); if (draftItem) { if (draftItem.action === 'delete') { return <td key={day} className={weekend ? 'weekend' : ''}><div className="calendar-shift-wrap"><button className="empty-shift" style={{ color: '#ef4444', borderColor: '#fca5a5' }} title="กะถูกลบในฉบับร่าง (คลิกคืนค่า)" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}>✕ ลบแล้ว</button></div></td>; } const draftCore = ['d', 'n', 'off', 'al'].includes((draftItem.shiftCode || '').toLowerCase()); return <td key={day} className={weekend ? 'weekend' : ''}><div className="calendar-shift-wrap"><button className={`calendar-shift shift-${(draftItem.shiftCode || 'd').toLowerCase()}`} style={draftCore ? { border: '2px dashed #2563eb' } : { backgroundColor: String(draftItem.color || '#64748B'), border: '2px dashed #2563eb' }} title="กะฉบับร่าง (ยังไม่ได้บันทึก)" onClick={(e) => canManage && openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day, shiftTypeId: String(draftItem.shiftTypeId || '') }, e)}><b>{text(draftItem.shiftCode)} *</b><small>{text(draftItem.startTime)}–{text(draftItem.endTime)}</small><small className="shift-note" style={{ color: '#2563eb', fontWeight: 'bold' }}>ร่าง</small></button><button className="calendar-delete" title="ยกเลิกฉบับร่าง" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}>×</button></div></td>; } return <td key={day} className={weekend ? 'weekend' : ''}>{shift ? <div className="calendar-shift-wrap"><button className={`calendar-shift shift-${shiftCode}`} style={coreShift ? undefined : { backgroundColor: String(shiftType.color || '#64748B') }} title={`${text(shiftType.name)} · ${text(shift.startTime)}-${text(shift.endTime)}`} onClick={(e) => canManage && openShiftEditor(shift, {}, e)}><b>{text(shiftType.code).toUpperCase()}</b><small>{text(shiftType.code).toUpperCase() === 'OFF' ? 'วันหยุด' : `${text(shift.startTime || '07:00')}–${text(shift.endTime || '19:00')}`}</small>{(() => {
  const licStatus = String(shift.licenseStatus || '').toUpperCase();
  const remarkStr = String(shift.remark || '');
  const isBlocked = ['EXPIRED', 'MISSING', 'INVALID'].includes(licStatus) || remarkStr.toLowerCase().includes('license block') || remarkStr.includes('ใบอนุญาตไม่ผ่าน');
  const isOverridden = licStatus === 'OVERRIDDEN';

  return (
    <>
      {Boolean(shift.locked) && <small className="shift-note" style={{ color: '#d97706', fontWeight: 700, display: 'block' }}>MANUAL 🔒</small>}
      {isOverridden && <small className="shift-note" style={{ color: '#2563eb', fontWeight: 700, display: 'block' }}>OVERRIDE ⚡</small>}
      {isBlocked && <small className="shift-note" style={{ color: '#dc2626', fontWeight: 700, display: 'block' }}>License Block</small>}
    </>
  );
})()}</button>{canManage && <button className="calendar-delete" aria-label={`ลบกะ ${day}`} onClick={() => { const key = `${employee.id}_${day}`; setScheduleDrafts((prev) => ({ ...prev, [key]: { action: 'delete', id: String(shift.id), employeeId: String(employee.id), workDate: day } })); }}>×</button>}</div> : canManage ? <button className="empty-shift" title="เพิ่มกะ" onClick={(e) => openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day }, e)}>+</button> : <span className="empty-shift read-only">–</span>}</td>; })}</tr>; }) : <tr><td colSpan={dates.length + 1} className="no-rows">ไม่มีพนักงานหรือตารางกะในตัวกรองนี้</td></tr>}</tbody></table></div>}</div>
        {operationResponse.meta?.totalPages && operationResponse.meta.totalPages > 1 && <div className="pagination-bar"><button disabled={(operationResponse.meta.page || 1) <= 1 || operationLoading} onClick={() => setOperationPage((operationResponse.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {operationResponse.meta.page} จาก {operationResponse.meta.totalPages}</span><button disabled={(operationResponse.meta.page || 1) >= operationResponse.meta.totalPages || operationLoading} onClick={() => setOperationPage((operationResponse.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}
        {employeeAutoScheduleTarget && <EmployeeMagicWandModal target={employeeAutoScheduleTarget} scheduleMonth={scheduleMonth} token={auth.token} busy={Boolean(employeeAutoScheduleBusyId)} onClose={() => setEmployeeAutoScheduleTarget(undefined)} onSubmit={async (autoContinue, startPhase, patternType) => { if (!auth.token || !employeeAutoScheduleTarget || employeeAutoScheduleBusyId) return; const employeeId = String(employeeAutoScheduleTarget.id || ''); if (!employeeId) return; const phase = autoContinue ? 'AUTO' : startPhase; setEmployeeAutoScheduleBusyId(employeeId); setOperationError(undefined); try { const result = await api.previewEmployeeAutoSchedule(auth.token, scheduleMonth, employeeId, phase, patternType); const rows = Array.isArray(result?.data?.rows) ? result.data.rows as DataRow[] : []; applyPreviewToDrafts(rows, employeeId); setEmployeeAutoScheduleTarget(undefined); } catch (reason) { setOperationError(toRequestErrorState(reason, 'สร้างฉบับร่างจัดกะอัตโนมัติรายบุคคลไม่สำเร็จ')); } finally { setEmployeeAutoScheduleBusyId(undefined); } }} />}
        {shiftEditorTarget && (
          <ShiftEditorModal
            shift={shiftEditorTarget.shift}
            defaults={shiftEditorTarget.defaults}
            employees={calendarEmployees.length ? calendarEmployees : (Array.isArray(operationResponse.data) ? operationResponse.data as DataRow[] : [])}
            shiftTypes={shiftTypes}
            licenses={licensesData}
            isAdmin={auth.user?.role === 'ADMIN'}
            onClose={() => setShiftEditorTarget(null)}
            onSubmit={(data) => {
              const key = `${data.employeeId}_${data.workDate}`;
              const selectedType = shiftTypes.find((t) => String(t.id) === data.shiftTypeId);
              const payload: Record<string, unknown> = {
                employeeId: data.employeeId,
                shiftTypeId: data.shiftTypeId,
                workDate: data.workDate,
                remark: data.remark,
                licenseOverride: data.licenseOverride,
                overrideReason: data.overrideReason
              };
              setScheduleDrafts((prev) => ({
                ...prev,
                [key]: {
                  action: shiftEditorTarget.shift ? 'update' : 'create',
                  id: shiftEditorTarget.shift ? String(shiftEditorTarget.shift.id) : undefined,
                  employeeId: data.employeeId,
                  workDate: data.workDate,
                  shiftTypeId: data.shiftTypeId,
                  shiftCode: String(selectedType?.code || ''),
                  shiftName: String(selectedType?.name || ''),
                  startTime: String(selectedType?.startTime || ''),
                  endTime: String(selectedType?.endTime || ''),
                  color: String(selectedType?.color || '#64748B'),
                  remark: data.remark,
                  licenseOverride: data.licenseOverride,
                  overrideReason: data.overrideReason,
                  payload
                }
              }));
              setShiftEditorTarget(null);
            }}
          />
        )}
      </section>;
    }
    if (['leave', 'leavePending', 'leaveHistory'].includes(activePage)) {
      const rows = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const remaining = nested(leaveSummary.remaining);
        const canCancelApprovedLeave = auth.user?.role === 'ADMIN';
        return <LeaveManagementPage mode={activePage === 'leavePending' ? 'pending' : activePage === 'leaveHistory' ? 'history' : 'all'} historyScope={activePage === 'leaveHistory' ? 'all' : 'mine'} historyMonth={activePage === 'leaveHistory' ? leaveMonth : undefined} historyTotal={activePage === 'leaveHistory' ? operationResponse.meta?.total : undefined} historyPage={activePage === 'leaveHistory' ? operationResponse.meta?.page : undefined} historyTotalPages={activePage === 'leaveHistory' ? operationResponse.meta?.totalPages : undefined} historyStatusCounts={activePage === 'leaveHistory' ? operationResponse.meta?.statusCounts : undefined} employeeId={String(leaveSummary.employeeId || '')} rows={rows} loading={operationLoading} error={operationError} linked={Boolean(leaveSummary.linked)} remaining={remaining} quotaYear={Number(leaveSummary.quotaYear || currentBangkokQuotaYear())} canManage={pwaShell ? false : canManage} canSubmit={(pwaShell ? pwaOnline : true) && (auth.user?.role !== 'VIEWER' || Boolean(leaveSummary.linked))} canCancelApprovedLeave={canCancelApprovedLeave} mutationsEnabled={!pwaShell || pwaOnline} employeeOptions={employeeOptions} onRefresh={() => setOperationRefresh((value) => value + 1)} onHistoryMonthChange={changeLeaveMonth} onHistoryMonthStep={(delta) => changeLeaveMonth(shiftMonthValue(leaveMonth, delta))} onHistoryPageChange={setOperationPage} onApprove={(row) => handleOperationAction(row, 'approve')} onReject={(row) => handleOperationAction(row, 'reject')} onReturnForCorrection={(row) => handleOperationAction(row, 'return')} onEditReturned={(row) => runEditor({
          title: `แก้ไขคำขอลา · ${text(row.employeeNameSnapshot)}`,
          submitLabel: 'บันทึกและส่งตรวจสอบอีกครั้ง',
          fields: [
            { name: 'leaveType', label: 'ประเภทการลา', type: 'select', required: true, options: [{ value: 'SICK', label: 'ลาป่วย' }, { value: 'PERSONAL', label: 'ลากิจ' }, { value: 'VACATION', label: 'ลาพักร้อน' }] },
            { name: 'startDate', label: 'วันที่เริ่มลา', type: 'date', required: true },
            { name: 'endDate', label: 'วันที่สิ้นสุด', type: 'date', required: true },
            { name: 'substitute', label: 'ผู้ปฏิบัติงานแทน', required: true },
            { name: 'reason', label: 'เหตุผล / รายละเอียด', type: 'textarea' }
          ],
          values: {
            leaveType: String(row.leaveType || ''),
            startDate: inputDate(row.startDate),
            endDate: inputDate(row.endDate),
            substitute: String(row.substitute || ''),
            reason: String(row.reasonDetail || '')
          }
        }, async (form) => {
          await api.updateReturnedLeaveRequest(auth.token!, String(row.id), form);
          await api.resubmitLeaveRequest(auth.token!, String(row.id));
        })} onCancel={(row) => handleOperationAction(row, 'cancel')} onPrint={setLeavePrintTarget} onAttachment={async (row) => { if (!auth.token) return; try { const result = await api.downloadLeaveAttachment(auth.token, String(row.id)); const url = URL.createObjectURL(result.blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (reason) { setOperationError(toRequestErrorState(reason, 'เปิดไฟล์แนบไม่สำเร็จ')); } }} onSubmit={async (form, file) => { if (!auth.token) return; if (file) await api.createLeaveRequestWithAttachment(auth.token, form, file); else await api.createLeaveRequest(auth.token, form); setOperationRefresh((value) => value + 1); }} />;
    }
    if (activePage === 'rules') {
      const rules = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const results = Array.isArray(ruleCheckResponse.ruleResults) ? ruleCheckResponse.ruleResults as DataRow[] : [];
      const violations = Array.isArray(ruleCheckResponse.violations) ? ruleCheckResponse.violations as DataRow[] : [];
      const metrics = nested(ruleCheckResponse.metrics);
      const resultById = new Map(results.map((result) => [String(result.id), result]));
      return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>Rule Checking</h1><p>ตรวจสอบกฎเดิมกับตารางกะจาก PostgreSQL แบบ read-only</p></div><div className="heading-actions"><label className="month-filter"><span>เดือน</span><select value={scheduleMonth} onChange={(event) => setScheduleMonth(event.target.value)} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a' }}>{Array.from({ length: 24 }, (_, i) => { const d = new Date(Date.UTC(2025, i, 1)); const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; const name = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(d); const thaiYear = d.getUTCFullYear() + 543; return <option key={val} value={val}>{name} พ.ศ. {thaiYear}</option>; })}</select></label><button className="btn-neutral small-action" onClick={() => setOperationRefresh((value) => value + 1)}>ตรวจสอบอีกครั้ง</button></div></div>
        <ErrorAlert message={operationError} />
        <div className="rule-summary-grid"><article><span className={Number(metrics.violations || 0) ? 'rule-state fail' : 'rule-state pass'}>{Number(metrics.violations || 0) ? '!' : '✓'}</span><div><p>รายการขัดกฎทั้งหมด</p><strong>{text(metrics.violations)}</strong></div></article><article><span className="rule-state pass">✓</span><div><p>กฎที่ผ่าน</p><strong>{text(metrics.rulesPassed)} / {text(metrics.rulesChecked)}</strong></div></article><article><span className="rule-state pass">♙</span><div><p>พนักงาน Active</p><strong>{text(metrics.activeEmployees)}</strong></div></article><article><span className="rule-state pass">◷</span><div><p>ชั่วโมงรวม</p><strong>{text(metrics.totalHours)}</strong></div></article></div>
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Rule ID</th><th>ชื่อกฎ</th><th>ค่า</th><th>หน่วย</th><th>ผลตรวจ</th>{canManage && <th>จัดการ</th>}</tr></thead><tbody>{operationLoading ? <tr><td colSpan={canManage ? 6 : 5} className="loading-row">กำลังตรวจสอบกฎ…</td></tr> : rules.length ? rules.map((rule) => { const result = resultById.get(String(rule.ruleId)) || {}; return <tr key={text(rule.id)}><td><code>{text(rule.ruleId)}</code></td><td className="employee-name">{text(rule.name)}</td><td>{text(rule.value)}</td><td>{text(rule.unit)}</td><td><span className={`status-badge ${!rule.enabled ? 'inactive' : result.passed ? 'active' : 'pending'}`}>{!rule.enabled ? 'ปิดใช้' : text(result.summary || 'รอตรวจ')}</span></td>{canManage && <td className="row-actions data-row-actions"><button onClick={() => handleOperationAction(rule, 'edit')}>แก้ไข</button><button onClick={() => handleOperationAction(rule, 'toggle')}>{rule.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button></td>}</tr>; }) : <tr><td colSpan={canManage ? 6 : 5} className="no-rows">ยังไม่มีข้อมูลกฎ</td></tr>}</tbody></table></div></div>
        <div className="section-title"><div><h2>รายการที่ต้องแก้ไข</h2><p>{violations.length ? `พบ ${violations.length} รายการ` : 'ผ่านทุกกฎที่เปิดใช้งาน'}</p></div></div>
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Rule</th><th>รายการ</th><th>รายละเอียด</th><th>ระดับ</th></tr></thead><tbody>{violations.length ? violations.slice(0, 500).map((item, index) => <tr key={`${text(item.ruleId)}-${index}`}><td><code>{text(item.ruleId)}</code><small className="cell-note">{text(item.ruleName)}</small></td><td className="employee-name">{text(item.title)}</td><td>{text(item.description)}</td><td><span className={`status-badge ${item.severity === 'error' ? 'inactive' : 'pending'}`}>{text(item.severity)}</span></td></tr>) : <tr><td colSpan={4} className="no-rows">✓ ไม่พบรายการขัดกฎในเดือนนี้</td></tr>}</tbody></table></div></div>
      </section>;
    }
    if (activePage === 'attendance' && auth.token) {
      return <AttendancePage token={auth.token} displayName={auth.user?.displayName} readOnly={auth.isViewingAs} online={!pwaShell || pwaOnline} />;
    }
    if (activePage === 'profile' && auth.token) {
      return <PwaProfilePage user={auth.user} online={pwaOnline} readOnly={auth.isViewingAs} onOpenPasskeys={() => setPasskeyPanelOpen(true)} onLogout={() => auth.logout()} />;
    }
    if (activePage === 'attendanceDevice' && auth.token) {
      return <AttendanceDevicePage token={auth.token} role={auth.user?.role || 'VIEWER'} readOnly={auth.isViewingAs} />;
    }
    if (activePage === 'users') {
      const users = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <div className="users-access-workspace">
        <AccessManagementPage
          rows={users as Array<{ id: string; displayName?: string; role?: string; department?: string | null; accountStatus?: string; isActive?: boolean; passwordResetRequired?: boolean; createdAt?: string; updatedAt?: string }>}
          loading={operationLoading}
          error={typeof operationError === 'string' ? operationError : operationError?.message}
          role={auth.user?.role || 'VIEWER'}
          originalUserId={auth.originalUser?.id}
          onRefresh={() => setOperationRefresh((value) => value + 1)}
          onUpdate={async (id, payload) => { await api.updateUser(auth.token!, id, payload); setOperationRefresh((value) => value + 1); }}
          onResetPassword={async (id, newPassword) => { await api.resetUserPassword(auth.token!, id, newPassword); setOperationRefresh((value) => value + 1); }}
          onViewAs={async (id) => { await auth.beginViewAs(id); setActivePage('dashboard'); }}
          onOpenAudit={() => setActivePage('audit')}
        />
        <RegistrationReviewPanel token={auth.token!} role={auth.user?.role || 'VIEWER'} refreshSignal={operationRefresh} onChanged={() => setOperationRefresh((value) => value + 1)} onOpenEmployeeMaster={() => setActivePage('employees')} />
      </div>;
    }
    if (activePage === 'settings') {
      const settings = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <SettingsPage settings={settings} loading={operationLoading} error={operationError} onRefresh={() => setOperationRefresh((value) => value + 1)} onAudit={() => setActivePage('audit')} onSaveTemplates={async (newLeave, leaveStatus) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_NEW_LEAVE', { value: newLeave, description: 'เทมเพลตข้อความคำขอลาใหม่ (รูปแบบเดิม)' }), api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_LEAVE_STATUS', { value: leaveStatus, description: 'เทมเพลตข้อความอัปเดตสถานะการลา (รูปแบบเดิม)' })]); setOperationRefresh((value) => value + 1); }} onSaveAttendancePolicy={async (policy) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, attendancePolicyKeys.qrPolicy, { value: policy.qrPolicy, description: 'Attendance QR policy: ADAPTIVE / REQUIRED / DISABLED' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.maxAccuracyMeters, { value: String(policy.maxAccuracyMeters), description: 'GPS accuracy สูงสุดที่ Attendance ยอมรับ (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.maxAgeSeconds, { value: String(policy.maxAgeSeconds), description: 'อายุ GPS sample สูงสุด (วินาที)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.futureSkewSeconds, { value: String(policy.futureSkewSeconds), description: 'GPS future clock skew สูงสุด (วินาที)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.autoPassAccuracyMeters, { value: String(policy.autoPassAccuracyMeters), description: 'GPS accuracy สำหรับข้าม QR ใน Adaptive mode (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.innerMarginMeters, { value: String(policy.innerMarginMeters), description: 'ระยะจากขอบ geofence ที่ใช้ตัดสิน QR Step-up (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.stepUpOnSiteOverlap, { value: String(policy.stepUpOnSiteOverlap), description: 'ขอ QR Step-up เมื่อ GPS อยู่ในหลาย Site พร้อมกัน' })]); setOperationRefresh((value) => value + 1); }} />;
    }
    if ((activePage === 'reportCenter' || activePage === 'executiveReport' || activePage === 'reports') && auth.token) {
      const initialTab = activePage === 'reports' ? 'details' : 'executive';
      return <ReportCenterPage key={activePage} token={auth.token} role={auth.user?.role || 'VIEWER'} initialTab={initialTab} onNavigate={(page) => setActivePage(page as Page)} />;
    }
    if (activePage === 'quota') return <><div className="page-heading"><div><p className="eyebrow">การลา · Annual Entitlement</p><h1>โควตาวันลา {showLegacyQuotas ? 'ข้อมูลเดิม' : thaiQuotaYearLabel(quotaYear)}</h1><p>{showLegacyQuotas ? 'ข้อมูลเดิม — ยังไม่ระบุปี ต้องจัดประเภทก่อนใช้งานรายปี' : 'สิทธิ์รายปีแยกตาม Employee + Year'}</p></div><div className="heading-actions"><label className="month-filter"><span>ปีสิทธิ์</span><select aria-label="ปีสิทธิ์โควตาวันลา" disabled={showLegacyQuotas} value={quotaYear} onChange={(event) => setQuotaYear(Number(event.target.value))}>{quotaYearOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="btn-neutral small-action" type="button" onClick={() => setShowLegacyQuotas((value) => !value)}>{showLegacyQuotas ? 'กลับรายการรายปี' : 'ดูข้อมูลเดิมที่ยังไม่ระบุปี'}</button></div></div><OperationalTable page={activePage as OperationalPage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} onNavigate={setActivePage} role={auth.user?.role || 'VIEWER'} token={auth.token} refreshSignal={operationRefresh} onLicenseDocumentChanged={() => setOperationRefresh((value) => value + 1)} /></>;
    return <><OperationalTable page={activePage as OperationalPage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} onNavigate={setActivePage} role={auth.user?.role || 'VIEWER'} token={auth.token} refreshSignal={operationRefresh} onLicenseDocumentChanged={() => setOperationRefresh((value) => value + 1)} onEditLicense={activePage === 'licenses' ? openLicenseEdit : undefined} licenseEmployeeStatus={licenseEmployeeStatus} onLicenseEmployeeStatusChange={setLicenseEmployeeStatus} />{licenseEditTarget && auth.token && <LicenseEditModal license={{ id: String(licenseEditTarget.id), licenseNumber: licenseEditTarget.licenseNumber ? String(licenseEditTarget.licenseNumber) : null, licenseType: licenseEditTarget.licenseType ? String(licenseEditTarget.licenseType) : null, issueDate: licenseEditTarget.issueDate ? String(licenseEditTarget.issueDate) : null, expiryDate: licenseEditTarget.expiryDate ? String(licenseEditTarget.expiryDate) : null, status: licenseEditTarget.status ? String(licenseEditTarget.status) : null, employee: { employeeCode: String(nested(licenseEditTarget.employee).employeeCode || ''), firstName: String(nested(licenseEditTarget.employee).firstName || ''), lastName: String(nested(licenseEditTarget.employee).lastName || ''), department: nested(licenseEditTarget.employee).department ? String(nested(licenseEditTarget.employee).department) : undefined } }} isAdmin={auth.user?.role === 'ADMIN'} currentUserId={auth.user?.id || ''} services={licenseDocumentServices} onUpload={async (data, file) => { await api.uploadLicenseDocument(auth.token!, String(licenseEditTarget.id), data, file); }} onChanged={() => setOperationRefresh((value) => value + 1)} onClose={() => setLicenseEditTarget(undefined)} />}</>;
  };

  const printData = useMemo(() => {
    if (activePage !== 'schedule') return null;
    const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
    const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
    const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
    const allCalendarEmployees = [...rawCalendarEmployees].sort((a, b) => (String(a.employeeCode || '')).localeCompare(String(b.employeeCode || ''), undefined, { numeric: true }));
    const calendarEmployees = selectedDepartments.length > 0
      ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
      : allCalendarEmployees;
    const approval = nested(calendar.approval);
    const [yStr, mStr] = scheduleMonth.split('-');
    const thaiYearNum = Number(yStr) + 543;
    const monthNameOnly = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1)));
    const printMonthLabel = `${monthNameOnly} ${thaiYearNum}`;
    const printDepartments = Array.from(new Set(calendarEmployees.map((e) => String(e.department || '')))).sort();

    return {
      dates,
      calendarEmployees,
      approval,
      printMonthLabel,
      printDepartments
    };
  }, [activePage, operationResponse, selectedDepartments, scheduleMonth]);

  return (
    <>
      <div className={`app-shell ${auth.isViewingAs ? 'view-as-active' : ''} ${pwaShell ? 'pwa-shell' : ''}`}>
      {editor && <EditDialog editor={editor} busy={editorBusy} error={editorError} onClose={() => { setEditor(undefined); setEditorError(undefined); }} />}
      {employeeGovernedEditTarget && auth.token && !auth.isViewingAs && <EmployeeGovernedEditModal token={auth.token} employee={employeeGovernedEditTarget} role={auth.user?.role || 'VIEWER'} onClose={() => setEmployeeGovernedEditTarget(undefined)} onChanged={() => setEmployeeRefresh((value) => value + 1)} />}
      {employeeChangeReviewOpen && auth.token && auth.user?.role === 'ADMIN' && !auth.isViewingAs && <EmployeeChangeReviewModal token={auth.token} onClose={() => setEmployeeChangeReviewOpen(false)} onChanged={() => setEmployeeRefresh((value) => value + 1)} />}
      {auth.isViewingAs && <div className="view-as-banner" role="status"><span>🐞 กำลังดูระบบในมุมมอง <strong>{auth.user?.displayName}</strong> ({auth.user?.role}) · อ่านอย่างเดียว</span><button onClick={() => { auth.endViewAs(); setActivePage('users'); }}>กลับสู่บัญชี Admin</button></div>}
      {mobileMenuOpen && <button className="sidebar-overlay" aria-label="ปิดเมนูหลัก" aria-controls="app-navigation-drawer" onClick={() => setMobileMenuOpen(false)} />}
      <aside id="app-navigation-drawer" className={`sidebar ${mobileMenuOpen ? 'open' : ''}`} aria-label="เมนูหลัก">
        <div className="sidebar-brand">
          <Logo />
          <div><strong>SMS</strong><span>Security Management System</span></div>
          <button type="button" className="sidebar-close-button" aria-label="ปิดเมนูหลัก" onClick={() => setMobileMenuOpen(false)}><SmsIcon name="close" size={20} /></button>
        </div>
        <nav className="nav-menu" aria-label="เมนูหลัก">{visibleNavigation.map((section) => (
          <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map((item) => <button type="button" key={item.id} className={`nav-item ${navigationPage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setMobileMenuOpen(false); }}><span className="nav-icon"><SmsIcon name={item.icon} size={19} /></span><span>{item.label}{item.id === 'leavePending' && pendingLeaveCount > 0 && <b className="nav-count-badge">{pendingLeaveCount}</b>}</span></button>)}</div>
        ))}</nav>
        <div className="sidebar-footer">
          <div className="sidebar-user sidebar-profile"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'VIEWER'}</small></span></div>
          <button type="button" className="sidebar-logout" onClick={() => auth.logout()}><SmsIcon name="logout" size={18} /><span>ออกจากระบบ</span></button>
        </div>
      </aside>
      <main className="main-area">
        {pwaShell && <header className="pwa-mobile-header"><span className="pwa-mobile-brand"><Logo /><span><strong>SMS</strong><small>{pageTitle}</small></span></span><span className={`pwa-online-state ${pwaOnline ? '' : 'offline'}`}>{pwaOnline ? 'ออนไลน์' : 'ออฟไลน์'}</span></header>}
        {pwaShell && !pwaOnline && <div className="pwa-offline-banner">ออฟไลน์ — เปิดดู shell ได้ แต่การลงเวลาและการส่งคำขอลาต้องรอการเชื่อมต่อ Server</div>}
        <header className="topbar">
          <div className="topbar-left">
            <button ref={mobileMenuTriggerRef} type="button" className="mobile-menu-button" aria-label="เปิดเมนูหลัก" aria-expanded={mobileMenuOpen} aria-controls="app-navigation-drawer" onClick={() => setMobileMenuOpen(true)}><SmsIcon name="menu" size={20} /></button>
            <span className="mobile-brand"><Logo /><span><b>SMS</b><small>{pageTitle}</small></span></span>
            <span className="topbar-copy"><strong>{pageTitle}</strong><small>{pageSubtitle[navigationPage]}</small></span>
          </div>
          <label className="topbar-search"><span aria-hidden="true"><SmsIcon name="search" size={17} /></span><input aria-label="ค้นหาพนักงาน" placeholder="ค้นหาพนักงาน..." value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && activePage !== 'employees') setActivePage('employees'); }} /></label>
          <div className="topbar-actions">
            <span className="environment-pill">{import.meta.env.PROD ? 'DEPLOYED' : 'LOCAL'}</span>
            <ThemeControl compact />
            <button type="button" className="topbar-profile topbar-profile-button" title="การเข้าสู่ระบบและ Passkey" onClick={() => setPasskeyPanelOpen(true)}><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'VIEWER'}</small></span></button>
            <button ref={mobileUtilityTriggerRef} type="button" className="mobile-utility-button" aria-label="เปิดเมนูบัญชีและธีม" aria-expanded={mobileUtilityOpen} aria-controls="mobile-utility-panel" onClick={() => setMobileUtilityOpen((value) => !value)}><SmsIcon name="more" size={20} /></button>
          </div>
          {mobileUtilityOpen && createPortal(<>
            <button type="button" className="mobile-utility-backdrop" aria-label="ปิดเมนูบัญชีและธีม" onClick={() => setMobileUtilityOpen(false)} />
            <div id="mobile-utility-panel" className="mobile-utility-panel" role="dialog" aria-modal="true" aria-label="บัญชีและการตั้งค่าหน้าจอ">
              <div className="mobile-utility-profile"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'VIEWER'}</small></span></div>
              <label className="mobile-utility-search"><span aria-hidden="true"><SmsIcon name="search" size={17} /></span><input aria-label="ค้นหาพนักงานบนมือถือ" placeholder="ค้นหาพนักงาน..." value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && activePage !== 'employees') setActivePage('employees'); }} /></label>
              <div className="mobile-utility-theme"><span>Theme</span><ThemeControl /></div>
              <button type="button" className="mobile-utility-security" onClick={() => { setMobileUtilityOpen(false); setPasskeyPanelOpen(true); }}><SmsIcon name="key" size={18} />การเข้าสู่ระบบและ Passkey</button>
              <button type="button" className="mobile-utility-logout" onClick={() => auth.logout()}><SmsIcon name="logout" size={18} />ออกจากระบบ</button>
            </div>
          </>, document.body)}
        </header>
        <div className="content-area">{content()}</div>
        {pwaShell && <nav className="pwa-bottom-nav" aria-label="เมนู PWA">
          <button type="button" className={activePage === 'attendance' ? 'active' : ''} onClick={() => selectPwaPage('attendance')}><SmsIcon name="clock" size={20} /><span>ลงเวลา</span></button>
          <button type="button" className={activePage === 'leave' ? 'active' : ''} onClick={() => selectPwaPage('leave')}><SmsIcon name="leave" size={20} /><span>ลา</span></button>
          <button type="button" className={activePage === 'profile' ? 'active' : ''} onClick={() => selectPwaPage('profile')}><SmsIcon name="users" size={20} /><span>โปรไฟล์</span></button>
        </nav>}
      </main>
    </div>
    {passkeyPanelOpen && auth.token && <PasskeySecurityPanel token={auth.token} onClose={() => setPasskeyPanelOpen(false)} />}
    {printData && (
      <div className="print-only">
        {printData.printDepartments.length === 0 && (
          <div className="print-page print-empty-page">
            <div className="print-header">
              Security Management System - ตารางกะที่อนุมัติแล้ว - {printData.printMonthLabel}
            </div>
            <div className="print-empty-state">
              <strong>ไม่พบข้อมูลตารางกะสำหรับเดือนนี้</strong>
              <span>กรุณาตรวจสอบเดือนหรือแผนกที่เลือกก่อนส่งออก PDF</span>
            </div>
          </div>
        )}
        {printData.printDepartments.map((dept) => {
          const deptEmployees = printData.calendarEmployees.filter((e) => String(e.department || '') === dept);
          return (
            <div className="print-page" key={dept}>
              <div className="print-header">
                Security Management System - ตารางกะที่อนุมัติแล้ว - {printData.printMonthLabel}
              </div>
              <div className="print-metadata">
                <div className="print-metadata-left">
                  <span>แผนก: <strong>{dept || 'ทั่วไป'}</strong></span>
                  <span style={{ marginLeft: '12px' }}>Revision: <strong>{text(printData.approval.revision || 1)}</strong></span>
                  <span style={{ marginLeft: '12px' }}>อนุมัติโดย: <strong>{text(printData.approval.approvedBy || printData.approval.approvedByDisplayName || 'Admin')}</strong></span>
                  <span style={{ marginLeft: '12px' }}>วันที่อนุมัติ: <strong>{printData.approval.approvedAt ? formatApprovalDateTime(printData.approval.approvedAt) : '-'}</strong></span>
                </div>
                <div className="print-metadata-right">
                  <span>Export โดย: <strong>{auth.user?.email || 'Admin'}</strong></span>
                  <span style={{ marginLeft: '12px' }}>วันที่ Export: <strong>{formatApprovalDateTime(new Date())}</strong></span>
                </div>
              </div>
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>ลำดับ</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>ตำแหน่ง</th>
                    {printData.dates.map((day) => {
                      const dayValue = new Date(`${day}T00:00:00Z`);
                      const dayOfWeek = dayValue.getUTCDay();
                      let thClass = '';
                      if (dayOfWeek === 6) thClass = 'weekend sat';
                      else if (dayOfWeek === 0) thClass = 'weekend sun';
                      return (
                        <th key={day} className={thClass}>
                          <b>{dayValue.getUTCDate()}</b>
                          <small>{new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(dayValue).replace(/\./g, '')}</small>
                        </th>
                      );
                    })}
                    <th>ชม.รวมเดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {deptEmployees.map((employee, idx) => {
                    const employeeShifts = Array.isArray(employee.shifts) ? (employee.shifts as DataRow[]) : [];
                    let totalHours = 0;
                    return (
                      <tr key={String(employee.id)}>
                        <td>{idx + 1}</td>
                        <td className="emp-name-col">
                          {text(employee.displayName || `${text(employee.firstName)} ${text(employee.lastName)}`)}
                        </td>
                        <td className="emp-role-col">{text(employee.jobTitle || 'Security Guard')}</td>
                        {printData.dates.map((day) => {
                          const shift = employeeShifts.find((item) => inputDate(item.workDate) === day);
                          const shiftType = nested(shift?.shiftType);
                          const shiftTypeCode = shift ? String(shiftType.code || '').toUpperCase() : 'OFF';
                          const dayValue = new Date(`${day}T00:00:00Z`);
                          const dayOfWeek = dayValue.getUTCDay();
                          const hours = shift ? Number(shift.hours || 0) : 0;
                          totalHours += hours;

                          let cellClass = `shift-cell-${shiftTypeCode.toLowerCase()}`;
                          if (dayOfWeek === 6) cellClass += ' sat';
                          if (dayOfWeek === 0) cellClass += ' sun';

                          return (
                            <td key={day} className={cellClass}>
                              {shiftTypeCode}
                            </td>
                          );
                        })}
                        <td style={{ fontWeight: 'bold' }}>{totalHours.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="print-legend">
                  <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '10px', color: '#1e293b' }}>คำอธิบายรหัสกะ</div>
                  <table className="print-legend-table">
                    <tbody>
                      {shiftTypes.map((t) => {
                        const codeStr = text(t.code).toUpperCase();
                        const badgeClass = `print-legend-badge badge-${codeStr.toLowerCase()}`;
                        return (
                          <tr key={String(t.id)}>
                            <td style={{ width: '40px', textAlign: 'center' }}>
                              <span className={badgeClass} style={['D', 'N', 'OFF', 'AL'].includes(codeStr) ? undefined : { backgroundColor: String(t.color || '#cbd5e1'), color: '#fff' }}>
                                {codeStr}
                              </span>
                            </td>
                            <td style={{ fontWeight: 'bold' }}>{text(t.name)}</td>
                            <td>{codeStr === 'OFF' ? '-' : `${text(t.startTime)} - ${text(t.endTime)}`}</td>
                            <td>{Number(t.hours || 0)} ชม.</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </div>
              <div className="print-footer-container">
                <div className="print-signatures">
                  <div className="signature-box">
                    <div>ลงชื่อ....................................................................................</div>
                    <div style={{ marginTop: '4px' }}>(....................................................................................)</div>
                    <div className="signature-title">พนักงานผู้จัดพิมพ์รายงาน / หัวหน้าพนักงานรักษาความปลอดภัย</div>
                  </div>
                  <div className="signature-box">
                    <div>ทราบ / ลงชื่อ..........................................................................</div>
                    <div style={{ marginTop: '4px' }}>(....................................................................................)</div>
                    <div className="signature-title">ผู้จัดการเขต (ผู้อนุมัติ)</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}
    {leavePrintTarget && <LeavePrintDocument row={leavePrintTarget} />}
    </>
  );
}

function App() {
  const auth = useContext(AuthContext)!;
  if (auth.loading) return <div className="full-loader">กำลังเตรียมระบบ…</div>;
  return auth.token ? <Dashboard /> : <Login />;
}

registerSmsPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
