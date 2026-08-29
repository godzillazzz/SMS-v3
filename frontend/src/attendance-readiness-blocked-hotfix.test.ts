import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./pages/attendance/AttendancePage.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('Attendance readiness blocked hotfix', () => {
  it('turns a known missing ACTIVE device into an explicit setup action', () => {
    expect(page).toContain('const [deviceStateKnown, setDeviceStateKnown] = useState(false)');
    expect(page).toContain("const devicePrerequisiteBlocked = deviceStateKnown && !deviceEnrolled");
    expect(page).toContain("const actionText = deviceBlocked ? 'SET UP DEVICE'");
    expect(page).toContain("deviceV4Ready ? 'OK' : deviceBlocked ? 'Required' : 'Check'");
    expect(page).toContain('ต้องตั้งค่า <b>DEVICE</b> ก่อน');
  });

  it('routes the employee to the existing device enrollment page without bypassing server authority', () => {
    expect(page).toContain('onOpenAttendanceDevice?: () => void');
    expect(page).toContain('onOpenAttendanceDevice?.()');
    expect(main).toContain("onOpenAttendanceDevice={() => selectPwaPage('attendanceDevice')}");
    expect(page).toContain('Attendance ต้องมีอุปกรณ์สถานะ ACTIVE ที่ผูกกับพนักงาน');
    expect(page).toMatch(/attendanceVerificationStart\(token[\s\S]*?attendanceDeviceState\(token\)[\s\S]*?verifyAttendanceDeviceProof/);
  });

  it('surfaces a server readiness 200 that contains a blocking state instead of silently returning to Ready', () => {
    expect(page).toMatch(/setReadiness\(result\.data\.readiness\)[\s\S]*?READY_TO_START_VERIFICATION[\s\S]*?const blockedCopy = fallbackCopy\(result\.data\.readiness\)[\s\S]*?setError\(blockedCopy\.detail\)/);
    expect(page).toContain("readiness?.state === 'DEVICE_SETUP_REQUIRED'");
    expect(page).toContain("readiness?.state === 'DEVICE_REVIEW_REQUIRED'");
    expect(page).toContain('const nonRetryableReadinessBlocked = Boolean(readiness?.blocking');
  });
});
