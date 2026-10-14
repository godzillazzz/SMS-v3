Warning: truncated output (original token count: 87405)
Total output lines: 3623

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '@fontsource/kanit/thai-400.css';
import '@fontsource/kanit/thai-500.css';
import '@fontsource/kanit/thai-600.css';
import '@fontsource/kanit/thai-700.css';
import '@fontsource/kanit/thai-800.css';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
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
import { api, refreshAuth, setTokenRefreshHandler } from './api';
import { isRefreshUnauthenticated, refreshWithRetry } from './auth-startup-recovery';
import { canDecideScheduleApproval, isSupersededScheduleApproval, scheduleApprovalChangeTypeLabel, scheduleApprovalErrorMessage, scheduleApprovalStatusLabel, scheduleApprovalTone } from './approval-display';
import { getEmployeeLeaveQuota } from './leave-request-quota-api';
import type { ScheduleBatchProgress } from './api';
import { isG06DeviceContextDiagnosticRequested, shouldOpenG06DeviceContextDiagnostic } from './lib/g06-device-context-diagnostic-route';
import { readEncryptedBootstrap } from './pages/attendance-simple/attendance-simple-storage';
import type { SimpleBootstrap } from './pages/attendance-simple/attendance-simple-client';
import { ROLE_DISPLAY_LABEL, roleDisplayName } from './role-display';
import { getApprovalCenterSummary } from './approval-center-client';
import { shouldPollApprovalCenter } from './approval-center-polling';
import { approvalBadgeText, approvalMenuCount, type ApprovalCountSummary } from './components/approval-count-badge';
import { ApprovalCenterNotificationButton } from './components/ApprovalCenterNotificationButton';
import type { EmployeeComboboxOption } from './components/SearchableEmployeeCombobox';
import { getLeavePolicy } from './leave-policy-client';
import { createLeaveType, getLeaveTypes, updateLeaveType, type LeaveTypeMaster } from './leave-type-client';
import { getShiftTypes } from './shift-type-client';
import { describePattern, getAutoSchedulePatterns, type AutoSchedulePattern } from './auto-schedule-pattern-client';
import { setAttendanceTokenRefreshGuard, setAttendanceTokenRefreshHandler } from './attendance-auth-request';
import { RequestErrorContent, formatRequestErrorMessage, toRequestErrorState, type RequestErrorInput } from './request-error';
import { checkExistingLeaveDates } from './leave-date-overlap-client';
import { acquireDocumentScrollLock } from './document-scroll-lock';
import { buildLeaveQuotaProvisioningPayload, canProvisionLeaveQuota, currentBangkokQuotaYear, hasUnmatchedLegacyQuota, leaveQuotaDefaultsFromPolicy, quotaProvisioningEmployeeOptions, thaiQuotaYearLabel } from './leave-quota-provisioning';
import { printDocument, printScheduleDocument, printTableReport } from './schedule-print';
import { groupScheduleEmployeesByDepartment, sortScheduleEmployeesByDepartment } from './schedule-employee-code-order';
import { addAutoSchedulePreviewDrafts, summarizeAutoSchedulePreview } from './auto-schedule-drafts';
import { responseForCurrentQuery, type PageResponseBinding } from './operation-response';
import { bangkokDateInput as formatBangkokDateInput, currentBangkokMonth, formatThaiDate, formatThaiDateTime, formatThaiMonth, formatThaiMonthName } from './thai-date-time';

import { MonthGridPicker, normalizeMonthValue, parseMonthValue, shiftMonthValue } from './components/MonthGridPicker';
import { PageHeader, SectionCard, StepFlow, MetricCard } from './components/layout';
import { BrandLogo } from './components/BrandLogo';
import { AppLoader, loadingMessages } from './components/AppLoader';
import './styles.css';
import './design-system.css';
import './styles/dashboard.css';
import { DashboardPage } from './pages/dashboard/DashboardPage';


import { WorkflowCommandPalette } from './components/WorkflowCommandPalette';
import { defaultAuditFilters, type AuditFilters } from './components/audit/audit-types';
import type { DataQualityFilters, DataQualityIssue } from './pages/data-quality/DataQualityCenterPage';
import type { G06UatProvisionResult } from './pages/access-management/G06UatProvisioningPanel';
import { initialSmsPwaPage, isSmsPwaPage, isSmsPwaShellMode, type SmsPwaPage } from './pwa-mode';
import { registerSmsPwa } from './pwa';
import { canLoadAccessManagement } from './components/access-management/access-management-utils';
import type { DashboardFilters } from './components/dashboard/types';

import { DataTablePagination, ResponsiveDataTable } from './components/ResponsiveDataTable';
import { DataTableSkeletonCards, DataTableSkeletonRows, DataTableState } from './components/ResponsiveDataTable';
import type { OperationalDrawerAction } from './components/OperationalRecordDrawer';
import { SmsIcon, type SmsIconName } from './components/SmsIcon';
import { useActionDialog } from './components/useActionDialog';
import { ThemeControl } from './components/ThemeControl';
import { attendancePolicyKeys, type AttendancePolicyForm } from './components/attendance-policy-contract';
import { leavePolicyKeys, type LeavePolicyForm } from './components/leave-policy-contract';
import type { LeaveDecisionAction, LeaveDecisionTarget } from './components/LeaveDecisionConfirmation';
import { registrationResultPresentation } from './components/auth-experience';
import { sanitizeLicenseDocumentError, type LicenseDocument } from './components/license-document-utils';
import { canViewRoutePage, navigate, navigateSettingsSection, pageFromLocation, routeQueryMonth, routeQueryNumber, ROUTE_CHANGE_EVENT, settingsSectionFromPath, subscribeToRouteChanges, updateDocumentTitle, updateRouteQuery, type RoutePage, type RouteResolution, type SettingsSectionId } from './routing';
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
import './styles/responsive-certification-v1.css';
import './styles/system-health.css';
import './styles/configuration-center.css';
import './styles/ux-ui-remediation.css';
import './styles/ux-ui-quality-10.css';
import './styles/award-landing.css';
import './styles/tailwind.css';
import './styles/command-nexus.css';
import './styles/award-interior.css';
import './styles/operational-layer.css';
import './styles/employee-pwa-theme.css';
import './styles/ux-t06-login-public.css';
import './styles/schedule-roster-ux.css';
import './styles/layout-foundation.css';
import './styles/personnel-layout.css';
import './styles/system-layout-group4.css';

const DashboardDetailsPage = React.lazy(() => import('./pages/dashboard/DashboardDetailsPage').then((module) => ({ default: module.DashboardDetailsPage })));
const LicenseTableDocumentColumns = React.lazy(() => import('./components/LicenseDocuments').then((module) => ({ default: module.LicenseTableDocumentColumns })));
const LicenseEditModal = React.lazy(() => import('./components/LicenseDocuments').then((module) => ({ default: module.LicenseEditModal })));


const APPROVAL_REVIEWER_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR'] as const;
const APPROVAL_COUNT_MENU_ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  approvalCenter: APPROVAL_REVIEWER_ROLES,
  employees: ['ADMIN'],
  licenses: ['ADMIN'],
  approvals: ['ADMIN', 'SUPERVISOR'],
  attendanceDevice: ['ADMIN'],
  attendanceSupervisor: ['ADMIN'],
  users: APPROVAL_REVIEWER_ROLES,
  leavePending: APPROVAL_REVIEWER_ROLES
});

const AwardPublicExperience = React.lazy(() => import('./components/AwardPublicExperience').then((module) => ({ default: module.AwardPublicExperience })));
const ReportCenterPage = React.lazy(() => import('./pages/reports/ReportCenterPage').then((module) => ({ default: module.ReportCenterPage })));
const SettingsPage = React.lazy(() => import('./pages/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const PersonnelDirectoryPage = React.lazy(() => import('./pages/personnel/PersonnelDirectoryPage').then((module) => ({ default: module.PersonnelDirectoryPage })));
const EmployeeGovernedEditModal = React.lazy(() => import('./components/personnel/EmployeeGovernedEditModal').then((module) => ({ default: module.EmployeeGovernedEditModal })));
const EmployeeChangeReviewModal = React.lazy(() => import('./components/personnel/EmployeeChangeReviewModal').then((module) => ({ default: module.EmployeeChangeReviewModal })));
const ApprovalCenterPage = React.lazy(() => import('./pages/approvals/ApprovalCenterPage').then((module) => ({ default: module.ApprovalCenterPage })));
const AuditCompliancePage = React.lazy(() => import('./pages/audit/AuditCompliancePage').then((module) => ({ default: module.AuditCompliancePage })));
const DataQualityCenterPage = React.lazy(() => import('./pages/data-quality/DataQualityCenterPage').then((module) => ({ default: module.DataQualityCenterPage })));
const SystemHealthPage = React.lazy(() => import('./pages/system-health/SystemHealthPage').then((module) => ({ default: module.SystemHealthPage })));
const AccessManagementPage = React.lazy(() => import('./pages/access-management/AccessManagementPage').then((module) => ({ default: module.AccessManagementPage })));
const AttendanceDevicePage = React.lazy(() => import('./pages/attendance-device/AttendanceDevicePage').then((module) => ({ default: module.AttendanceDevicePage })));
const SecuritySiteManagementPanel = React.lazy(() => import('./components/SecuritySiteManagementPanel').then((module) => ({ default: module.SecuritySiteManagementPanel })));
const PwaProfilePage = React.lazy(() => import('./pages/pwa-profile/PwaProfilePage').then((module) => ({ default: module.PwaProfilePage })));
const AttendanceHistoryPwaPage = React.lazy(() => import('./pages/pwa-attendance/AttendanceHistoryPwaPage').then((module) => ({ default: module.AttendanceHistoryPwaPage })));
const AttendanceSchedulePwaPage = React.lazy(() => import('./pages/pwa-attendance/AttendanceSchedulePwaPage').then((module) => ({ default: module.AttendanceSchedulePwaPage })));
const AttendanceSimplePage = React.lazy(() => import('./pages/attendance-simple/AttendanceSimplePage').then((module) => ({ default: module.AttendanceSimplePage })));
const AttendanceSupervisorPage = React.lazy(() => import('./pages/attendance-supervisor/AttendanceSupervisorPage').then((module) => ({ default: module.AttendanceSupervisorPage })));
const RegistrationReviewPanel = React.lazy(() => import('./pages/access-management/RegistrationReviewPanel').then((module) => ({ default: module.RegistrationReviewPanel })));
const PasskeySecurityPanel = React.lazy(() => import('./components/PasskeySecurityPanel').then((module) => ({ default: module.PasskeySecurityPanel })));
const RuleCheckingDataSurfaces = React.lazy(() => import('./components/RuleCheckingDataSurfaces').then((module) => ({ default: module.RuleCheckingDataSurfaces })));
const OperationalRecordDrawer = React.lazy(() => import('./components/OperationalRecordDrawer').then((module) => ({ default: module.OperationalRecordDrawer })));
const DataRowActionMenu = React.lazy(() => import('./components/DataRowActionMenu').then((module) => ({ default: module.DataRowActionMenu })));
const TableActionCell = React.lazy(() => import('./components/TableActionColumn').then((module) => ({ default: module.TableActionCell })));
const TableActionHeader = React.lazy(() => import('./components/TableActionColumn').then((module) => ({ default: module.TableActionHeader })));
const LeaveDecisionConfirmation = React.lazy(() => import('./components/LeaveDecisionConfirmation').then((module) => ({ default: module.LeaveDecisionConfirmation })));
const SearchableEmployeeCombobox = React.lazy(() => import('./components/SearchableEmployeeCombobox').then((module) => ({ default: module.SearchableEmployeeCombobox })));

type User = { id: string; email: string; displayName: string; role: string; department?: string };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; displayName?: string; email?: string | null; phone?: string | null; department?: string; jobTitle?: string; hiredAt?: string | null; skill?: string | null; isActive: boolean; updatedAt?: string };
type Page = RoutePage;
type Auth = { token?: string; user?: User; originalUser?: User; loading: boolean; error?: string; refreshState: 'checking' | 'ready' | 'unauthenticated' | 'unavailable'; isViewingAs: boolean; login(email: string, password: string): Promise<void>; passkeyLogin(): Promise<void>; logout(): Promise<void>; retryRefresh(): Promise<void>; beginViewAs(userId: string): Promise<void>; endViewAs(): void };
type DataRow = Record<string, unknown>;
type DataResponse = { data?: DataRow[] | DataRow; summary?: { total?: number; critical?: number; warning?: number; info?: number }; meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number; statusCounts?: Record<string, number>; unmatchedLegacyCount?: number } };
type OperationRequestState = { page: Page; key: string; loading: boolean; error?: RequestErrorInput };
type LicenseEmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';
type FormField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'date' | 'number' | 'select' | 'textarea' | 'file'; required?: boolean; accept?: string; hint?: string; min?: number; max?: number; options?: Array<{ value: string; label: string }> };
type Editor = { title: string; submitLabel: string; fields: FormField[]; values: Record<string, string>; notice?: string; experience?: 'personnel'; submit(values: Record<string, string>, files: Record<string, File>): Promise<void> };
type LeaveDecisionRequest = { row: DataRow; action: LeaveDecisionAction; target: LeaveDecisionTarget };

const bangkokDateInput = (value = new Date()) => formatBangkokDateInput(value);

const AuthContext = createContext<Auth | undefined>(undefined);

