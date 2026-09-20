import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);

function source(relative: string) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const apiBackedSurfaces = [
  'components/ApprovalAuthorityMatrixPanel.tsx',
  'components/AttendancePolicySettingsCard.tsx',
  'components/AutoSchedulePatternPanel.tsx',
  'components/DataRetentionCenterPanel.tsx',
  'components/LeavePolicySettingsCard.tsx',
  'components/LeaveTypeMasterPanel.tsx',
  'components/NotificationCenterPanel.tsx',
  'components/PasskeySecurityPanel.tsx',
  'components/PersonnelMasterPanel.tsx',
  'components/SecuritySiteManagementPanel.tsx',
  'components/SystemSettingHistoryPanel.tsx',
  'pages/access-management/AccessManagementPage.tsx',
  'pages/access-management/G06UatProvisioningPanel.tsx',
  'pages/access-management/RegistrationReviewPanel.tsx',
  'pages/attendance-device/AttendanceDevicePage.tsx',
  'pages/attendance/AttendanceFaceCapture.tsx',
  'pages/attendance/AttendanceFaceChallengeUatPanel.tsx',
  'pages/attendance/AttendancePage.tsx',
  'pages/attendance-supervisor/AttendanceSupervisorPage.tsx',
  'pages/personnel/PersonnelDirectoryPage.tsx',
  'pages/pwa-attendance/AttendanceHistoryPwaPage.tsx',
  'pages/pwa-attendance/AttendanceSchedulePwaPage.tsx',
  'pages/system-health/SystemHealthPage.tsx'
];

describe('Q12-E error supportability contract', () => {
  it('keeps API-backed legacy string surfaces on the shared safe request-error formatter', () => {
    for (const relative of apiBackedSurfaces) {
      const code = source(relative);
      expect(code, relative).toContain('formatRequestErrorMessage');
      expect(code, relative).not.toMatch(/instanceof Error\s*\?\s*[^:;\n]*\.message/);
    }
  });

  it('keeps main application API error fallbacks on the shared formatter', () => {
    const code = source('main.tsx');
    expect(code).toContain('formatRequestErrorMessage');
    for (const fallback of [
      'ไม่สามารถเข้าสู่ระบบได้',
      'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้',
      'อ่าน Auto Schedule Pattern ไม่สำเร็จ',
      'วิเคราะห์ Phase จากประวัติไม่สำเร็จ',
      'บันทึกเทมเพลตไม่สำเร็จ'
    ]) {
      expect(code).toContain(fallback);
    }
  });

  it('keeps browser-local camera/geolocation cues while routing fallback presentation through the safe formatter', () => {
    const attendance = source('pages/attendance/AttendancePage.tsx');
    const capture = source('pages/attendance/AttendanceFaceCapture.tsx');
    expect(attendance).toContain('LOCATION_PERMISSION_DENIED');
    expect(attendance).toContain('reason instanceof AttendanceFlowError');
    expect(attendance).toContain('setRequestId(reason.requestId)');
    expect(capture).toContain('NotReadableError');
    expect(capture).toContain('formatRequestErrorMessage');
  });
});
