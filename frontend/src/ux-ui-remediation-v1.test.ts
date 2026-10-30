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

const lightTheme = tokens.match(/\[data-theme="light"\]\s*\.app-shell\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const declarations = new Map([...lightTheme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const resolveToken = (name: string, seen = new Set<string>()): string => {
  if (seen.has(name)) throw new Error(`cyclic token alias: ${name}`);
  const value = declarations.get(name);
  if (!value) throw new Error(`missing light token: ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return alias ? resolveToken(alias, new Set(seen).add(name)) : value;
};
const hexToRgb = (value: string): [number, number, number] => {
  const match = value.trim().toLowerCase().match(/^#([\da-f]{6})$/);
  if (!match) throw new Error(`expected six-digit hex token, received ${value}`);
  return [0, 1, 2].map((index) => Number.parseInt(match[1].slice(index * 2, index * 2 + 2), 16)) as [number, number, number];
};
const contrastRatio = (foreground: string, background: string) => {
  const luminance = (value: string) => hexToRgb(value).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const assertRemediationContracts = (source: string) => {
  expect(contrastRatio(resolveToken('--color-text-muted'), resolveToken('--color-bg'))).toBeGreaterThanOrEqual(4.5);
  for (const surface of ['--color-surface', '--color-surface-muted', '--color-surface-subtle', '--color-primary-soft']) {
    expect(contrastRatio(resolveToken('--color-text-muted'), resolveToken(surface)), surface).toBeGreaterThanOrEqual(4.5);
  }
  expect(source).toContain('.auth-skip-link');
  expect(source).toContain('href="#auth-login-form"');
  expect(source).toContain('id="auth-login-form"');
};

describe('UXUI-REM-01 audited remediation contracts', () => {
  it('raises light-theme muted text contrast and exposes a keyboard skip link on authentication', () => {
    expect(resolveToken('--color-text-muted')).toBe('#616c80');
    expect(signature).toContain('--signature-text-muted: #66758a;');
    expect(authCss).toContain('.auth-form input::placeholder { color: var(--color-text-muted); opacity: 1; }');
    assertRemediationContracts(`${tokens}\n${authCss}\n${main}`);
  });

  it('mutation checks fail for the previous muted color and for a removed skip link', () => {
    expect(() => {
      const mutatedValue = '#8a94a6';
      expect(contrastRatio(mutatedValue, '#f4f6f9')).toBeGreaterThanOrEqual(4.5);
    }).toThrow();
    expect(() => assertRemediationContracts(`${tokens}\n${authCss.replaceAll('.auth-skip-link', '.removed-skip-link')}\n${main}`)).toThrow();
  });

  it('exposes Approval Center selection semantics without mixing audit events into the approval queue', () => {
    expect(approval).toContain('aria-pressed={filter ===');
    expect(approval).toContain('aria-pressed={selected?.id === item.id}');
    expect(approval).toContain('summary.total');
    expect(approval).toContain('summary.byType?.[id]');
    expect(approval).not.toContain('api.auditEvents');
    expect(approval).not.toContain('บันทึกเหตุการณ์สด');
    expect(approval).toContain('ศูนย์อนุมัติ');
    expect(approval).toContain('layout-page-surface');
    expect(approvalCss).toContain('.nexus-approval-center{max-width:100vw;overflow-x:hidden}');
    expect(approvalCss).not.toContain('.nexus-approval-center{background:#020813!important');
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
    expect(main).toContain("label: 'จุดรักษาการณ์และ QR'");
    expect(reports).toContain('<SmsIcon name="refresh" size={16} />');
    expect(reports).toContain('<SmsIcon name={icon} size={18} />');
    expect(systemHealth).toContain('<SmsIcon name="refresh" size={16} />');
  });
});