const navigation: Array<{ label: string; items: Array<{ id: Page; icon: SmsIconName; label: string }> }> = [
  { label: 'ภาพรวม', items: [{ id: 'dashboard', icon: 'dashboard', label: 'ภาพรวม' }] },
  { label: 'พนักงาน', items: [
    { id: 'employees', icon: 'employees', label: 'ข้อมูลพนักงาน' },
    { id: 'licenses', icon: 'license', label: 'ใบอนุญาต รปภ.' },
    { id: 'attendance', icon: 'attendance', label: 'ลงเวลา' },
    { id: 'attendanceSupervisor', icon: 'dashboard', label: 'ลงเวลาแทนพนักงาน' },
    { id: 'attendanceDevice', icon: 'key', label: 'อุปกรณ์ลงเวลา' }
  ] },
  { label: 'ตารางกะ', items: [
    { id: 'schedule', icon: 'calendar', label: 'ตารางกะรายเดือน' },
    { id: 'approvals', icon: 'approval', label: 'อนุมัติตารางกะ' },
    { id: 'shiftSetup', icon: 'clock', label: 'รหัสกะและเวลา' }
  ] },
  { label: 'การลา', items: [
    { id: 'leave', icon: 'leave', label: 'คำขอลา' },
    { id: 'leavePending', icon: 'approval', label: 'อนุมัติคำขอลา' },
    { id: 'leaveHistory', icon: 'history', label: 'ประวัติการลาทั้งหมด' },
    { id: 'quota', icon: 'quota', label: 'โควต้าวันลา' }
  ] },
  { label: 'ตรวจสอบ', items: [
    { id: 'approvalCenter', icon: 'bell', label: 'ศูนย์อนุมัติ' },
    { id: 'rules', icon: 'shield', label: 'กฎการทำงาน' },
    { id: 'audit', icon: 'audit', label: 'บันทึกการใช้งานระบบ' },
    { id: 'dataQuality', icon: 'quality', label: 'คุณภาพข้อมูล' },
    { id: 'systemHealth', icon: 'dashboard', label: 'ประสิทธิภาพและสถานะระบบ' }
  ] },
  { label: 'ผู้ใช้และสิทธิ์', items: [{ id: 'users', icon: 'users', label: 'ผู้ใช้และสิทธิ์' }] },
  { label: 'รายงาน', items: [{ id: 'reportCenter', icon: 'report', label: 'รายงานและวิเคราะห์' }] },
  { label: 'ตั้งค่า', items: [
    { id: 'securitySite', icon: 'location', label: 'จุดรักษาความปลอดภัยและ QR' },
    { id: 'settings', icon: 'settings', label: 'ตั้งค่าระบบ' }
  ] }
];

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<User>();
  const [viewAs, setViewAs] = useState<{ token: string; user: User }>();
  const primaryTokenRef = useRef<string>();
  const viewAsTokenRef = useRef<string>();
  primaryTokenRef.current = token;
  viewAsTokenRef.current = viewAs?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshState, setRefreshState] = useState<Auth['refreshState']>('checking');

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await refreshWithRetry(refreshAuth);
      setToken(result.accessToken);
      setUser(result.user);
      setViewAs(undefined);
      setRefreshState('ready');
    } catch (reason) {
      if (isRefreshUnauthenticated(reason)) {
        setToken(undefined);
        setUser(undefined);
        setViewAs(undefined);
        setRefreshState('unauthenticated');
      } else {
        setRefreshState('unavailable');
      }
      throw reason;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const applyRefreshedToken = (newToken: string, newUser: any) => {
      setToken(newToken);
      if (newUser) setUser(newUser);
      if (viewAsTokenRef.current) throw new Error('Session context changed. Retry from the primary account.');
    };
    setTokenRefreshHandler(applyRefreshedToken);
    setAttendanceTokenRefreshHandler(applyRefreshedToken);
    setAttendanceTokenRefreshGuard((requestToken) => {
      if (viewAsTokenRef.current && requestToken === viewAsTokenRef.current) return false;
      return Boolean(primaryTokenRef.current && requestToken === primaryTokenRef.current);
    });
    refresh().catch(() => undefined);
    const refreshWhenOnline = () => {
      if (!primaryTokenRef.current) void refresh().catch(() => undefined);
    };
    window.addEventListener('online', refreshWhenOnline);
    return () => {
      window.removeEventListener('online', refreshWhenOnline);
      setTokenRefreshHandler(null);
      setAttendanceTokenRefreshHandler(null);
      setAttendanceTokenRefreshGuard(null);
    };
  }, []);

  const login = async (email: string, password: string) => {
    setError(undefined);
    try {
      const result = await api.login(email, password);
      setToken(result.accessToken);
      setUser(result.user);
      setViewAs(undefined);
      setRefreshState('ready');
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'ไม่สามารถเข้าสู่ระบบได้'));
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
      setRefreshState('ready');
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้'));
      throw reason;
    }
  };

  const logout = async () => {
    await api.logout();
    setToken(undefined);
    setUser(undefined);
    setViewAs(undefined);
    setRefreshState('unauthenticated');
  };

  const beginViewAs = async (userId: string) => {
    if (!token || user?.role !== 'ADMIN') throw new Error('View As requires an Admin account.');
    const result = await api.viewAsUser(token, userId);
    setViewAs({ token: result.data.accessToken, user: result.data.user });
  };

  const endViewAs = () => setViewAs(undefined);

  return <AuthContext.Provider value={{ token: viewAs?.token || token, user: viewAs?.user || user, originalUser: user, loading, error, refreshState, isViewingAs: Boolean(viewAs), login, passkeyLogin, logout, retryRefresh: refresh, beginViewAs, endViewAs }}>{children}</AuthContext.Provider>;
}


function readLeaveMonthFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const routeMonth = routeQueryMonth(window.location.search);
  if (routeMonth) return routeMonth;
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
  const [authMethod, setAuthMethod] = useState<'password' | 'passkey' | 'hardware'>('password');

  useEffect(() => {
    api.passkeyConfig().then((result) => setPasskeyEnabled(Boolean(result?.enabled) && browserSupportsWebAuthn())).catch(() => setPasskeyEnabled(false));
  }, []);

  useEffect(() => {
    if (mode !== 'registerVerify' || resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [mode, resendSeconds]);

  const resetView = (next: typeof mode) => { setMode(next); setAuthMethod('password'); setFormError(undefined); setFormMessage(undefined); setCode(''); setRegistrationState(undefined); if (next !== 'registerVerify') setResendSeconds(0); };
  const signInWithPasskey = async (method: 'passkey' | 'hardware' = 'passkey') => {
    setFormError(undefined); setFormMessage(undefined); setBusy(true);
    try { await auth.passkeyLogin(); }
    catch (reason) { setFormError(formatRequestErrorMessage(reason, method === 'hardware' ? 'ไม่สามารถเข้าสู่ระบบด้วย Hardware Key ได้' : 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้')); }
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
    return formatRequestErrorMessage(reason, 'ไม่สามารถดำเนินการได้');
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
      setFormError((mode === 'register' || mode === 'registerVerify') ? registrationErrorMessage(reason) : formatRequestErrorMessage(reason, 'ไม่สามารถดำเนินการได้'));
    }
    finally { setBusy(false); }
  };

  const showAccountRecovery = registrationState === 'EXISTING_ACCOUNT' || registrationState === 'EMPLOYEE_ALREADY_HAS_ACCOUNT';
  const registrationStep = mode === 'registerVerify' ? 2 : 1;
  const resetStep = mode === 'resetVerify' ? 2 : 1;

  const authStage = (
    <section className="nexus-auth-stage" id="access">
      <a className="auth-skip-link" href="#auth-login-form">ข้ามไปแบบฟอร์มเข้าสู่ระบบ</a>
      {mode === 'login' && <div className="nexus-auth-heading"><span aria-hidden="true">ZERO-TRUST ENTERPRISE IDENTITY HUB</span><h2>ศูนย์ยืนยันตัวตน Command Console SMS</h2><p>เข้าถึงพื้นที่ปฏิบัติการรักษาความปลอดภัยด้วยการรับรองตัวตนหลายปัจจัยและ Enterprise Identity Policy</p></div>}
      <section className="login-shell auth-experience-shell nexus-auth-shell" aria-label="เข้าสู่ระบบ Security Management System">
        <aside className="login-intro auth-brand-panel nexus-auth-intro">
          <div className="intro-brand auth-brand"><BrandLogo tone="dark-surface" /></div>
          <div className="intro-copy auth-brand-copy">
            <p className="auth-brand-eyebrow" aria-hidden="true">MULTI-FACTOR SECURITY ENCLAVE</p>
            <h2>Zero-Trust Identity Hub<br />สำหรับ Command Console</h2>
            <p>FIDO2 / WebAuthn · Secure session · Access governed by account role and enterprise policy</p>
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
        <section className="login-form-panel auth-card-panel nexus-auth-panel">
          <div className="login-theme-control auth-theme-control"><ThemeControl compact /></div>
          <div className="auth-mobile-brand"><BrandLogo tone="dark-surface" /></div>
          <form id="auth-login-form" className="login-form auth-form" onSubmit={submit} aria-busy={busy}>
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
              <header className="auth-form-heading nexus-auth-card-header">
                {mode === 'login' ? <><span className="nexus-enclave-badge" aria-hidden="true"><i />ZERO-TRUST ENCLAVE</span><h2>เข้าสู่ระบบปฏิบัติการ</h2><p className="nexus-protocol-label" aria-hidden="true">SELECT VERIFICATION PROTOCOL</p></> : <><span className="auth-form-kicker">SMS</span><h2>{title}</h2><p className="form-lead">{lead}</p></>}
              </header>
              {(mode === 'register' || mode === 'registerVerify') && <AuthProgress flow="registration" current={registrationStep} />}
              {(mode === 'reset' || mode === 'resetVerify') && <AuthProgress flow="reset" current={resetStep} />}
              {(formError || (mode === 'login' ? auth.error : undefined)) && <div className="alert alert-error auth-alert" role="alert" aria-live="assertive"><SmsIcon name="shield" size={18} /><span>{formError || auth.error}</span></div>}
              {formMessage && <div className="login-help-action auth-notice" role="status" aria-live="polite"><SmsIcon name="approval" size={18} /><span>{formMessage}</span></div>}
              {mode === 'login' && <div className="nexus-auth-methods" role="tablist" aria-label="วิธีเข้าสู่ระบบ"><button type="button" role="tab" aria-selected={authMethod === 'password'} className={authMethod === 'password' ? 'is-active' : ''} onClick={() => setAuthMethod('password')}>อีเมล / รหัสผ่าน</button><button type="button" role="tab" aria-selected={authMethod === 'passkey'} className={authMethod === 'passkey' ? 'is-active' : ''} onClick={() => setAuthMethod('passkey')}>Passkey</button><button type="button" role="tab" aria-selected={authMethod === 'hardware'} className={authMethod === 'hardware' ? 'is-active' : ''} onClick={() => setAuthMethod('hardware')}>Hardware Key</button></div>}

              {mode === 'register' && <>
                <label className="field-group auth-field" htmlFor="registration-name"><span>ชื่อ-นามสกุล</span><input id="registration-name" value={submittedName} onChange={(event) => setSubmittedName(event.target.value)} type="text" minLength={2} maxLength={200} required autoComplete="name" /><small className="field-hint">ใช้สำหรับส่งคำขอให้ผู้ดูแลตรวจสอบ ข้อมูลนี้ไม่ใช่ข้อมูลยืนยันตัวบุคคลจากทะเบียนพนักงาน</small></label>
                <label className="field-group auth-field" htmlFor="registration-department"><span>หน่วยงาน / พื้นที่ <em>ถ้ามี</em></span><input id="registration-department" value={departmentHint} onChange={(event) => setDepartmentHint(event.target.value)} type="text" maxLength={100} /><small className="field-hint">ระบุหน่วยงานหรือพื้นที่เพื่อช่วยผู้ดูแลตรวจสอบ ข้อมูลนี้ไม่แก้ไขทะเบียนพนักงาน</small></label>
              </>}

              {mode === 'registerVerify' && <div className="auth-otp-intro"><span><SmsIcon name="shield" size={18} /></span><div><b>เราได้ส่งรหัส 6 หลักไปยัง</b><strong>{maskedEmail}</strong></div></div>}
              {mode === 'resetVerify' && <div className="auth-otp-intro"><span><SmsIcon name="shield" size={18} /></span><div><b>กรอกรหัสยืนยันที่ได้รับทางอีเมล</b><strong>{maskedEmail}</strong><small>OTP และรหัสผ่านใหม่จะถูกตรวจสอบพร้อมกันเมื่อกดยืนยัน</small></div></div>}

              {(mode !== 'login' || authMethod === 'password') && <label className="field-group auth-field" htmlFor="email"><span>{mode === 'login' ? 'อีเมลองค์กร' : 'อีเมล'}</span><input id="email" value={email} onChange={(event) => { event.currentTarget.setCustomValidity(''); setEmail(event.target.value); }} type="email" placeholder={mode === 'login' ? 'operator@sms.local' : 'name@company.com'} required onInvalid={(event) => { const input = event.currentTarget; input.setCustomValidity(input.validity.valueMissing ? 'กรุณากรอกอีเมลองค์กร' : 'กรุณากรอกอีเมลให้ถูกต้อง'); }} autoComplete={mode === 'login' ? 'username' : 'email'} disabled={mode === 'registerVerify'} /></label>}

              {(mode === 'registerVerify' || mode === 'resetVerify') && <label className="field-group auth-field auth-otp-field" htmlFor="otp-code"><span>รหัส OTP 6 หลัก</span><input id="otp-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" aria-describedby={mode === 'registerVerify' ? 'registration-otp-help' : undefined} placeholder="000000" /></label>}

              {(((mode === 'login' && authMethod === 'password') || mode === 'register' || mode === 'resetVerify')) && <label className="field-group auth-field" htmlFor="password"><span>{mode === 'resetVerify' ? 'รหัสผ่านใหม่' : mode === 'login' ? 'รหัสผ่านความปลอดภัย (Security Passphrase)' : 'รหัสผ่าน'}</span><span className="password-field auth-password-field"><input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder={mode === 'resetVerify' ? 'อย่างน้อย 8 ตัวอักษร' : undefined} minLength={mode === 'login' ? undefined : 8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button className="password-toggle auth-password-toggle" type="button" aria-label={showPassword ? 'ซ่อน' : 'แสดง'} aria-pressed={showPassword} onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword((visible) => !visible)}><SmsIcon name={showPassword ? 'eyeOff' : 'eye'} size={18} /><span>{showPassword ? 'ซ่อน' : 'แสดง'}</span></button></span></label>}

              {mode === 'login' && authMethod === 'password' && <div className="nexus-password-meta"><span aria-hidden="true">SECURE CREDENTIAL CHANNEL</span><button type="button" onClick={() => resetView('reset')}>ลืมรหัสผ่าน?</button></div>}
              {(mode !== 'login' || authMethod === 'password') && <button className="btn-primary auth-primary-action" type="submit" disabled={submitDisabled}>{busy ? 'กำลังดำเนินการ…' : mode === 'login' ? 'เข้าสู่ระบบปฏิบัติการ →' : mode === 'register' ? 'ส่งคำขอและรหัส OTP' : mode === 'registerVerify' ? 'ยืนยันอีเมล' : mode === 'reset' ? 'ส่งรหัส OTP' : 'ตั้งรหัสผ่านใหม่'}</button>}

              {mode === 'login' && authMethod === 'passkey' && <div className="nexus-webauthn-panel"><div className="nexus-auth-method-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 11c0 3.5-1 6.8-2.75 9.57M5.8 18.53l.06-.09A13.9 13.9 0 008 11a4 4 0 118 0c0 1.02-.07 2.02-.2 3M13.68 20.84A21.9 21.9 0 0015.17 17M19 18.13A20.7 20.7 0 0020 11.8 8 8 0 004 12m0 0c0 1.55.29 3.04.82 4.4M7.3 19.71A16 16 0 0012 21c2.25 0 4.36-.47 6.28-1.3"/></svg></div><h4>สแกนลายนิ้วมือหรือใบหน้า (Passkey)</h4><p>ใช้ Touch ID, Face ID, Windows Hello หรือ Passkey บนอุปกรณ์ของคุณ</p><small>FIDO2 / WEBAUTHN · PLATFORM AUTHENTICATOR</small>{!passkeyEnabled && <em>WebAuthn ยังไม่พร้อมใช้งานใน environment นี้</em>}<button type="button" disabled={busy || !passkeyEnabled} onClick={() => signInWithPasskey('passkey')}>เริ่มการยืนยันด้วย Passkey →</button></div>}
              {mode === 'login' && authMethod === 'hardware' && <div className="nexus-webauthn-panel"><div className="nexus-auth-method-icon is-hardware" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.74 5.74L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.59a1 1 0 01.29-.7l5.97-5.97A6 6 0 1121 9z"/></svg></div><h4>เสียบกุญแจฮาร์ดแวร์ความปลอดภัย</h4><p>เสียบ YubiKey หรือ USB Security Key แล้วแตะเซนเซอร์เพื่อยืนยันตัวตน</p><small>FIDO2 / WEBAUTHN · ROAMING SECURITY KEY</small>{!passkeyEnabled && <em>WebAuthn ยังไม่พร้อมใช้งานใน environment นี้</em>}<button type="button" disabled={busy || !passkeyEnabled} onClick={() => signInWithPasskey('hardware')}>ตรวจหากุญแจฮาร์ดแวร์ (Scan USB) →</button></div>}

              {mode === 'registerVerify' && <div className="auth-resend" id="registration-otp-help"><p>หากยังไม่พบอีเมล กรุณาตรวจสอบ Spam/Junk</p><button type="button" disabled={busy || resendSeconds > 0} onClick={resendRegistrationCode}>{resendSeconds > 0 ? `ส่งรหัสอีกครั้งใน ${resendSeconds} วินาที` : 'ส่งรหัสอีกครั้ง'}</button></div>}

              {mode === 'login' && <div className="nexus-auth-security-footer" aria-hidden="true"><span><i className="is-ready" />ENCLAVE READY</span><b>•</b><span><i />SESSION SECURE</span><b>•</b><span><i className={passkeyEnabled ? 'is-ready' : ''} />FIDO2 / WEBAUTHN</span></div>}
              {mode === 'login' ? <div className="login-links auth-links">{!showAccountRecovery && <button type="button" onClick={() => resetView('register')}>ส่งคำขอลงทะเบียน</button>}</div> : <div className="login-links auth-links auth-links--back"><button type="button" onClick={() => resetView('login')}>กลับหน้าเข้าสู่ระบบ</button></div>}
              <p className="login-help auth-support-note">พบปัญหาการใช้งาน กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน</p>
            </>}
          </form>
        </section>
      </section>
    </section>
  );

  const focusLoginEmail = () => {
    const emailField = document.querySelector<HTMLInputElement>('#email');
    if (!emailField) return;
    emailField.focus();
  };

  return (
    <main className="login-page auth-experience-page award-auth-page">
      <React.Suspense fallback={mode === 'login' ? authStage : null}>
        <AwardPublicExperience
          showLanding={mode === 'login'}
          renderLogo={() => <BrandLogo tone="dark-surface" />}
          accessContent={mode === 'login' ? authStage : undefined}
          onRequestAccess={focusLoginEmail}
        />
      </React.Suspense>
      {mode !== 'login' && authStage}

      <footer className="award-public-footer"><span lang="th">SMS · ระบบบริหารงานรักษาความปลอดภัย</span><small lang="en">Secure operations, designed for clarity.</small></footer>
    </main>
  );
}
const text = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);
const leaveTypeDisplayText = (row: DataRow) => {
  const snapshot = String(row.leaveTypeNameSnapshot || '').trim();
  if (snapshot) return snapshot;
  const code = String(row.leaveType || '').trim().toUpperCase();
  if (code === 'SICK') return 'ลาป่วย';
  if (code === 'PERSONAL') return 'ลากิจ';
  if (code === 'VACATION') return 'ลาพักร้อน';
  return String(row.leaveType || '-');
};

const semanticStatusTone = (value: unknown) => {
  const status = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const scheduleTone = scheduleApprovalTone(value);
  if (scheduleTone) return scheduleTone;
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
  return formatThaiDate(d);
};
const formatApprovalDateTime = (value: unknown) => {
  if (!value) return '-';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return formatThaiDateTime(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
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
function leaveCsvRows(rows: DataRow[]) {
  return rows.map((row) => ({
    พนักงาน: text(row.employeeNameSnapshot),
    ประเภทการลา: leaveTypeDisplayText(row),
    วันที่เริ่ม: date(row.startDate),
    วันที่สิ้นสุด: date(row.endDate),
    จำนวนวัน: text(row.dayCount),
    สถานะ: text(row.status)
  }));
}

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
  const [patterns, setPatterns] = useState<AutoSchedulePattern[]>([]);
  const [patternType, setPatternType] = useState('');
  const [patternLoadError, setPatternLoadError] = useState<string>();
  const [autoContinue, setAutoContinue] = useState(false);
  const [startPhase, setStartPhase] = useState('');
  const [analysisText, setAnalysisText] = useState('กำลังอ่านแพทเทิร์นและประวัติกะ…');
  const [suggestedCode, setSuggestedCode] = useState('');
  const modalRoot = useShiftEditorModalRoot();
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(!busy);
  onCloseRef.current = onClose;
  canCloseRef.current = !busy;

  const selectedPattern = patterns.find((pattern) => pattern.code === patternType);
  const selectedPhaseOptions = selectedPattern?.mode === 'CYCLE' ? selectedPattern.steps : [];

  useEffect(() => {
    if (!token) return;
    let active = true;
    setPatternLoadError(undefined);
    getAutoSchedulePatterns(token)
      .then((result) => {
        if (!active) return;
        const rows = (Array.isArray(result?.data) ? result.data : []) as AutoSchedulePattern[];
        const usable = rows.filter((pattern) => pattern.isActive !== false);
        setPatterns(usable);
        const targetGroup = isSupervisorTarget ? 'SUPERVISOR' : 'GENERAL';
        const preferred = usable.find((pattern) => pattern.targetGroup === targetGroup) || usable[0];
        if (!preferred) {
          setPatternLoadError('ไม่พบ Auto Schedule Pattern ที่เปิดใช้งาน');
          setPatternType('');
          return;
        }
        setPatternType(preferred.code);
        const firstPhase = preferred.mode === 'CYCLE' ? preferred.steps[0]?.phaseCode || '' : '';
        setStartPhase(firstPhase);
        setSuggestedCode(firstPhase);
      })
      .catch((error) => {
        if (!active) return;
        setPatterns([]);
        setPatternType('');
        setPatternLoadError(formatRequestErrorMessage(error, 'อ่าน Auto Schedule Pattern ไม่สำเร็จ'));
      });
    return () => { active = false; };
  }, [token, isSupervisorTarget]);

  useEffect(() => {
    if (!token || !target.id || !patternType) return;
    let active = true;
    api.previewEmployeeAutoSchedule(token, scheduleMonth, String(target.id), 'AUTO', patternType)
      .then((res) => {
        if (!active) return;
        const analysis = nested(res.data).analysis as DataRow;
        if (analysis?.text) setAnalysisText(text(analysis.text));
        if (analysis?.code && selectedPattern?.mode === 'CYCLE') {
          const code = text(analysis.code);
          setSuggestedCode(code);
          setStartPhase((current) => current || code);
        }
      })
      .catch((error) => {
        if (!active) return;
        setAnalysisText(formatRequestErrorMessage(error, 'วิเคราะห์ Phase จากประวัติไม่สำเร็จ'));
      });
    return () => { active = false; };
  }, [token, scheduleMonth, target.id, patternType, selectedPattern?.mode]);

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

  const selectPattern = (pattern: AutoSchedulePattern) => {
    setPatternType(pattern.code);
    setAutoContinue(false);
    const firstPhase = pattern.mode === 'CYCLE' ? pattern.steps[0]?.phaseCode || '' : '';
    setStartPhase(firstPhase);
    setSuggestedCode(firstPhase);
    setAnalysisText(pattern.mode === 'CYCLE' ? 'กำลังวิเคราะห์ Phase จากประวัติกะ…' : 'แพทเทิร์นรายสัปดาห์ใช้วันจันทร์-อาทิตย์เป็น Phase อัตโนมัติ');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPattern) return;
    const phase = selectedPattern.mode === 'CYCLE'
      ? (autoContinue ? suggestedCode : startPhase)
      : 'AUTO';
    onSubmit(autoContinue && selectedPattern.mode === 'CYCLE', phase || 'AUTO', selectedPattern.code);
  };

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose();
  };

  return createPortal(
    <div className="employee-magic-wand-modal__viewport" role="presentation" onMouseDown={handleBackdropMouseDown}>
      <section className="employee-magic-wand-modal__dialog magic-wand-dialog" role="dialog" aria-modal="true" aria-labelledby="magic-wand-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading">
          <h2 id="magic-wand-title">จัดกะแพทเทิร์นด่วน</h2>
          <button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}><SmsIcon name="close" size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="magic-wand-body">
            <div className="wand-emp-badge">
              <span>พนักงาน: <strong>{empName} ({empCode})</strong></span>
            </div>
            <p className="wand-analysis-blue-text">การจัดครั้งนี้จะสร้าง Preview เป็นฉบับร่างจาก Pattern Master ปัจจุบัน โดยคงเฉพาะวันลา (AL) และ Admin override ไว้ ต้องกดบันทึกการเปลี่ยนแปลงทั้งหมดเพื่อบันทึกจริง</p>

            <div className="wand-section">
              <h3 className="wand-section-title">1. เลือกรูปแบบแพทเทิร์น (Pattern)</h3>
              {patternLoadError && <div className="alert alert-error">{patternLoadError}</div>}
              <div className="wand-options-list">
                {patterns.map((pattern, index) => <label key={pattern.id || pattern.code} className={`wand-option-card ${patternType === pattern.code ? 'selected' : ''}`}>
                  <input
                    ref={index === 0 ? initialFocusRef : undefined}
                    type="radio"
                    name="pattern-type"
                    checked={patternType === pattern.code}
                    onChange={() => selectPattern(pattern)}
                  />
                  <div className="option-text">
                    <strong>{pattern.name}</strong>
                    <p>{describePattern(pattern)}</p>
                    <small>{pattern.targetGroup === 'SUPERVISOR' ? 'ค่าเริ่มต้นหัวหน้างาน' : pattern.targetGroup === 'GENERAL' ? 'ค่าเริ่มต้นพนักงานทั่วไป' : 'แพทเทิร์นเลือกเอง'} · {pattern.mode === 'WEEKLY' ? 'รายสัปดาห์' : 'วนตาม Phase'}</small>
                  </div>
                </label>)}
              </div>
            </div>

            {selectedPattern?.mode === 'CYCLE' && (
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

                {autoContinue && <div className="wand-analysis-blue-text">{analysisText}</div>}

                <div className="field-group phase-select-box">
                  <select
                    id="phase-select"
                    disabled={autoContinue}
                    value={autoContinue ? suggestedCode : startPhase}
                    onChange={(e) => setStartPhase(e.target.value)}
                  >
                    {selectedPhaseOptions.map((step) => <option key={step.phaseCode} value={step.phaseCode}>{step.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
            <button className="btn-primary compact wand-submit-btn" type="submit" disabled={busy || !selectedPattern}>
              {busy ? 'กำลังสร้างร่าง…' : '🪄 ใส่ลงในฉบับร่าง'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    modalRoot
  );
}

type OperationalPage = Exclude<Page, 'dashboard' | 'dashboardDetails' | 'employees' | 'approvalCenter' | 'attendance' | 'attendanceSupervisor' | 'attendanceHistory' | 'employeeSchedule' | 'attendanceDevice' | 'profile' | 'reportCenter' | 'reports' | 'executiveReport' | 'attendanceReport' | 'shiftSetup' | 'securitySite' | 'settings' | 'leavePending' | 'leaveHistory' | 'dataQuality' | 'systemHealth'>;

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
  approvals: { title: 'อนุมัติตารางกะ', eyebrow: 'ตารางและกฎการทำงาน', description: 'ประวัติสถานะและฉบับแก้ไขการอนุมัติตาราง', columns: [
    { label: 'เดือน', value: (row) => date(row.month) }, { label: 'ฉบับแก้ไข', value: (row) => text(row.revision) },
    { label: 'สถานะ', value: (row) => { const superseded = isSupersededScheduleApproval(row); return <span className={`status-badge status-badge--${superseded ? 'neutral' : semanticStatusTone(row.status)}`}>{scheduleApprovalStatusLabel(row.status, superseded)}</span>; } },
    { label: 'ประเภทการเปลี่ยน', value: (row) => scheduleApprovalChangeTypeLabel(row.changeType) }, { label: 'อนุมัติเมื่อ', value: (row) => date(row.approvedAt) }, { label: 'หมายเหตุ', value: (row) => text(row.approvalNote) }
  ] },
  rules: { title: 'กฎการทำงาน', eyebrow: 'ตารางและกฎการทำงาน', description: 'กฎที่ใช้ตรวจสอบและจัดตารางกำลังคน', columns: [
    { label: 'รหัสกฎ', value: (row) => text(row.ruleId) }, { label: 'ชื่อกฎ', value: (row) => text(row.name) },
    { label: 'ค่า', value: (row) => text(row.value) }, { label: 'หน่วย', value: (row) => text(row.unit) },
    { label: 'สถานะ', value: (row) => <span className={`status-badge ${row.enabled ? 'status-badge--success' : 'status-badge--neutral'}`}>{row.enabled ? 'เปิดใช้' : 'ปิดใช้'}</span> }
  ] },
  leave: { title: 'คำขอลา', eyebrow: 'การลา', description: 'ประวัติคำขอลาและสถานะการอนุมัติ', columns: [
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) }, { label: 'ประเภท', value: (row) => leaveTypeDisplayText(row) },
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
    { label: 'บทบาท', value: (row) => roleDisplayName(String(row.role || '')) }, { label: 'สถานะบัญชี', value: (row) => text(row.accountStatus) },
    { label: 'เปลี่ยนรหัสผ่าน', value: (row) => row.passwordResetRequired ? 'จำเป็น' : 'ไม่จำเป็น' }
  ] },
  audit: { title: 'ประวัติการทำรายการ', eyebrow: 'ผู้ดูแลระบบ', description: 'เหตุการณ์สำคัญของระบบโดยไม่แสดง payload ที่อ่อนไหว', columns: [
    { label: 'เวลา', value: (row) => date(row.createdAt) }, { label: 'เหตุการณ์', value: (row) => text(row.action) },
    { label: 'ประเภทข้อมูล', value: (row) => text(row.entityType) }, { label: 'ผู้ดำเนินการ', value: (row) => text(nested(row.actor).displayName) }
  ] }
};

function OperationalTable({ page, response, loading, error, onPageChange, onAction, onCreate, onNavigate, role, token, refreshSignal, onLicenseDocumentChanged, onEditLicense, licenseEmployeeStatus = 'ACTIVE', onLicenseEmployeeStatusChange, printedBy }: { page: OperationalPage; response: DataResponse; loading: boolean; error?: RequestErrorInput; onPageChange(page: number): void; onAction(row: DataRow, action: string): void; onCreate(): void; onNavigate(page: Page): void; role: string; token?: string; refreshSignal: number; onLicenseDocumentChanged(message: string): void; onEditLicense?: (row: DataRow) => void; licenseEmployeeStatus?: LicenseEmployeeStatus; onLicenseEmployeeStatusChange?(status: LicenseEmployeeStatus): void; printedBy: string }) {
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
  const canManage = ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role);
  const canEditRows = canManage && (page !== 'approvals' || role === 'ADMIN');
  const rowActions = (row: DataRow) => {
    if (!canEditRows || !actionPages.includes(page)) return null;
    if (page === 'approvals') return canDecideScheduleApproval(row) ? <><button className="btn-success compact" onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button className="btn-danger-outline compact" onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></> : null;
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
    else if (page === 'approvals' && canDecideScheduleApproval(selectedRow)) {
      primaryAction = { label: 'อนุมัติ', icon: 'check', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'approve'); } };
      secondaryActions.push({ label: 'ไม่อนุมัติ', tone: 'danger', icon: 'close', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'reject'); } });
    } else if (page === 'leave') primaryAction = { label: 'อนุมัติ', icon: 'check', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'approve'); } };
    if (page === 'rules') secondaryActions.push({ label: selectedRow.enabled ? 'ปิดใช้กฎ' : 'เปิดใช้กฎ', tone: 'secondary', icon: 'pause', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'toggle'); } });
    if (page === 'quota' && role === 'ADMIN' && (selectedRow.quotaYear === null || selectedRow.quotaYear === undefined || selectedRow.quotaYear === '')) secondaryActions.push({ label: selectedRow.employeeId ? 'จัดประเภทปี' : 'จับคู่พนักงานและปี', tone: 'secondary', icon: 'users', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'link'); } });
    if (page === 'licenses' && role === 'ADMIN') secondaryActions.push({ label: 'ลบใบอนุญาต', tone: 'danger', icon: 'close', onSelect: () => { const row = selectedRow; closeDrawer(); onAction(row, 'delete'); } });
  }
  const licenseTableHeader = <tr>{config.columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}{showActions && <TableActionHeader label="ดำเนินการ" />}</tr>;
  const licenseEmptyState = <DataTableState
    variant="empty"
    title={noResultsMessage}
    description={page === 'licenses' && tableSearch ? 'ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองแล้วค้นหาอีกครั้ง' : 'ยังไม่มีรายการที่ต้องดำเนินการในขอบเขตนี้'}
    action={page === 'licenses' && tableSearch ? { label: 'ล้างคำค้นหา', onClick: () => setTableSearch('') } : canCreate ? { label: createLabel, onClick: onCreate } : undefined}
  />;
  const licenseDesktop = error
    ? <DataTableState variant="error" title="ไม่สามารถโหลดใบอนุญาต" description="ข้อมูลใบอนุญาตยังไม่พร้อมใช้งาน" />
    : loading
      ? <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการใบอนุญาตพนักงาน"><thead>{licenseTableHeader}</thead><tbody><DataTableSkeletonRows columnCount={config.columns.length + (showActions ? 1 : 0)} /></tbody></table></div>
      : <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการใบอนุญาตพนักงาน"><thead>{licenseTableHeader}</thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={text(row.id) + index} className="signature-data-row" data-operational-row={text(row.id)} tabIndex={0} aria-label={`เปิดรายละเอียดใบอนุญาต ${text(nested(row.employee).firstName)} ${text(nested(row.employee).lastName)}`.trim()} onClick={() => selectRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRow(row); } }}>{config.columns.map((column) => page === 'licenses' ? renderLicenseCell(row, column) : <td key={column.label}>{tableValue(row, column)}</td>)}{showActions && <TableActionCell className="row-actions data-row-actions" onClick={(event) => event.stopPropagation()}>{rowActions(row)}</TableActionCell>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows data-table-empty-cell">{licenseEmptyState}</td></tr>}</tbody></table></div>;
  const licenseMobile = error
    ? <DataTableState variant="error" title="ไม่สามารถโหลดใบอนุญาต" description="ข้อมูลใบอนุญาตยังไม่พร้อมใช้งาน" />
    : loading
      ? <div className="signature-mobile-records"><DataTableSkeletonCards count={4} cardClassName="data-mobile-card license-mobile-skeleton" /></div>
      : <div className="signature-mobile-records">{visibleRows.map((row) => <button type="button" key={`mobile-${text(row.id)}`} className="signature-mobile-record" data-operational-row={text(row.id)} aria-label={`เปิดรายละเอียดใบอนุญาต ${text(nested(row.employee).firstName)} ${text(nested(row.employee).lastName)}`.trim()} onClick={() => selectRow(row)}><span className="signature-mobile-record__eyebrow">{config.eyebrow}</span><strong>{`${text(nested(row.employee).firstName)} ${text(nested(row.employee).lastName)}`.trim() || text(row.licenseNumber)}</strong><div>{config.columns.filter((column) => column.label !== 'ดูไฟล์').slice(0, 5).map((column) => <span key={column.label}><small>{column.label}</small>{tableValue(row, column)}</span>)}</div><em>แตะเพื่อเปิดรายละเอียด</em></button>)}</div>;
  const quotaTableHeader = <tr>{config.columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}{showActions && <TableActionHeader label="ดำเนินการ" />}</tr>;
  const quotaEmptyState = <DataTableState
    variant="empty"
    title={noResultsMessage}
    description="ยังไม่มีรายการโควตาในขอบเขตที่เลือก หรือข้อมูลเดิมยังไม่พร้อมแสดง"
    action={canCreate ? { label: createLabel, onClick: onCreate } : undefined}
  />;
  const quotaDesktop = error
    ? <DataTableState variant="error" title="ไม่สามารถโหลดโควตาวันลา" description="ข้อมูลสิทธิ์รายปียังไม่พร้อมใช้งาน" />
    : loading
      ? <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการโควตาวันลา"><thead>{quotaTableHeader}</thead><tbody><DataTableSkeletonRows columnCount={config.columns.length + (showActions ? 1 : 0)} /></tbody></table></div>
      : <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการโควตาวันลา"><thead>{quotaTableHeader}</thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={text(row.id) + index} className="signature-data-row" data-operational-row={text(row.id)} tabIndex={0} aria-label={`เปิดรายละเอียดโควตา ${text(row.employeeNameSnapshot) || text(row.employeeId) || text(row.id)}`} onClick={() => selectRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRow(row); } }}>{config.columns.map((column) => <td key={column.label}>{tableValue(row, column)}</td>)}{showActions && <TableActionCell className="row-actions data-row-actions" onClick={(event) => event.stopPropagation()}>{rowActions(row)}</TableActionCell>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows data-table-empty-cell">{quotaEmptyState}</td></tr>}</tbody></table></div>;
  const quotaMobile = error
    ? <DataTableState variant="error" title="ไม่สามารถโหลดโควตาวันลา" description="ข้อมูลสิทธิ์รายปียังไม่พร้อมใช้งาน" />
    : loading
      ? <div className="signature-mobile-records"><DataTableSkeletonCards count={4} cardClassName="data-mobile-card quota-mobile-skeleton" /></div>
      : <div className="signature-mobile-records">{visibleRows.map((row) => <button type="button" key={`mobile-${text(row.id)}`} className="signature-mobile-record" data-operational-row={text(row.id)} aria-label={`เปิดรายละเอียดโควตา ${text(row.employeeNameSnapshot) || text(row.employeeId) || text(row.id)}`} onClick={() => selectRow(row)}><span className="signature-mobile-record__eyebrow">{config.eyebrow}</span><strong>{text(row.employeeNameSnapshot) || (row.employeeId ? text(row.employeeId) : 'ข้อมูลโควตาเดิม — ยังไม่จับคู่พนักงาน')}</strong><div>{config.columns.slice(0, 6).map((column) => <span key={column.label}><small>{column.label}</small>{tableValue(row, column)}</span>)}</div><em>แตะเพื่อเปิดรายละเอียดและการจัดการ</em></button>)}</div>;
  const quotaSurface = <ResponsiveDataTable ariaLabel="รายการโควตาวันลา" loading={loading} error={Boolean(error)} loadingLabel="กำลังอ่านข้อมูลโควตาวันลา…" errorLabel="ไม่สามารถโหลดโควตาวันลา" className="signature-data-surface" desktop={quotaDesktop} mobile={quotaMobile} />;
  const licenseSurface = <ResponsiveDataTable ariaLabel="รายการใบอนุญาตพนักงาน" loading={loading} error={Boolean(error)} loadingLabel="กำลังอ่านข้อมูลใบอนุญาต…" errorLabel="ไม่สามารถโหลดใบอนุญาต" className="signature-data-surface" desktop={licenseDesktop} mobile={licenseMobile} />;
  const approvalTableHeader = <tr>{config.columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}{showActions && <TableActionHeader label="ดำเนินการ" />}</tr>;
  const approvalEmptyState = <DataTableState variant="empty" title="ยังไม่มีประวัติการอนุมัติตาราง" description="ยังไม่มีรายการฉบับแก้ไขการอนุมัติตารางกะในขอบเขตนี้" />;
  const approvalRowLabel = (row: DataRow) => `เปิดรายละเอียดการอนุมัติตาราง ${date(row.month)} ฉบับแก้ไข ${text(row.revision)}`;
  const approvalDesktop = error
    ? <DataTableState variant="error" title="ไม่สามารถโหลดประวัติการอนุมัติ" description="ข้อมูลประวัติการอนุมัติตารางยังไม่พร้อมใช้งาน" />
    : loading
      ? <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการประวัติการอนุมัติตารางกะ"><thead>{approvalTableHeader}</thead><tbody><DataTableSkeletonRows columnCount={config.columns.length + (showActions ? 1 : 0)} /></tbody></table></div>
      : <div className="table-scroll data-table-scroll"><table className="data-table data-surface-table signature-data-table" aria-label="รายการประวัติการอนุมัติตารางกะ"><thead>{approvalTableHeader}</thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={text(row.id) + index} className="signature-data-row" data-operational-row={text(row.id)} tabIndex={0} aria-label={approvalRowLabel(row)} onClick={() => selectRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRow(row); } }}>{config.columns.map((column) => <td key={column.label}>{tableValue(row, column)}</td>)}{showActions && <TableActionCell className="row-actions data-row-actions" onClick={(event) => event.stopPropagation()}>{rowActions(row)}</TableActionCell>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows data-table-empty-cell">{approvalEmptyState}</td></tr>}</tbody></table></div…37405 tokens truncated…mmary.pendingLeaves || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>⏳</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#1e40af' }}>มี {text(dashboardSummary.pendingLeaves)} คำขอลาพักรอการอนุมัติ</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#1d4ed8' }}>อนุมัติหรือปฏิเสธคำขอลาเข้าสู่ตารางกะ</p>
                      </div>
                    </div>
                    <button className="btn-info compact action-nowrap" onClick={() => setActivePage(canManage ? 'approvalCenter' : 'leave')}>{canManage ? 'เปิดศูนย์อนุมัติ' : 'ดูคำขอลา'}</button>
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

          <div className="table-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', background: '#061421' }}>
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
    if (activePage === 'approvalCenter' && auth.token && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs) return <ApprovalCenterPage token={auth.token} role={auth.user?.role || 'VIEWER'} currentEmployeeId={String(leaveSummary.employeeId || '')} refreshKey={approvalCenterRefresh} onChanged={() => { setApprovalCenterRefresh((value) => value + 1); setEmployeeRefresh((value) => value + 1); setOperationRefresh((value) => value + 1); }} onOpenEmployeeChange={(requestId) => { setEmployeeChangeReviewInitialId(requestId); setEmployeeChangeReviewOpen(true); }} onNavigate={(item) => { if (item.type === 'REGISTRATION_REQUEST') setRegistrationReviewInitialRequestId(item.requestId); setActivePage(item.sourcePage); }} onLeaveDecision={(item, action) => openLeaveDecision({ id: item.requestId, employeeId: item.employee?.id, employeeNameSnapshot: item.employee?.displayName || item.title, departmentSnapshot: item.employee?.department || item.metadata?.department, leaveTypeNameSnapshot: item.metadata?.leaveType, startDate: item.metadata?.startDate, endDate: item.metadata?.endDate, dayCount: item.metadata?.dayCount, reason: item.metadata?.reason, substitute: item.metadata?.substitute, status: item.status }, action)} />;
    if (activePage === 'employees') return <PersonnelDirectoryPage token={auth.token} refreshKey={employeeRefresh} canManage={canManage} role={auth.user?.role || 'VIEWER'} searchValue={search} onSearchValueChange={setSearch} onAdd={() => openEmployeeEditor()} onReviewChanges={() => { if (auth.user?.role === 'ADMIN' && !auth.isViewingAs) { setEmployeeChangeReviewInitialId(undefined); setEmployeeChangeReviewOpen(true); } }} onEdit={openEmployeeEditor} />;
    if (activePage === 'audit') {
      const auditRows = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const printFilters = [
        auditFilters.dateFrom && { label: 'ตั้งแต่วันที่', value: auditFilters.dateFrom },
        auditFilters.dateTo && { label: 'ถึงวันที่', value: auditFilters.dateTo },
        auditFilters.actor && { label: 'ผู้ใช้งาน', value: auditFilters.actor },
        auditFilters.entityType && { label: 'หมวดงาน', value: auditFilters.entityType },
        auditFilters.action && { label: 'การดำเนินการ', value: auditFilters.action },
        auditFilters.category !== 'default' && { label: 'ประเภทเหตุการณ์', value: auditFilters.category === 'technical' ? 'ระบบและเทคนิค' : 'ทั้งหมด' },
        auditFilters.search && { label: 'ค้นหา', value: auditFilters.search }
      ].filter((item): item is { label: string; value: string } => Boolean(item));
      return <AuditCompliancePage rows={auditRows} total={operationResponse.meta?.total ?? auditRows.length} page={operationResponse.meta?.page || operationPage} totalPages={operationResponse.meta?.totalPages || 1} pageSize={auditPageSize} loading={operationLoading} error={typeof operationError === 'string' ? operationError : operationError?.message} permissionDenied={auth.user?.role !== 'ADMIN'} filters={auditFilters} onFiltersChange={(filters) => { setAuditFilters(filters); setOperationPage(1); }} onRefresh={() => setOperationRefresh((value) => value + 1)} onPageChange={setOperationPage} onPageSize={(value) => { setAuditPageSize(value); setOperationPage(1); }} onExport={(rows) => downloadCsv(rows as DataRow[], `audit-events-page-${operationResponse.meta?.page || operationPage}`)} onPrint={() => void printTableReport('.audit-table', { title: 'บันทึกเหตุการณ์ความปลอดภัย', printedBy: `${auth.user?.displayName || auth.user?.email || 'ผู้ใช้งาน'} · ${roleDisplayName(auth.user?.role)}`, filters: printFilters })} />;
    }
    if (activePage === 'dataQuality') {
      const qualityRows = Array.isArray(operationResponse.data) ? operationResponse.data as DataQualityIssue[] : [];
      return <DataQualityCenterPage rows={qualityRows} summary={operationResponse.summary} total={operationResponse.meta?.total ?? operationResponse.summary?.total ?? qualityRows.length} page={operationResponse.meta?.page || operationPage} pageSize={operationResponse.meta?.pageSize || dataQualityPageSize} totalPages={operationResponse.meta?.totalPages || 0} loading={operationLoading} error={typeof operationError === 'string' ? operationError : operationError?.message} permissionDenied={auth.user?.role !== 'ADMIN'} filters={dataQualityFilters} onFiltersChange={(filters) => { setDataQualityFilters(filters); setOperationPage(1); }} onRefresh={() => setOperationRefresh((value) => value + 1)} onPageChange={setOperationPage} onPageSize={(value) => { setDataQualityPageSize(value); setOperationPage(1); }} onNavigate={(page) => setActivePage(page)} />;
    }
    if (activePage === 'systemHealth' && auth.token) return <SystemHealthPage token={auth.token} />;
    if (activePage === 'shiftSetup') {
      const renderShiftActions = (shiftType: DataRow, isCore: boolean, isActive: boolean) => auth.user?.role === 'ADMIN' ? <><button className="btn-secondary compact" onClick={() => openShiftTypeEditor(shiftType)}>แก้ไข</button>{isCore ? <span className="muted-text">ล็อกสถานะ</span> : <button className={isActive ? 'btn-warning compact' : 'btn-success compact'} onClick={() => toggleShiftTypeActive(shiftType)}>{isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</> : null;
      const shiftDesktop = <div className="table-card shift-setup-desktop-table"><div className="table-scroll data-table-scroll"><table className="data-table data-surface-table"><thead><tr><th scope="col">รหัสกะ</th><th scope="col">ชื่อกะ</th><th scope="col">เวลาเริ่ม</th><th scope="col">เวลาเลิก</th><th scope="col">ชั่วโมง</th><th scope="col">สี</th><th scope="col">สถานะ</th>{auth.user?.role === 'ADMIN' && <th scope="col">จัดการ</th>}</tr></thead><tbody>{visibleShiftTypes.length ? visibleShiftTypes.map((shiftType) => { const code = String(shiftType.code || '').toUpperCase(); const isCore = ['D', 'N', 'OFF', 'AL'].includes(code); const isActive = shiftType.isActive !== false; return <tr key={text(shiftType.id)}><td><code>{text(shiftType.code)}</code>{isCore && <small className="cell-note">กะหลัก</small>}</td><td className="employee-name">{text(shiftType.name)}</td><td>{text(shiftType.startTime)}</td><td>{text(shiftType.endTime)}</td><td>{text(shiftType.hours)}</td><td><span className="shift-color" style={{ backgroundColor: String(shiftType.color || '#2F80FF') }} /> {text(shiftType.color)}</td><td><span className={`status-badge ${isActive ? 'status-badge--success' : 'status-badge--neutral'}`}>{isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>{auth.user?.role === 'ADMIN' && <td className="row-actions data-row-actions">{renderShiftActions(shiftType, isCore, isActive)}</td>}</tr>; }) : <tr><td colSpan={auth.user?.role === 'ADMIN' ? 8 : 7} className="no-rows data-table-empty-cell"><div className="data-state data-state--empty"><strong>ยังไม่มีข้อมูลรหัสกะ</strong></div></td></tr>}</tbody></table></div></div>;
      const shiftMobile = <div className="shift-setup-mobile-list" aria-label="รายการรหัสกะสำหรับมือถือ">{visibleShiftTypes.length ? visibleShiftTypes.map((shiftType) => { const code = String(shiftType.code || '').toUpperCase(); const isCore = ['D', 'N', 'OFF', 'AL'].includes(code); const isActive = shiftType.isActive !== false; return <article className="shift-setup-mobile-card data-mobile-card" key={`shift-mobile-${text(shiftType.id)}`}><header><div><code>{text(shiftType.code)}</code>{isCore && <small>กะหลัก</small>}</div><span className={`status-badge ${isActive ? 'status-badge--success' : 'status-badge--neutral'}`}>{isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></header><h2>{text(shiftType.name)}</h2><dl><div><dt>เวลา</dt><dd>{text(shiftType.startTime)}–{text(shiftType.endTime)}</dd></div><div><dt>ชั่วโมง</dt><dd>{text(shiftType.hours)}</dd></div><div><dt>สี</dt><dd><span className="shift-color" style={{ backgroundColor: String(shiftType.color || '#2F80FF') }} /> {text(shiftType.color)}</dd></div></dl>{auth.user?.role === 'ADMIN' && <footer>{renderShiftActions(shiftType, isCore, isActive)}</footer>}</article>; }) : <div className="data-state data-state--empty"><strong>ยังไม่มีข้อมูลรหัสกะ</strong></div>}</div>;
      return (
        <section className="view-pane layout-roster-page layout-page-surface">
          <PageHeader kicker="ตารางและกฎการทำงาน" title="รหัสกะและเวลา" description="บริหารชื่อ เวลา ชั่วโมง สี และสถานะใช้งานของกะ โดยไม่เขียนทับ snapshot ตารางเดิม" actions={<div className="heading-actions">{auth.user?.role === 'ADMIN' && <button className="btn-primary compact" onClick={openShiftTypeCreator}>+ เพิ่มรหัสกะ</button>}<span className="record-chip">ใช้งาน {activeShiftTypes.length} / ทั้งหมด {shiftTypes.length}</span></div>} />
          <ErrorAlert message={operationError} />
          <div className="shift-governance-toolbar"><label className="field-group"><span>ค้นหากะ</span><input value={shiftQuery} placeholder="รหัสหรือชื่อกะ" onChange={(event) => setShiftQuery(event.target.value)} /></label><label className="field-group"><span>สถานะ</span><select value={shiftStatusFilter} onChange={(event) => setShiftStatusFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}><option value="ALL">ทั้งหมด</option><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ไม่ใช้งาน</option></select></label></div>
          {shiftDeactivationTarget && shiftDeactivationImpact && <section className="shift-impact-preview" aria-label="ตรวจสอบผลกระทบของรหัสกะ"><h3>ตรวจสอบผลกระทบก่อนปิดใช้งาน</h3><p><strong>{text(shiftDeactivationTarget.code)} · {text(shiftDeactivationTarget.name)}</strong> จะไม่ถูกใช้กับการจัดกะใหม่ ตารางเดิมจะไม่ถูกแก้ไข และ snapshot/ประวัติเดิมยังคงอยู่</p><dl><div><dt>รายการจัดกะ</dt><dd>{text(shiftDeactivationImpact.assignmentCount)}</dd></div><div><dt>รายการลงเวลา</dt><dd>{text(shiftDeactivationImpact.attendanceCount)}</dd></div><div><dt>รวมการอ้างอิง</dt><dd>{text(shiftDeactivationImpact.totalReferences)}</dd></div></dl><label className="field-group"><span>เหตุผลในการปิดใช้งาน</span><textarea rows={3} maxLength={1000} value={shiftDeactivationReason} onChange={(event) => setShiftDeactivationReason(event.target.value)} /></label><div className="shift-impact-actions"><button className="btn-neutral small-action" onClick={() => { setShiftDeactivationTarget(undefined); setShiftDeactivationImpact(undefined); setShiftDeactivationReason(''); }}>ยกเลิก</button><button className="btn-danger small-action" disabled={shiftDeactivationReason.trim().length < 3} onClick={() => void confirmShiftDeactivation()}>ยืนยันปิดใช้งาน</button></div></section>}
          <SectionCard kicker="รหัสกะ" title="รายการรหัสกะ" description="สถานะและข้อมูลกะจากระบบ ตารางและ snapshot เดิมยังคงอยู่"><ResponsiveDataTable ariaLabel="รายการรหัสกะ" hasRows={visibleShiftTypes.length > 0} className="shift-setup-responsive-table" desktop={shiftDesktop} mobile={shiftMobile} /></SectionCard>
        </section>
      );
    }
    if (activePage === 'schedule') {
      const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
      const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
      const allCalendarEmployees = sortScheduleEmployeesByDepartment(rawCalendarEmployees);
      const calendarEmployees = selectedDepartments.length > 0
        ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
        : allCalendarEmployees;
      const todayScheduleDate = bangkokDateInput();
      const approval = nested(calendar.approval);
      const [yStr, mStr] = scheduleMonth.split('-');
      const thaiYearNum = Number(yStr) + 543;
      const monthNameOnly = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1)));
      const monthLabel = `${monthNameOnly} พ.ศ. ${thaiYearNum}`;
      const departments = Array.from(new Set(employees.map((employee) => employee.department || '').filter(Boolean))).sort();
      const moveMonth = (delta: number) => { const value = new Date(`${scheduleMonth}-01T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + delta); setScheduleMonth(value.toISOString().slice(0, 7)); setOperationPage(1); };
      const previewRows = Array.isArray(autoSchedulePreview?.rows) ? autoSchedulePreview.rows as DataRow[] : [];
      const previewWarnings = Array.isArray(autoSchedulePreview?.warnings) ? autoSchedulePreview.warnings : [];
      const previewSummary = nested(autoSchedulePreview?.summary);
      const previewFillSummary = summarizeAutoSchedulePreview(previewRows, scheduleDrafts);

      const buildPreviewDraft = (row: DataRow) => {
          const workDateStr = inputDate(row.date);
          const empId = String(row.employeeId || '');
          if (!empId || !workDateStr) return undefined;
          const key = `${empId}_${workDateStr}`;
          const codeStr = String(row.code || 'OFF').toUpperCase();
          const selectedType = activeShiftTypes.find((t) => String(t.code).toUpperCase() === codeStr)
            || activeShiftTypes.find((t) => String(t.id) === row.shiftTypeId)
            || activeShiftTypes[0];
          const validShiftTypeId = String(selectedType?.id || '');
          if (!validShiftTypeId || validShiftTypeId.length < 10) return undefined;

          return { key, draft: {
            action: row.existingShiftId ? 'update' as const : 'create' as const,
            id: row.existingShiftId ? String(row.existingShiftId) : undefined,
            employeeId: empId,
            workDate: workDateStr,
            shiftTypeId: validShiftTypeId,
            shiftCode: codeStr,
            shiftName: String(selectedType?.name || codeStr),
            startTime: String(selectedType?.startTime || (codeStr === 'N' ? '22:00' : codeStr === 'D' ? '08:00' : '00:00')),
            endTime: String(selectedType?.endTime || (codeStr === 'N' ? '06:00' : codeStr === 'D' ? '16:00' : '00:00')),
            color: String(selectedType?.color || (codeStr === 'D' ? '#2563eb' : codeStr === 'N' ? '#7c3aed' : '#64748b')),
            remark: String(row.remark || 'จัดกะอัตโนมัติ (ฉบับร่าง)'),
            licenseStatus: String(row.licenseStatus || ''),
            licenseOverride: Boolean(row.licenseOverride),
            overrideReason: String(row.overrideReason || ''),
            payload: {
              employeeId: empId,
              workDate: workDateStr,
              shiftTypeId: validShiftTypeId,
              remark: String(row.remark || 'จัดกะอัตโนมัติ'),
              licenseOverride: Boolean(row.licenseOverride),
              overrideReason: String(row.overrideReason || '')
            }
          } };
      };

      const applyPreviewToDrafts = (previewRowsParam: DataRow[], replaceEmployeeId?: string) => {
        if (!replaceEmployeeId) {
          setScheduleDrafts(addAutoSchedulePreviewDrafts(scheduleDrafts, previewRowsParam, (row) => buildPreviewDraft(row as DataRow)?.draft));
          return;
        }
        const newDrafts = { ...scheduleDrafts };
        for (const key of Object.keys(newDrafts)) {
          if (key.startsWith(`${replaceEmployeeId}_`) && String(newDrafts[key].workDate || '').startsWith(scheduleMonth)) delete newDrafts[key];
        }
        for (const row of previewRowsParam) {
          const prepared = buildPreviewDraft(row);
          if (!prepared) continue;
          newDrafts[prepared.key] = prepared.draft;
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
      return <section className="view-pane schedule-calendar-page nexus-roster-workspace layout-roster-page layout-page-surface">

        <PageHeader kicker="ตารางและกฎการทำงาน" title="ตารางกะรายเดือน" description="จัดกะรายเดือน แก้ไขในฉบับร่างแล้วบันทึกการเปลี่ยนแปลงก่อนตรวจและส่งอนุมัติ" actions={<div className="heading-actions">{auth.user?.role === 'ADMIN' && !auth.isViewingAs && <button className="btn-neutral small-action" onClick={() => setActivePage('approvals')}>ประวัติการอนุมัติ</button>}{approval.status === 'APPROVED' && <><button className="excel-action" disabled={scheduleExportBusy} onClick={exportApprovedExcel}>▦ {scheduleExportBusy ? 'กำลังสร้าง Excel…' : `ส่งออก Excel${selectedDepartments.length ? ` · ${selectedDepartments.length} แผนก` : ''}`}</button><button className="btn-info small-action" onClick={() => void printScheduleDocument()}><SmsIcon name="report" /> ส่งออก PDF</button></>}</div>} />
        <StepFlow title="ลำดับการจัดตารางกะ" description="สถานะจากรายการที่โหลดและฉบับร่าง ต้องเปิดผลตรวจกฎของเดือนนี้แยกต่างหาก" steps={[
{id:'month',icon:'calendar',label:'ขั้นที่หนึ่ง',title:'เลือกเดือน',desc:monthLabel,completed:!operationLoading && !operationError && calendar.month===scheduleMonth},
{id:'arrange',icon:'edit',label:'ขั้นที่สอง',title:'จัดกะ',desc:Object.keys(scheduleDrafts).length ? 'ยังมีฉบับร่างที่ต้องบันทึก' : 'ตรวจรายการที่บันทึกในตาราง',completed:!operationLoading && !operationError && calendar.month===scheduleMonth && Object.keys(scheduleDrafts).length===0 && calendarEmployees.some(employee=>Array.isArray(employee.shifts) && employee.shifts.length>0)},
{id:'rules',icon:'quality',label:'ขั้นที่สาม',title:'ตรวจกฎ',desc:'เปิดผลตรวจจริงของเดือนที่เลือก ไม่ใช้ผลจากเดือนก่อน',onClick:()=>setActivePage('rules')},
{id:'approval',icon:'approval',label:'ขั้นที่สี่',title:'ส่งอนุมัติ',desc:approval.id ? 'มีรายการอนุมัติจากระบบ ตรวจสถานะในแถบด้านล่าง' : 'ยังไม่มีรายการอนุมัติที่ยืนยันได้',completed:Boolean(!operationLoading && !operationError && calendar.month===scheduleMonth && approval.id && ['PENDING','APPROVED'].includes(String(approval.status)))}
]} />
        <div className={`approval-banner ${approval.status === 'APPROVED' ? 'approved' : 'pending'}`}><div><strong>{approval.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : '● รออนุมัติ'} · {monthLabel}</strong><small>ฉบับแก้ไข {text(approval.revision || 1)}{approval.approvedAt ? ` · อนุมัติโดย ${text(approval.approvedBy || approval.approvedByDisplayName || 'ผู้มีอำนาจอนุมัติ')} เมื่อ ${date(approval.approvedAt)}` : ' · การแก้ตารางจะสร้างฉบับแก้ไขใหม่โดยอัตโนมัติ'}</small></div>{['ADMIN', 'SUPERVISOR'].includes(auth.user?.role || '') && approval.status !== 'APPROVED' && <button className="btn-primary compact" style={{ backgroundColor: '#059669', borderColor: '#047857', fontWeight: 'bold' }} onClick={async () => { if (!auth.token) return; const confirmed = await actionDialog.confirm({ title: 'อนุมัติตารางกะรายเดือน', message: 'การอนุมัติจะเปลี่ยนสถานะตารางเดือนนี้เป็นอนุมัติแล้วตามขั้นตอนเดิม และการแก้ไขภายหลังจะสร้างฉบับแก้ไขใหม่โดยอัตโนมัติ', context: monthLabel, confirmLabel: 'ยืนยันอนุมัติตาราง', tone: 'primary' }); if (!confirmed) return; setOperationError(undefined); try { if (approval.id) { await api.updateScheduleApproval(auth.token, String(approval.id), { status: 'APPROVED' }); } else { await api.approveScheduleMonth(auth.token, scheduleMonth); } const updated = await api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment); setOperationResponse(updated); setApprovalCenterRefresh((value) => value + 1); } catch (reason) { setOperationError(toRequestErrorState(reason, 'อนุมัติตารางไม่สำเร็จ')); } }}>อนุมัติ ตารางเดือนนี้</button>}</div>
        <SectionCard className="calendar-toolbar-box schedule-workbench" kicker="ตารางกะ" title="เลือกเดือนและจัดกะ" description="บันทึกฉบับร่างก่อนตรวจและส่งอนุมัติ ไม่มีการเปลี่ยนสถานะเพียงจากการเลือกเดือน">
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e40af', marginBottom: '8px' }}>
            เลือกเดือนที่จะจัดกะ: {monthLabel} (สูงสุด 1 เดือน)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <MonthGridPicker value={scheduleMonth} onChange={(value) => { setScheduleMonth(value); setOperationPage(1); }} />
            <button className="btn-neutral small-action" onClick={() => moveMonth(-1)}>‹ เดือนก่อน</button>
            <button className="btn-neutral small-action" onClick={() => moveMonth(1)}>เดือนถัดไป ›</button>

            <div className="schedule-department-control">
              <button
                type="button"
                className="btn-neutral small-action schedule-department-trigger"
                onClick={() => setDeptMenuOpen((prev) => !prev)}
              >
                <SmsIcon name="employees" /> แผนก: {selectedDepartments.length === 0 ? 'ทุกแผนก' : `${selectedDepartments.length} แผนกที่เลือก`} ▾
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
                {autoScheduleBusy ? 'กำลังคำนวณ…' : 'ดูตัวอย่างจัดกะอัตโนมัติ'}
              </button>
            )}
            <span className="toolbar-count" style={{ marginLeft: 'auto' }}>{operationLoading ? 'แสดง — จาก — คน' : `แสดง ${calendarEmployees.length} จาก ${allCalendarEmployees.length} คน`}</span>
          </div>

          <div className="schedule-draft-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', paddingTop: '12px', borderTop: '1px dashed #bfdbfe' }}>
            <button type="button" className="btn-primary compact" style={{ padding: '8px 18px', fontWeight: 'bold', fontSize: '14px', borderRadius: '8px' }} disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0} onClick={saveAllDrafts}>
              {batchSaveBusy ? `กำลังบันทึก ${batchSaveProgress?.total ?? Object.keys(scheduleDrafts).length} รายการ…` : `บันทึกการเปลี่ยนแปลงทั้งหมด (${Object.keys(scheduleDrafts).length})`}
            </button>
            <button
              className="btn-danger compact"
              style={{ fontSize: '13px', fontWeight: 'bold', padding: '8px 16px', borderRadius: '8px' }}
              disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0}
              onClick={async () => { const draftCount = Object.keys(scheduleDrafts).length; if (!draftCount) return; const confirmed = await actionDialog.confirm({ title: 'ทิ้งรายการเปลี่ยนแปลงที่ยังไม่บันทึก', message: 'รายการแก้ไขกะที่ยังไม่ได้บันทึกจะถูกล้างออกจากหน้าจอ และจะไม่มีการส่งข้อมูลไปยัง Server', context: `${draftCount} รายการ`, confirmLabel: 'ยืนยันล้างรายการ', tone: 'danger' }); if (confirmed) setScheduleDrafts({}); }}
            >
              ยกเลิกรายการเปลี่ยนแปลงทั้งหมด
            </button>
            {batchSaveBusy && batchSaveProgress && <span role="status" aria-live="polite" style={{ fontSize: '13px' }}>บันทึกสำเร็จ {batchSaveProgress.saved} / ล้มเหลว {batchSaveProgress.failed}</span>}
            {!batchSaveBusy && batchSaveSummary && <span role="status" aria-live="polite" style={{ fontSize: '13px' }}>{batchSaveSummary}</span>}
            <span style={{ fontSize: '13px', color: '#475569' }}>
              คลิกช่องกะเพื่อแก้หลายรายการ แล้วค่อยบันทึกครั้งเดียว
            </span>
          </div>
        </SectionCard>
        {auth.user?.role === 'ADMIN' && autoSchedulePreview && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !autoScheduleBusy) setAutoSchedulePreview(undefined); }}>
            <section className="edit-dialog" style={{ maxWidth: '780px', backgroundColor: '#0f1d2a', borderRadius: '16px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div className="dialog-heading" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}><SmsIcon name="settings" /> ตัวอย่างตารางจัดกะอัตโนมัติ ( Auto Schedule Preview )</h2>
                <button type="button" aria-label="ปิดตัวอย่างตารางจัดกะอัตโนมัติ" style={{ background: 'none', border: 'none', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}><SmsIcon name="close" size={20} /></button>
              </div>

              <div className="preview-summary" style={{ display: 'flex', gap: '16px', marginBottom: '14px', fontSize: '13px', color: '#334155' }}>
                <strong className="auto-schedule-fill-summary">จะเติม {previewFillSummary.generated} ช่องว่าง · คงกะเดิมไว้ {previewFillSummary.preservedExisting} ช่อง</strong>
                <span><b>{text(previewSummary.employees)}</b> พนักงาน</span>
                <span><b>{text(previewSummary.totalRows)}</b> กะทั้งหมด</span>
                <span><b>{previewWarnings.length}</b> คำเตือน</span>
              </div>

              {previewFillSummary.generated === 0 && <div className="auto-schedule-empty-notice" role="status">ทุกช่องจัดไว้แล้ว ไม่มีอะไรให้เติม</div>}

              {previewWarnings.length > 0 && (
                <div className="preview-warning" style={{ backgroundColor: '#211807', border: '1px solid #ffedd5', color: '#c2410c', padding: '12px', borderRadius: '10px', marginBottom: '14px', fontSize: '13px' }}>
                  <strong>รายการที่ต้องตรวจสอบ:</strong>
                  {previewWarnings.slice(0, 8).map((warning, index) => <p key={`${String(warning)}-${index}`} style={{ margin: '4px 0 0 0' }}>• {text(warning)}</p>)}
                </div>
              )}

              <div className="table-scroll preview-table-wrap" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <table className="data-table preview-table" style={{ width: '100%' }}>
                  <thead>
                    <tr><th>พนักงาน</th><th>วันที่</th><th>กะ</th><th>เหตุผล</th><th>สถานะ</th></tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 50).map((row, index) => {
                      const draftKey = `${text(row.employeeId)}_${inputDate(row.date)}`;
                      const hasDraft = Object.prototype.hasOwnProperty.call(scheduleDrafts, draftKey);
                      const preserved = Boolean(row.locked || row.preserved || row.existingShiftId || hasDraft);
                      return <tr key={`${text(row.employeeId)}-${text(row.date)}-${index}`} className={preserved ? 'auto-schedule-preview-preserved' : 'auto-schedule-preview-generated'}>
                        <td>{text(row.employeeName)}</td>
                        <td>{date(row.date)}</td>
                        <td><span className={`status-badge ${row.code === 'OFF' ? 'inactive' : 'active'}`}>{text(row.code)}</span></td>
                        <td>{text(row.remark)}</td>
                        <td><span className={`auto-schedule-origin ${preserved ? 'is-preserved' : 'is-generated'}`}>{hasDraft ? 'คงฉบับร่าง' : preserved ? 'คงกะเดิม' : 'เติมอัตโนมัติ'}</span></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>

              <div className="preview-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button className="btn-secondary" style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#0f1d2a', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}>ยกเลิก Preview</button>
                <button className="btn-primary compact" style={{ padding: '9px 20px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }} disabled={autoScheduleBusy || previewFillSummary.generated === 0} onClick={saveAutoSchedule}><SmsIcon name="settings" /> ใส่ลงในฉบับร่าง (ยังไม่บันทึก)</button>
              </div>
            </section>
          </div>
        )}
        <ErrorAlert message={operationError} />
        <SectionCard className="table-card calendar-card" kicker="ตารางกะ" title="ตารางเวรของเดือนที่เลือก" description="รายการจริงและฉบับร่างในตัวกรองปัจจุบัน กฎใบอนุญาตและการล็อกกะยังใช้เงื่อนไขเดิม">{operationLoading && !calendarEmployees.length ? <div className="loading-row">กำลังอ่านตารางกะรายเดือน…</div> : <div className="table-scroll schedule-grid-scroll" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return; const el = e.currentTarget; el.dataset.isDown = 'true'; el.dataset.startX = String(e.pageX - el.offsetLeft); el.dataset.startY = String(e.pageY - el.offsetTop); el.dataset.scrollLeft = String(el.scrollLeft); el.dataset.scrollTop = String(el.scrollTop); }} onMouseLeave={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseUp={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseMove={(e) => { const el = e.currentTarget; if (el.dataset.isDown !== 'true') return; e.preventDefault(); const x = e.pageX - el.offsetLeft; const y = e.pageY - el.offsetTop; const walkX = (x - Number(el.dataset.startX || 0)) * 1.5; const walkY = (y - Number(el.dataset.startY || 0)) * 1.5; el.scrollLeft = Number(el.dataset.scrollLeft || 0) - walkX; el.scrollTop = Number(el.dataset.scrollTop || 0) - walkY; }}><table className="schedule-grid"><thead><tr><th className="employee-sticky">พนักงาน</th>{dates.map((day) => { const dayValue = new Date(`${day}T00:00:00Z`); const weekend = [0, 6].includes(dayValue.getUTCDay()); const dayClasses = [weekend ? 'weekend' : '', day === todayScheduleDate ? 'today' : ''].filter(Boolean).join(' '); return <th key={day} className={dayClasses}><b>{dayValue.getUTCDate()}</b><small>{new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(dayValue)}</small></th>; })}</tr></thead><tbody>{calendarEmployees.length ? calendarEmployees.map((employee) => { const employeeShifts = Array.isArray(employee.shifts) ? employee.shifts as DataRow[] : []; const isSchedulingEmployee = employeeAutoScheduleBusyId === String(employee.id); return <tr key={text(employee.id)}><td className="employee-sticky"><strong>{text(employee.displayName || `${text(employee.firstName)} ${text(employee.lastName)}`)}{canManage && <button className="employee-magic-button" disabled={Boolean(employeeAutoScheduleBusyId)} title="🪄 จัดกะแพทเทิร์นด่วน: 6 วันทำงาน / 1 วันหยุด" onClick={() => openEmployeeScheduleWizard(employee)}>{isSchedulingEmployee ? '…' : <SmsIcon name="settings" />}</button>}</strong><small>{text(employee.employeeCode)} · {text(employee.department)}</small></td>{dates.map((day) => { const draftKey = `${employee.id}_${day}`; const draftItem = scheduleDrafts[draftKey]; const shift = employeeShifts.find((item) => inputDate(item.workDate) === day); const shiftType = nested(shift?.shiftType); const shiftCode = text(shiftType.code).toLowerCase(); const coreShift = ['d', 'n', 'off', 'al'].includes(shiftCode); const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()); const dayClassName = [weekend ? 'weekend' : '', day === todayScheduleDate ? 'today' : ''].filter(Boolean).join(' '); if (draftItem) { if (draftItem.action === 'delete') { return <td key={day} className={dayClassName}><div className="calendar-shift-wrap"><button className="empty-shift" style={{ color: '#ef4444', borderColor: '#fca5a5' }} title="กะถูกลบในฉบับร่าง (คลิกคืนค่า)" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}>✕ ลบแล้ว</button></div></td>; } const draftCore = ['d', 'n', 'off', 'al'].includes((draftItem.shiftCode || '').toLowerCase()); return <td key={day} className={dayClassName}><div className="calendar-shift-wrap"><button className={`calendar-shift shift-${(draftItem.shiftCode || 'd').toLowerCase()}`} style={draftCore ? { border: '2px dashed #2563eb' } : { backgroundColor: String(draftItem.color || '#64748B'), border: '2px dashed #2563eb' }} title="กะฉบับร่าง (ยังไม่ได้บันทึก)" onClick={(e) => canManage && openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day, shiftTypeId: String(draftItem.shiftTypeId || '') }, e)}><b>{text(draftItem.shiftCode)} *</b><small className="schedule-time">{text(draftItem.startTime)}–{text(draftItem.endTime)}</small><small className="shift-note" style={{ color: '#2563eb', fontWeight: 'bold' }}>ร่าง</small></button><button className="calendar-delete" aria-label={`ยกเลิกฉบับร่าง ${day}`} title="ยกเลิกฉบับร่าง" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}><SmsIcon name="close" size={14} /></button></div></td>; } return <td key={day} className={dayClassName}>{shift ? <div className="calendar-shift-wrap"><button className={`calendar-shift shift-${shiftCode}`} style={coreShift ? undefined : { backgroundColor: String(shiftType.color || '#64748B') }} title={`${text(shiftType.name)} · ${text(shift.startTime)}-${text(shift.endTime)}`} onClick={(e) => canManage && openShiftEditor(shift, {}, e)}><b>{text(shiftType.code).toUpperCase()}</b><small className={text(shiftType.code).toUpperCase() === 'OFF' ? 'schedule-shift-kind' : 'schedule-time'}>{text(shiftType.code).toUpperCase() === 'OFF' ? 'วันหยุด' : `${text(shift.startTime || '07:00')}–${text(shift.endTime || '19:00')}`}</small>{(() => {
  const licStatus = String(shift.licenseStatus || '').toUpperCase();
  const remarkStr = String(shift.remark || '');
  const isBlocked = ['EXPIRED', 'MISSING', 'INVALID'].includes(licStatus) || remarkStr.toLowerCase().includes('license block') || remarkStr.includes('ใบอนุญาตไม่ผ่าน');
  const isOverridden = licStatus === 'OVERRIDDEN';
  const isManual = shift.source === 'SMS_V3' && !isBlocked;
  return (
    <>
      {Boolean(shift.locked) && <span className="shift-note schedule-lock-marker" role="img" aria-label="กะล็อก" title="กะที่ล็อก"><SmsIcon name="shield" /></span>}
      {isManual && <small className="shift-note schedule-manual-label" data-label-type="manual" title="จัดกะผ่านผู้ใช้ในระบบ">MANUAL</small>}
      {isOverridden && <small className="shift-note" data-label-type="override" style={{ color: '#2563eb', fontWeight: 700, display: 'block' }}>OVERRIDE <SmsIcon name="shield" /></small>}
      {isBlocked && <small className="shift-note schedule-license-block" data-label-type="license-block" style={{ color: '#dc2626', fontWeight: 700, display: 'block' }}>License Block</small>}
    </>
  );
})()}</button>{canManage && <button className="calendar-delete" aria-label={`ลบกะ ${day}`} onClick={() => { const key = `${employee.id}_${day}`; setScheduleDrafts((prev) => ({ ...prev, [key]: { action: 'delete', id: String(shift.id), employeeId: String(employee.id), workDate: day } })); }}><SmsIcon name="close" size={14} /></button>}</div> : canManage ? <button className="empty-shift" title="เพิ่มกะ" onClick={(e) => openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day }, e)}>+</button> : <span className="empty-shift read-only">–</span>}</td>; })}</tr>; }) : <tr><td colSpan={dates.length + 1} className="no-rows">ไม่มีพนักงานหรือตารางกะในตัวกรองนี้</td></tr>}</tbody></table></div>}</SectionCard>
        {(operationLoading || (operationResponse.meta?.totalPages || 0) > 1) && <div className="pagination-bar"><button disabled={operationLoading || (operationResponse.meta?.page || 1) <= 1} onClick={() => setOperationPage((operationResponse.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>{operationLoading ? 'หน้า — จาก —' : `หน้า ${operationResponse.meta?.page} จาก ${operationResponse.meta?.totalPages}`}</span><button disabled={operationLoading || (operationResponse.meta?.page || 1) >= (operationResponse.meta?.totalPages || 0)} onClick={() => setOperationPage((operationResponse.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}
        {employeeAutoScheduleTarget && <EmployeeMagicWandModal target={employeeAutoScheduleTarget} scheduleMonth={scheduleMonth} token={auth.token} busy={Boolean(employeeAutoScheduleBusyId)} onClose={() => setEmployeeAutoScheduleTarget(undefined)} onSubmit={async (autoContinue, startPhase, patternType) => { if (!auth.token || !employeeAutoScheduleTarget || employeeAutoScheduleBusyId) return; const employeeId = String(employeeAutoScheduleTarget.id || ''); if (!employeeId) return; const phase = autoContinue ? 'AUTO' : startPhase; setEmployeeAutoScheduleBusyId(employeeId); setOperationError(undefined); try { const result = await api.previewEmployeeAutoSchedule(auth.token, scheduleMonth, employeeId, phase, patternType); const rows = Array.isArray(result?.data?.rows) ? result.data.rows as DataRow[] : []; applyPreviewToDrafts(rows, employeeId); setEmployeeAutoScheduleTarget(undefined); } catch (reason) { setOperationError(toRequestErrorState(reason, 'สร้างฉบับร่างจัดกะอัตโนมัติรายบุคคลไม่สำเร็จ')); } finally { setEmployeeAutoScheduleBusyId(undefined); } }} />}
        {shiftEditorTarget && (
          <ShiftEditorModal
            shift={shiftEditorTarget.shift}
            defaults={shiftEditorTarget.defaults}
            employees={calendarEmployees.length ? calendarEmployees : (Array.isArray(operationResponse.data) ? operationResponse.data as DataRow[] : [])}
            shiftTypes={activeShiftTypes}
            licenses={licensesData}
            isAdmin={auth.user?.role === 'ADMIN'}
            onClose={() => setShiftEditorTarget(null)}
            onSubmit={(data) => {
              const key = `${data.employeeId}_${data.workDate}`;
              const selectedType = activeShiftTypes.find((t) => String(t.id) === data.shiftTypeId);
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
        return <LeaveManagementPage mode={activePage === 'leavePending' ? 'pending' : activePage === 'leaveHistory' ? 'history' : 'all'} historyScope={activePage === 'leaveHistory' ? 'all' : 'mine'} historyMonth={activePage === 'leaveHistory' ? leaveMonth : undefined} historyTotal={activePage === 'leaveHistory' ? operationResponse.meta?.total : undefined} historyPage={activePage === 'leaveHistory' ? operationResponse.meta?.page : undefined} historyTotalPages={activePage === 'leaveHistory' ? operationResponse.meta?.totalPages : undefined} historyStatusCounts={activePage === 'leaveHistory' ? operationResponse.meta?.statusCounts : undefined} employeeId={String(leaveSummary.employeeId || '')} currentUserId={auth.user?.id} currentUserRole={auth.user?.role} leavePolicy={leavePolicy} leaveTypes={activeLeaveTypes} rows={rows} loading={operationLoading} error={operationError} linked={Boolean(leaveSummary.linked)} remaining={remaining} quotaSummary={leaveSummary} quotaYear={Number(leaveSummary.quotaYear || currentBangkokQuotaYear())} canManage={pwaShell ? false : canManage} canSubmit={(pwaShell ? pwaOnline : true) && (auth.user?.role !== 'VIEWER' || Boolean(leaveSummary.linked))} canCancelApprovedLeave={canCancelApprovedLeave} mutationsEnabled={!pwaShell || pwaOnline} employeeOptions={employeeOptions} onRefresh={() => setOperationRefresh((value) => value + 1)} onHistoryMonthChange={changeLeaveMonth} onHistoryMonthStep={(delta) => changeLeaveMonth(shiftMonthValue(leaveMonth, delta))} onHistoryPageChange={setOperationPage} onApprove={(row) => handleOperationAction(row, 'approve')} onReject={(row) => handleOperationAction(row, 'reject')} onReturnForCorrection={(row) => handleOperationAction(row, 'return')} onEditReturned={(row) => runEditor({
          title: `แก้ไขคำขอลา · ${text(row.employeeNameSnapshot)}`,
          submitLabel: 'บันทึกและส่งตรวจสอบอีกครั้ง',
          fields: [
            { name: 'leaveType', label: 'ประเภทการลา', type: 'select', required: true, options: leaveTypeOptionsForRow(row) },
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
      const ruleMonthAnchor = currentBangkokMonth();
      const ruleMonthOptions = [...new Set([
        ...Array.from({ length: 24 }, (_, index) => shiftMonthValue(ruleMonthAnchor, index - 12)),
        normalizeMonthValue(scheduleMonth),
      ])].sort();
      const results = Array.isArray(ruleCheckResponse.ruleResults) ? ruleCheckResponse.ruleResults as DataRow[] : [];
      const violations = Array.isArray(ruleCheckResponse.violations) ? ruleCheckResponse.violations as DataRow[] : [];
      const metrics = nested(ruleCheckResponse.metrics);
      return <section className="view-pane layout-roster-page layout-page-surface"><PageHeader kicker="ตารางและกฎการทำงาน" title="ตรวจสอบกฎการทำงาน" description="ตรวจตารางกะในเดือนที่เลือกกับกฎการทำงานจากระบบ" actions={<div className="heading-actions"><label className="month-filter"><span>เดือน</span><select value={scheduleMonth} onChange={(event) => { setScheduleMonth(event.target.value); setOperationPage(1); }} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '13px', backgroundColor: '#0f1d2a', color: '#e2e8f0' }}>{ruleMonthOptions.map((value) => <option key={value} value={value}>{formatThaiMonth(value)}</option>)}</select></label><button className="btn-neutral small-action" onClick={() => setOperationRefresh((value) => value + 1)}>ตรวจสอบอีกครั้ง</button></div>} />
        <ErrorAlert message={operationError} />
        <div className="rule-summary-grid"><MetricCard label="รายการขัดกฎทั้งหมด" value={operationLoading || operationError ? '—' : text(metrics.violations)} description="รายการขัดกฎในผลที่โหลด" icon="quality" /><MetricCard label="กฎที่ผ่าน" value={operationLoading || operationError ? '—' : `${text(metrics.rulesPassed)} / ${text(metrics.rulesChecked)}`} description="กฎที่ผ่านเทียบกับกฎที่ตรวจ" icon="check" /><MetricCard label="พนักงานที่ปฏิบัติงาน" value={operationLoading || operationError ? '—' : text(metrics.activeEmployees)} description="จำนวนจากผลตรวจของระบบ" icon="employees" /><MetricCard label="ชั่วโมงรวม" value={operationLoading || operationError ? '—' : text(metrics.totalHours)} description="ชั่วโมงตามข้อมูลที่ใช้ตรวจกฎ" icon="clock" /></div>
        <RuleCheckingDataSurfaces rules={rules} results={results} violations={violations} loading={operationLoading} canManage={canManage} onAction={(row, action) => handleOperationAction(row, action)} />
      </section>;
    }
    if (activePage === 'attendance' && auth.token) {
      return <AttendanceSimplePage
        token={auth.token}
        displayName={auth.user?.displayName}
        department={auth.user?.department}
        readOnly={auth.isViewingAs}
        online={!pwaShell || pwaOnline}
        employeeV4={pwaShell}
        onTodayHistory={() => selectPwaPage('attendanceHistory', { today: true })}
        onOpenSettings={() => selectPwaPage('profile')}
        onOpenAttendanceDevice={() => selectPwaPage('attendanceDevice')}
        onOpenSupervisor={pwaShell && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs ? openPwaAttendanceSupervisor : undefined}
      />;
    }
    if (activePage === 'attendanceSupervisor' && auth.token && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs) {
      return <AttendanceSupervisorPage token={auth.token} role={auth.user?.role || 'VIEWER'} department={auth.user?.department} userId={auth.user?.id} onOpenAttendanceReport={!pwaShell && auth.user?.role === 'ADMIN' ? () => setActivePage('attendanceReport') : undefined} onApprovalQueueChanged={() => { setOperationRefresh((value) => value + 1); setApprovalCenterRefresh((value) => value + 1); }} />;
    }
    if (activePage === 'attendanceHistory' && auth.token && pwaShell) {
      return <AttendanceHistoryPwaPage token={auth.token} online={pwaOnline} />;
    }
    if (activePage === 'employeeSchedule' && auth.token && pwaShell) {
      return <AttendanceSchedulePwaPage token={auth.token} online={pwaOnline} />;
    }
    if (activePage === 'profile' && auth.token) {
      return <PwaProfilePage user={auth.user} online={pwaOnline} readOnly={auth.isViewingAs} onOpenPasskeys={() => setPasskeyPanelOpen(true)} onLogout={() => auth.logout()} />;
    }
    if (activePage === 'attendanceDevice' && auth.token) {
      return <AttendanceDevicePage token={auth.token} role={auth.user?.role || 'VIEWER'} readOnly={auth.isViewingAs} onApprovalQueueChanged={() => { setOperationRefresh((value) => value + 1); setApprovalCenterRefresh((value) => value + 1); }} />;
    }
    if (activePage === 'users') {
      const users = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <div className="users-access-workspace layout-personnel-page layout-page-surface">
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
          onProvisionG06Uat={async () => {
            const response = await api.provisionG06Uat(auth.token!);
            setOperationRefresh((value) => value + 1);
            return (response as { data: G06UatProvisionResult }).data;
          }}
        />
        <RegistrationReviewPanel token={auth.token!} role={auth.user?.role || 'VIEWER'} refreshSignal={operationRefresh} initialRequestId={registrationReviewInitialRequestId} onInitialRequestHandled={() => setRegistrationReviewInitialRequestId(undefined)} onChanged={() => setOperationRefresh((value) => value + 1)} onOpenEmployeeMaster={() => setActivePage('employees')} />
      </div>;
    }
    if (activePage === 'securitySite' && auth.token) {
      return <SecuritySiteManagementPanel token={auth.token} />;
    }
    if (activePage === 'settings') {
      const settings = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <SettingsPage token={auth.token!} settings={settings} leaveTypes={leaveTypes} leaveTypesLoading={leaveTypesLoading} loading={operationLoading} error={operationError} section={activeSettingsSection} onSectionChange={setSettingsSection} onRefresh={() => setOperationRefresh((value) => value + 1)} onAudit={() => setActivePage('audit')} onSaveTemplates={async (newLeave, leaveStatus) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_NEW_LEAVE', { value: newLeave, description: 'เทมเพลตข้อความคำขอลาใหม่ (รูปแบบเดิม)' }), api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_LEAVE_STATUS', { value: leaveStatus, description: 'เทมเพลตข้อความอัปเดตสถานะการลา (รูปแบบเดิม)' })]); setOperationRefresh((value) => value + 1); }} onSaveAttendancePolicy={async (policy) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, attendancePolicyKeys.qrPolicy, { value: policy.qrPolicy, description: 'Attendance QR policy: ADAPTIVE / REQUIRED / DISABLED' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.maxAccuracyMeters, { value: String(policy.maxAccuracyMeters), description: 'GPS accuracy สูงสุดที่ Attendance ยอมรับ (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.maxAgeSeconds, { value: String(policy.maxAgeSeconds), description: 'อายุ GPS sample สูงสุด (วินาที)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.futureSkewSeconds, { value: String(policy.futureSkewSeconds), description: 'GPS future clock skew สูงสุด (วินาที)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.autoPassAccuracyMeters, { value: String(policy.autoPassAccuracyMeters), description: 'GPS accuracy สำหรับข้าม QR ใน Adaptive mode (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.innerMarginMeters, { value: String(policy.innerMarginMeters), description: 'ระยะจากขอบ geofence ที่ใช้ตัดสิน QR Step-up (เมตร)' }), api.updateSystemSetting(auth.token, attendancePolicyKeys.stepUpOnSiteOverlap, { value: String(policy.stepUpOnSiteOverlap), description: 'ขอ QR Step-up เมื่อ GPS อยู่ในหลาย Site พร้อมกัน' })]); setOperationRefresh((value) => value + 1); }} onSaveLeavePolicy={async (policy) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, leavePolicyKeys.defaultSickDays, { value: String(policy.defaultSickDays) }), api.updateSystemSetting(auth.token, leavePolicyKeys.defaultPersonalDays, { value: String(policy.defaultPersonalDays) }), api.updateSystemSetting(auth.token, leavePolicyKeys.defaultVacationDays, { value: String(policy.defaultVacationDays) }), api.updateSystemSetting(auth.token, leavePolicyKeys.sickAttachmentRequiredAfterDays, { value: String(policy.sickAttachmentRequiredAfterDays) }), api.updateSystemSetting(auth.token, leavePolicyKeys.managerRetroactiveOnBehalfEnabled, { value: String(policy.managerRetroactiveOnBehalfEnabled) }), api.updateSystemSetting(auth.token, leavePolicyKeys.managerRetroactiveMaxDaysBack, { value: String(policy.managerRetroactiveMaxDaysBack) })]); setOperationRefresh((value) => value + 1); }} onCreateLeaveType={async (input) => { if (!auth.token) return; await createLeaveType(auth.token, input); setOperationRefresh((value) => value + 1); }} onUpdateLeaveType={async (id, input) => { if (!auth.token) return; await updateLeaveType(auth.token, id, input); setOperationRefresh((value) => value + 1); }} />;
    }
    if ((activePage === 'reportCenter' || activePage === 'executiveReport' || activePage === 'reports' || activePage === 'attendanceReport') && auth.token) {
      const initialTab = activePage === 'attendanceReport' ? 'export' : activePage === 'reports' ? 'details' : 'executive';
      return <ReportCenterPage key={activePage} token={auth.token} role={auth.user?.role || 'VIEWER'} initialTab={initialTab} onNavigate={(page) => setActivePage(page as Page)} />;
    }
    if (activePage === 'quota') return <section className="view-pane layout-roster-page layout-page-surface"><PageHeader kicker="สิทธิ์การลารายปี" title={`โควตาวันลา ${showLegacyQuotas ? 'ข้อมูลเดิม' : thaiQuotaYearLabel(quotaYear)}`} description={showLegacyQuotas ? 'ข้อมูลเดิมที่ยังไม่ระบุปี ต้องจัดประเภทก่อนใช้งานรายปี' : 'สิทธิ์รายปีแยกตามพนักงานและปี ตรวจข้อมูลจริงก่อนกำหนดโควตา'} actions={<div className="heading-actions"><label className="month-filter"><span>ปีสิทธิ์</span><select aria-label="ปีสิทธิ์โควตาวันลา" disabled={showLegacyQuotas} value={quotaYear} onChange={(event) => setQuotaYear(Number(event.target.value))}>{quotaYearOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="btn-neutral small-action" type="button" onClick={() => setShowLegacyQuotas((value) => !value)}>{showLegacyQuotas ? 'กลับรายการรายปี' : 'ดูข้อมูลเดิมที่ยังไม่ระบุปี'}</button></div>} /><OperationalTable page={activePage as OperationalPage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} onNavigate={setActivePage} role={auth.user?.role || 'VIEWER'} token={auth.token} refreshSignal={operationRefresh} onLicenseDocumentChanged={() => setOperationRefresh((value) => value + 1)} printedBy={`${auth.user?.displayName || auth.user?.email || 'ผู้ใช้งาน'} · ${roleDisplayName(auth.user?.role)}`} /></section>;
    return <><OperationalTable page={activePage as OperationalPage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} onNavigate={setActivePage} role={auth.user?.role || 'VIEWER'} token={auth.token} refreshSignal={operationRefresh} onLicenseDocumentChanged={() => setOperationRefresh((value) => value + 1)} onEditLicense={activePage === 'licenses' ? openLicenseEdit : undefined} licenseEmployeeStatus={licenseEmployeeStatus} onLicenseEmployeeStatusChange={setLicenseEmployeeStatus} printedBy={`${auth.user?.displayName || auth.user?.email || 'ผู้ใช้งาน'} · ${roleDisplayName(auth.user?.role)}`} />{licenseEditTarget && auth.token && <LicenseEditModal license={{ id: String(licenseEditTarget.id), licenseNumber: licenseEditTarget.licenseNumber ? String(licenseEditTarget.licenseNumber) : null, licenseType: licenseEditTarget.licenseType ? String(licenseEditTarget.licenseType) : null, issueDate: licenseEditTarget.issueDate ? String(licenseEditTarget.issueDate) : null, expiryDate: licenseEditTarget.expiryDate ? String(licenseEditTarget.expiryDate) : null, status: licenseEditTarget.status ? String(licenseEditTarget.status) : null, employee: { employeeCode: String(nested(licenseEditTarget.employee).employeeCode || ''), firstName: String(nested(licenseEditTarget.employee).firstName || ''), lastName: String(nested(licenseEditTarget.employee).lastName || ''), department: nested(licenseEditTarget.employee).department ? String(nested(licenseEditTarget.employee).department) : undefined } }} isAdmin={auth.user?.role === 'ADMIN'} currentUserId={auth.user?.id || ''} services={licenseDocumentServices} onUpload={async (data, file) => { await api.uploadLicenseDocument(auth.token!, String(licenseEditTarget.id), data, file); }} onChanged={() => setOperationRefresh((value) => value + 1)} onClose={() => setLicenseEditTarget(undefined)} />}</>;
  };

  const printData = useMemo(() => {
    if (activePage !== 'schedule') return null;
    const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
    const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
    const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
    const allCalendarEmployees = sortScheduleEmployeesByDepartment(rawCalendarEmployees);
    const calendarEmployees = selectedDepartments.length > 0
      ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
      : allCalendarEmployees;
    const approval = nested(calendar.approval);
    const [yStr, mStr] = scheduleMonth.split('-');
    const thaiYearNum = Number(yStr) + 543;
    const monthNameOnly = formatThaiMonthName(Number(mStr), Number(yStr));
    const printMonthLabel = `${monthNameOnly} ${thaiYearNum}`;
    const printDepartments = Array.from(new Set(calendarEmployees.map((e) => String(e.department ?? '').trim())));

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
      {!pwaShell && <WorkflowCommandPalette open={commandPaletteOpen} items={workflowCommands} onClose={() => setCommandPaletteOpen(false)} onNavigate={(id) => setActivePage(id as Page)} />}
      {leaveDecision && <React.Suspense fallback={<div className="full-loader" role="status">กำลังโหลดหน้าต่างยืนยัน…</div>}><LeaveDecisionConfirmation
        target={leaveDecision.target}
        action={leaveDecision.action}
        busy={operationLoading}
        error={operationError}
        onClose={() => { if (!operationLoading) setLeaveDecision(undefined); }}
        onConfirm={confirmLeaveDecision}
      /></React.Suspense>}
      <div
        className={`app-shell ${desktopView ? 'desktop-view' : ''} ${auth.isViewingAs ? 'view-as-active' : ''} ${pwaShell ? `pwa-shell pwa-page-${activePage}` : ''}`}
        style={{ backgroundColor: 'var(--surface-page, #020813)', color: 'var(--text-on-surface, #f1f5f9)' }}
      >
      {editor && <EditDialog editor={editor} busy={editorBusy} error={editorError} onClose={() => { setEditor(undefined); setEditorError(undefined); }} />}
      {employeeGovernedEditTarget && auth.token && !auth.isViewingAs && <React.Suspense fallback={<div className="full-loader" role="status">กำลังโหลดหน้าต่าง…</div>}><EmployeeGovernedEditModal token={auth.token} employee={employeeGovernedEditTarget} role={auth.user?.role || 'VIEWER'} onClose={() => setEmployeeGovernedEditTarget(undefined)} onChanged={() => setEmployeeRefresh((value) => value + 1)} /></React.Suspense>}
      {employeeChangeReviewOpen && auth.token && auth.user?.role === 'ADMIN' && !auth.isViewingAs && <React.Suspense fallback={<div className="full-loader" role="status">กำลังโหลดหน้าต่าง…</div>}><EmployeeChangeReviewModal token={auth.token} initialRequestId={employeeChangeReviewInitialId} onClose={() => { setEmployeeChangeReviewOpen(false); setEmployeeChangeReviewInitialId(undefined); }} onChanged={() => { setEmployeeRefresh((value) => value + 1); setApprovalCenterRefresh((value) => value + 1); }} /></React.Suspense>}
      {auth.isViewingAs && <div className="view-as-banner" role="status"><span><SmsIcon name="eye" size={16} /> กำลังดูระบบในมุมมอง <strong>{auth.user?.displayName}</strong> ({roleDisplayName(auth.user?.role)}) · อ่านอย่างเดียว</span><button type="button" onClick={() => { auth.endViewAs(); setActivePage('users'); }}>กลับสู่บัญชี Admin</button></div>}
      {mobileMenuOpen && <button className="sidebar-overlay" aria-label="ปิดเมนูหลัก" aria-controls="app-navigation-drawer" onClick={() => setMobileMenuOpen(false)} />}
      <aside id="app-navigation-drawer" className={`sidebar ${mobileMenuOpen ? 'open' : ''}`} aria-label="เมนูหลัก">
        <div className="sidebar-brand">
          <BrandLogo />
          <button type="button" className="sidebar-close-button" aria-label="ปิดเมนูหลัก" onClick={() => setMobileMenuOpen(false)}><SmsIcon name="close" size={20} /></button>
        </div>
        <nav className="nav-menu" aria-label="เมนูหลัก">{visibleNavigation.map((section) => (
          <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map((item) => {
            const roleCanSeeCount = Boolean(auth.user?.role && APPROVAL_COUNT_MENU_ROLES[item.id]?.includes(auth.user.role));
            const countEnabled = roleCanSeeCount && !pwaShell && !auth.isViewingAs && Boolean(auth.token);
            const menuCount = countEnabled ? approvalMenuCount(item.id, approvalSummary) : null;
            const badge = approvalBadgeText(menuCount);
            const countStateTitle = countEnabled && approvalCountStatus === 'loading' ? 'กำลังโหลดจำนวนรายการรออนุมัติ' : countEnabled && approvalCountStatus === 'error' ? 'โหลดจำนวนรายการรออนุมัติไม่สำเร็จ' : undefined;
            const countStateLabel = countStateTitle ? `${item.label}, ${countStateTitle}` : undefined;
            const countTitle = badge && menuCount !== null ? `${menuCount} รายการรออนุมัติ` : countStateTitle;
            return <button type="button" key={item.id} data-navigation-id={item.id} aria-label={badge ? `${item.label}, ${countTitle}` : countStateLabel} title={countTitle} className={`nav-item ${navigationPage === item.id ? 'active' : ''} ${badge ? 'has-approval-count' : ''}`} onClick={() => { setActivePage(item.id); setMobileMenuOpen(false); }}><span className="nav-icon"><SmsIcon name={item.icon} size={19} /></span><span>{item.label}{badge && <b className="nav-count-badge" aria-hidden="true">{badge}</b>}</span></button>;
          })}</div>
        ))}</nav>
        <div className="sidebar-footer">
          <div className="sidebar-user sidebar-profile"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{roleDisplayName(auth.user?.role || 'VIEWER')}</small></span></div>
          <button type="button" className="sidebar-logout" onClick={() => auth.logout()}><SmsIcon name="logout" size={18} /><span>ออกจากระบบ</span></button>
        </div>
      </aside>
      <main className="main-area">
        {pwaShell && activePage !== 'attendance' && <header className="pwa-mobile-header"><span className="pwa-mobile-brand"><BrandLogo tone="dark-surface" /></span><span className={`pwa-online-state ${pwaOnline ? '' : 'offline'}`}>{pwaOnline ? 'ออนไลน์' : 'ออฟไลน์'}</span></header>}
        {pwaShell && !pwaOnline && <div className="pwa-offline-banner">ออฟไลน์ — เปิดดู shell ได้ แต่การลงเวลาและการส่งคำขอลาต้องรอการเชื่อมต่อ Server</div>}
        <header className="topbar">
          <div className="topbar-left">
            <button ref={mobileMenuTriggerRef} type="button" className="mobile-menu-button" aria-label="เปิดเมนูหลัก" aria-expanded={mobileMenuOpen} aria-controls="app-navigation-drawer" onClick={() => setMobileMenuOpen(true)}><SmsIcon name="menu" size={20} /></button>
            <span className="mobile-brand"><BrandLogo /></span>
            <span className="topbar-copy"><strong>{pageTitle}</strong><small>{pageSubtitle[navigationPage]}</small></span>
          </div>
          <label className="topbar-search"><span aria-hidden="true"><SmsIcon name="search" size={17} /></span><input aria-label="ค้นหาพนักงาน" placeholder="ค้นหาพนักงาน..." value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && activePage !== 'employees') setActivePage('employees'); }} /></label>
          <div className="topbar-actions">
            {!pwaShell && <button type="button" className="workflow-command-trigger" title="ไปยังงานหรือหน้าที่ต้องการ" onClick={() => setCommandPaletteOpen(true)}><SmsIcon name="search" size={16} /><span>เมนูด่วน</span><kbd>Ctrl K</kbd></button>}
            <span className="environment-pill">{import.meta.env.PROD ? 'DEPLOYED' : 'LOCAL'}</span>
            {['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs && <ApprovalCenterNotificationButton count={approvalMenuCount('approvalCenter', approvalSummary)} onClick={() => setActivePage('approvalCenter')} />}
            <ThemeControl compact />
            <button type="button" className="display-mode-toggle" aria-pressed={desktopView} title={desktopView ? 'กลับมุมมองมือถือ' : 'แสดงแบบเดสก์ท็อป'} onClick={toggleDesktopView}><SmsIcon name={desktopView ? 'device' : 'system'} size={16} /><span>{desktopView ? 'Mobile' : 'Desktop'}</span></button>
            <button type="button" className="topbar-profile topbar-profile-button" title="การเข้าสู่ระบบและ Passkey" onClick={() => setPasskeyPanelOpen(true)}><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{roleDisplayName(auth.user?.role || 'VIEWER')}</small></span></button>
            <button ref={mobileUtilityTriggerRef} type="button" className="mobile-utility-button" aria-label="เปิดเมนูบัญชีและธีม" aria-expanded={mobileUtilityOpen} aria-controls="mobile-utility-panel" onClick={() => setMobileUtilityOpen((value) => !value)}><SmsIcon name="more" size={20} /></button>
          </div>
          {mobileUtilityOpen && createPortal(<>
            <button type="button" className="mobile-utility-backdrop" aria-label="ปิดเมนูบัญชีและธีม" onClick={() => setMobileUtilityOpen(false)} />
            <div id="mobile-utility-panel" className="mobile-utility-panel" role="dialog" aria-modal="true" aria-label="บัญชีและการตั้งค่าหน้าจอ">
              <div className="mobile-utility-profile"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{roleDisplayName(auth.user?.role || 'VIEWER')}</small></span></div>
              <label className="mobile-utility-search"><span aria-hidden="true"><SmsIcon name="search" size={17} /></span><input aria-label="ค้นหาพนักงานบนมือถือ" placeholder="ค้นหาพนักงาน..." value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && activePage !== 'employees') setActivePage('employees'); }} /></label>
              <button type="button" className="mobile-utility-security" onClick={() => { setMobileUtilityOpen(false); setCommandPaletteOpen(true); }}><SmsIcon name="search" size={18} />ไปยังงานหรือหน้าอื่น</button>
              <div className="mobile-utility-theme"><span>Theme</span><ThemeControl /></div>
              <button type="button" className="mobile-utility-display-mode" aria-pressed={desktopView} onClick={toggleDesktopView}><SmsIcon name={desktopView ? 'device' : 'system'} size={16} />{desktopView ? 'กลับมุมมองมือถือ' : 'แสดงแบบเดสก์ท็อป'}</button>
              <button type="button" className="mobile-utility-security" onClick={() => { setMobileUtilityOpen(false); setPasskeyPanelOpen(true); }}><SmsIcon name="key" size={18} />การเข้าสู่ระบบและ Passkey</button>
              <button type="button" className="mobile-utility-logout" onClick={() => auth.logout()}><SmsIcon name="logout" size={18} />ออกจากระบบ</button>
            </div>
          </>, document.body)}
        </header>
        <div className="content-area"><React.Suspense fallback={<AppLoader variant="content" message={loadingMessages.page} />}>{content()}</React.Suspense></div>
        {pwaShell && <nav className="pwa-bottom-nav" aria-label="เมนู PWA">
          <button type="button" className={activePage === 'attendance' ? 'active' : ''} onClick={() => selectPwaPage('attendance')}><SmsIcon name="clock" size={20} /><span>ลงเวลา</span></button>
          <button type="button" className={activePage === 'attendanceHistory' ? 'active' : ''} onClick={() => selectPwaPage('attendanceHistory')}><SmsIcon name="history" size={20} /><span>ประวัติ</span></button>
          <button type="button" className={activePage === 'employeeSchedule' ? 'active' : ''} onClick={() => selectPwaPage('employeeSchedule')}><SmsIcon name="calendar" size={20} /><span>ตารางงาน</span></button>
          <button type="button" className={activePage === 'leave' ? 'active' : ''} onClick={() => selectPwaPage('leave')}><SmsIcon name="leave" size={20} /><span>ลา</span></button>
          <button type="button" className={activePage === 'profile' ? 'active' : ''} onClick={() => selectPwaPage('profile')}><SmsIcon name="users" size={20} /><span>โปรไฟล์</span></button>
        </nav>}
      </main>
    </div>
    {passkeyPanelOpen && auth.token && <React.Suspense fallback={<div className="full-loader" role="status">กำลังโหลดหน้าต่าง…</div>}><PasskeySecurityPanel token={auth.token} onClose={() => setPasskeyPanelOpen(false)} /></React.Suspense>}
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
          const deptEmployees = printData.calendarEmployees.filter((e) => String(e.department ?? '').trim() === dept);
          return (
            <div className="print-page" key={dept}>
              <div className="print-header">
                Security Management System - ตารางกะที่อนุมัติแล้ว - {printData.printMonthLabel}
              </div>
              <div className="print-metadata">
                <div className="print-metadata-left">
                  <span>แผนก: <strong>{dept || 'ทั่วไป'}</strong></span>
                  <span style={{ marginLeft: '12px' }}>ฉบับแก้ไข: <strong>{text(printData.approval.revision || 1)}</strong></span>
                  <span style={{ marginLeft: '12px' }}>อนุมัติโดย: <strong>{text(printData.approval.approvedBy || printData.approval.approvedByDisplayName || roleDisplayName('ADMIN'))}</strong></span>
                  <span style={{ marginLeft: '12px' }}>วันที่อนุมัติ: <strong>{printData.approval.approvedAt ? formatApprovalDateTime(printData.approval.approvedAt) : '-'}</strong></span>
                </div>
                <div className="print-metadata-right">
                  <span>ส่งออกโดย: <strong>{auth.user?.email || roleDisplayName('ADMIN')}</strong></span>
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
                  <tr className="schedule-department-group-row print-department-group-row">
                    <th className="schedule-department-group-sticky" scope="rowgroup" colSpan={printData.dates.length + 4}>
                      {dept || 'ไม่ระบุแผนก'} · {deptEmployees.length} คน
                    </th>
                  </tr>
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
    {actionDialog.dialog}
    </>
  );
}

const G06DeviceContextDiagnostic = React.lazy(() => import('./pages/attendance-device/G06DeviceContextDiagnosticPage').then(({ G06DeviceContextDiagnosticPage }) => ({ default: G06DeviceContextDiagnosticPage })));

function OfflineAttendanceGate() {
  const [state, setState] = useState<'CHECKING' | 'AVAILABLE' | 'UNAVAILABLE'>('CHECKING');

  useEffect(() => {
    let active = true;
    if (navigator.onLine) {
      setState('UNAVAILABLE');
      return () => { active = false; };
    }
    readEncryptedBootstrap<SimpleBootstrap>()
      .then((cached) => {
        if (!active) return;
        const expiresAt = cached?.offline?.expiresAt ? new Date(cached.offline.expiresAt) : null;
        setState(cached && expiresAt && !Number.isNaN(expiresAt.getTime()) && Date.now() <= expiresAt.getTime() ? 'AVAILABLE' : 'UNAVAILABLE');
      })
      .catch(() => { if (active) setState('UNAVAILABLE'); });
    return () => { active = false; };
  }, []);

  if (state === 'CHECKING') return <AppLoader message={loadingMessages.offlineCheck} />;
  if (state !== 'AVAILABLE') return <Login />;
  return <React.Suspense fallback={<AppLoader message={loadingMessages.offlineOpen} />}>
    <AttendanceSimplePage online={false} />
  </React.Suspense>;
}

function SessionConnectionError({ onRetry }: { onRetry: () => void }) {
  return <main className="full-loader auth-connection-error" role="alert" aria-live="assertive">
    <section aria-labelledby="auth-connection-error-title" style={{ maxWidth: 560, textAlign: 'center', padding: 24 }}>
      <h1 id="auth-connection-error-title">เชื่อมต่อระบบไม่ได้</h1>
      <p>ระบบฐานข้อมูลตอบสนองชั่วคราวไม่ได้ เซสชันเดิมยังไม่ถูกล้าง กรุณาลองใหม่อีกครั้ง</p>
      <button type="button" className="btn-primary" onClick={onRetry}>ลองใหม่</button>
    </section>
  </main>;
}

function RouteNotice({ kind }: { kind: 'not-found' | 'forbidden' }) {
  const notFound = kind === 'not-found';
  return <main className="full-loader" role="main">
    <section aria-labelledby="route-notice-title" style={{ maxWidth: 560, textAlign: 'center', padding: 24 }}>
      <h1 id="route-notice-title">{notFound ? 'ไม่พบหน้าที่ต้องการ' : 'ไม่มีสิทธิ์เข้าถึงหน้านี้'}</h1>
      <p>{notFound ? 'ตรวจสอบที่อยู่หน้าเว็บ หรือกลับไปยังภาพรวม' : 'บัญชีนี้ไม่มีสิทธิ์เปิดหน้านี้'}</p>
      <button type="button" className="btn-primary" onClick={() => navigate('dashboard')}>กลับไปภาพรวม</button>
    </section>
  </main>;
}

function App() {
  const auth = useContext(AuthContext)!;
  const [route, setRoute] = useState<RouteResolution>(() => pageFromLocation());

  useEffect(() => subscribeToRouteChanges(() => setRoute(pageFromLocation())), []);
  useEffect(() => {
    if (auth.token && canViewRoutePage('settings', auth) && route.kind === 'page' && route.page === 'settings' && window.location.pathname.replace(/\/+$/, '') === '/app/settings') {
      navigateSettingsSection('overview', { replace: true });
    }
  }, [auth.isViewingAs, auth.token, auth.user?.role, route]);
  useEffect(() => {
    if (auth.loading) return;
    const forbidden = route.kind === 'page' && Boolean(auth.token) && !canViewRoutePage(route.page, auth);
    updateDocumentTitle(route.kind === 'page' ? route.page : null, route.kind === 'not-found' ? 'not-found' : forbidden ? 'forbidden' : 'page', settingsSectionFromPath(window.location.pathname));
  }, [auth.isViewingAs, auth.loading, auth.token, auth.user?.role, route]);

  if (auth.loading) return <AppLoader message={loadingMessages.session} />;
  if (auth.refreshState === 'unavailable') return <SessionConnectionError onRetry={() => { void auth.retryRefresh().catch(() => undefined); }} />;
  if (!auth.token) return <OfflineAttendanceGate />;
  if (shouldOpenG06DeviceContextDiagnostic({ authenticated: Boolean(auth.token), diagnosticBuild: __SMSV3_G06_DEVICE_CONTEXT_DIAGNOSTIC__, search: window.location.search })) {
    return <React.Suspense fallback={<AppLoader message={loadingMessages.readOnly} />}><G06DeviceContextDiagnostic /></React.Suspense>;
  }
  if (route.kind === 'not-found') return <RouteNotice kind="not-found" />;
  if (!canViewRoutePage(route.page, auth)) return <RouteNotice kind="forbidden" />;
  return <Dashboard />;
}

const appRoot = document.getElementById('root')!;
const diagnosticQueryRequested = isG06DeviceContextDiagnosticRequested({
  diagnosticBuild: __SMSV3_G06_DEVICE_CONTEXT_DIAGNOSTIC__,
  search: window.location.search
});
if (!diagnosticQueryRequested) registerSmsPwa();
createRoot(appRoot).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
