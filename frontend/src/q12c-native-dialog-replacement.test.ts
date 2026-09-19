import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : productionSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

const actionDialog = read('components/useActionDialog.tsx');
const accessibleOverlay = read('components/useAccessibleOverlay.ts');
const passkey = read('components/PasskeySecurityPanel.tsx');
const securitySite = read('components/SecuritySiteManagementPanel.tsx');
const settingHistory = read('components/SystemSettingHistoryPanel.tsx');
const employeeGoverned = read('components/personnel/EmployeeGovernedEditModal.tsx');
const attendanceDevice = read('pages/attendance-device/AttendanceDevicePage.tsx');
const main = read('main.tsx');
const actionDialogCss = read('styles/action-dialog.css');

describe('Q12-C native dialog replacement contracts', () => {
  it('forbids native browser prompt/confirm across production frontend source', () => {
    const violations = productionSourceFiles(root).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return ['window.prompt(', 'window.confirm(']
        .filter((marker) => source.includes(marker))
        .map((marker) => `${path.relative(root, file)}: ${marker}`);
    });
    expect(violations).toEqual([]);
  });

  it('uses the existing accessible overlay primitive for shared dialogs', () => {
    expect(actionDialog).toContain("import { useAccessibleOverlay } from './useAccessibleOverlay'");
    expect(actionDialog).toContain('createPortal(content, document.body)');
    expect(actionDialog).toContain('role="dialog"');
    expect(actionDialog).toContain('aria-modal="true"');
    expect(actionDialog).toContain("initialFocusSelector: isPrompt ? '[data-action-dialog-field]' : '[data-action-dialog-confirm]'");
    expect(accessibleOverlay).toContain("event.key === 'Escape'");
    expect(accessibleOverlay).toContain("event.key !== 'Tab'");
    expect(accessibleOverlay).toContain('previousFocus?.isConnected');
    expect(accessibleOverlay).toContain('acquireDocumentScrollLock');
  });

  it('provides validated prompt semantics and responsive in-app presentation', () => {
    expect(actionDialog).toContain('state.options.minLength');
    expect(actionDialog).toContain('validationError');
    expect(actionDialog).toContain('state.value.trim()');
    expect(actionDialog).toContain('maxLength={state.options.maxLength}');
    expect(actionDialogCss).toContain('@media (max-width: 640px)');
    expect(actionDialogCss).toContain('.sms-action-dialog__validation');
  });

  it('replaces all eight audited Q12-C flows without changing their authoritative API calls', () => {
    expect(passkey).toContain('actionDialog.prompt({');
    expect(passkey).toContain('api.renamePasskey(token, row.id, name)');

    expect(securitySite).toContain('actionDialog.prompt({');
    expect(securitySite).toContain('securitySiteOperations.duplicate(token, selectedSite.id');

    expect(settingHistory).toContain('actionDialog.prompt({');
    expect(settingHistory).toContain('systemSettingHistoryClient.restore(token, selected, id, reason)');

    expect(employeeGoverned).toContain('actionDialog.confirm({');
    expect(employeeGoverned).toContain('api.cancelEmployeeChangeRequest(token, activeRequest.id');

    expect(attendanceDevice).toContain('actionDialog.confirm({');
    expect(attendanceDevice).toContain('api.approveAttendanceDeviceRequest(token, row.id)');

    expect(main.match(/actionDialog\.confirm\(\{/g)?.length).toBeGreaterThanOrEqual(3);
    expect(main).toContain('api.updateScheduleApproval(auth.token');
    expect(main).toContain('api.approveScheduleMonth(auth.token, scheduleMonth)');
    expect(main).toContain('if (confirmed) setScheduleDrafts({});');
  });

  it('preserves the Q12-B initial-bundle gate by lazy-loading non-default operational UI', () => {
    for (const componentName of ['OperationalRecordDrawer', 'DataRowActionMenu', 'TableActionCell', 'TableActionHeader', 'LeaveDecisionConfirmation']) {
      expect(main).toContain(`const ${componentName} = React.lazy(() => import(`);
    }
    expect(main).toContain('กำลังโหลดรายละเอียด…');
    expect(main).toContain('กำลังโหลดหน้าต่างยืนยัน…');
  });

  it('keeps safe request error handling on the governed main and employee flows', () => {
    expect(main).toContain("setOperationError(toRequestErrorState(reason, 'ดำเนินการไม่สำเร็จ'))");
    expect(main).toContain("setOperationError(toRequestErrorState(reason, 'อนุมัติตารางไม่สำเร็จ'))");
    expect(employeeGoverned).toContain("setError(toRequestErrorState(cause, 'ยกเลิกคำขอไม่สำเร็จ'))");
  });
});
