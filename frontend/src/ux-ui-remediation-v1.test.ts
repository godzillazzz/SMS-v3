import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const tokens = read('./styles/tokens.css');
const signature = read('./styles/signature-experience-v1-1.css');
const authCss = read('./styles/auth-experience.css');
const remediationCss = read('./styles/ux-ui-remediation.css');
const approval = read('./pages/approvals/ApprovalCenterPage.tsx');
const approvalCss = read('./styles/approval-center.css');
const attendance = read('./pages/attendance/AttendancePage.tsx');
const attendanceDeviceProof = read('./pages/attendance/attendance-device-proof.ts');
const supervisor = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const personnel = read('./components/personnel/PersonnelTable.tsx');
const access = read('./pages/access-management/AccessManagementPage.tsx');
const reports = read('./pages/reports/ReportCenterPage.tsx');
const systemHealth = read('./pages/system-health/SystemHealthPage.tsx');
const overlay = read('./components/useAccessibleOverlay.ts');

describe('UXUI-REM-01 audited remediation contracts', () => {
  it('raises light-theme muted text contrast and exposes a keyboard skip link on authentication', () => {
    expect(tokens).toContain('--color-text-muted: #716c80;');
    expect(signature).toContain('--signature-text-muted: #66758a;');
    expect(authCss).toContain('.auth-skip-link');
    expect(authCss).toContain('.auth-form input::placeholder { color: var(--color-text-muted); opacity: 1; }');
    expect(main).toContain('href="#auth-login-form"');
    expect(main).toContain('id="auth-login-form"');
  });

  it('exposes Approval Center selection semantics without mixing audit events into the approval queue', () => {
    expect(approval).toContain('aria-pressed={filter ===');
    expect(approval).toContain('aria-pressed={selected?.id === item.id}');
    expect(approval).toContain('summary.total');
    expect(approval).toContain('summary.byType?.[id]');
    expect(approval).not.toContain('api.auditEvents');
    expect(approval).not.toContain('บันทึกเหตุการณ์สด');
    expect(approval).toContain('ศูนย์อนุมัติ');
    expect(approval).toContain('overflow-x-hidden');
    expect(approvalCss).toContain('.nexus-approval-center{background:#020813!important');
  });

  it('standardizes modal focus management without changing Attendance authority calls', () => {
    expect(overlay).toContain("event.key === 'Escape'");
    expect(overlay).toContain("event.key !== 'Tab'");
    expect(overlay).toContain('acquireDocumentScrollLock');
    expect(attendance).toContain('useAccessibleOverlay<HTMLElement>(locationHelpOpen');
    expect(supervisor).toContain('useAccessibleOverlay<HTMLElement>(Boolean(manualDialog)');
    expect(access).toContain('useAccessibleOverlay<HTMLElement>(true, onClose');
    expect(attendance).toContain('attendanceVerificationStart(token');
    expect(attendanceDeviceProof).toContain('verifyAttendanceDeviceProof');
    expect(attendanceDeviceProof).toContain('postDeviceProof(token, verification.sessionId');
    expect(attendance).toContain('attendanceFaceMatch(token');
    expect(attendance).toContain('attendanceAcceptVerifiedEvent(token');
  });

  it('removes redundant desktop row focus targets from Personnel and Access tables', () => {
    expect(personnel).not.toContain('className={selectedId === employee.id ? \'is-selected personnel-record-row\' : \'personnel-record-row\'}\r\n          tabIndex={0}');
    expect(access).not.toContain('data-account-id={account.id} tabIndex={0}');
    expect(personnel).toContain('personnel-name-button');
    expect(access).toContain('data-row-primary-action');
  });

  it('uses the shared semantic visual layer and a readable 12px operational floor', () => {
    expect(tokens).toContain('--font-size-micro: 0.75rem;');
    expect(remediationCss).toContain('--v4-blue: var(--color-primary);');
    expect(remediationCss).toContain('--v4-ink: var(--color-text);');
    expect(remediationCss).toContain('font-size: 12px !important');
    expect(main).toContain("import './styles/ux-ui-remediation.css';");
  });

  it('uses Thai-first production copy and the shared SVG icon authority on audited surfaces', () => {
    expect(attendance).toContain('<span>SMS Time 4.0</span>');
    expect(attendance).not.toContain('SMS Time 4.0 Preview');
    expect(main).toContain("label: 'ศูนย์อนุมัติ'");
    expect(main).toContain("label: 'ประสิทธิภาพและสถานะระบบ'");
    expect(main).toContain("label: 'จุดรักษาความปลอดภัยและ QR'");
    expect(reports).toContain('<SmsIcon name="refresh" size={16} />');
    expect(reports).toContain('<SmsIcon name={icon} size={18} />');
    expect(systemHealth).toContain('<SmsIcon name="refresh" size={16} />');
  });
});
