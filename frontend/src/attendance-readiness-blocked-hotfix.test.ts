import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./pages/attendance/AttendancePage.tsx', import.meta.url), 'utf8');
const deviceProof = readFileSync(new URL('./pages/attendance/attendance-device-proof.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('Attendance readiness blocked hotfix', () => {
  it('turns a known missing ACTIVE device into an explicit setup action', () => {
    expect(page).toContain('const [deviceStateKnown, setDeviceStateKnown] = useState(false)');
    expect(page).toContain("const devicePrerequisiteBlocked = deviceStateKnown && !deviceEnrolled");
    expect(page).toContain("const actionText = pendingAttendanceCommit ? 'บันทึกซ้ำ' : deviceBlocked ? 'ตั้งค่าอุปกรณ์'");
    expect(page).toContain('const deviceV4Ready = (deviceEnrolled && deviceKeyCapability.supported && deviceKeyInspection?.status === \'PRESENT\')');
    expect(page).toContain('const deviceKeyLabel = attendanceAccepted || verificationSession');
    expect(page).toContain('ต้องตั้งค่า <b>DEVICE</b> ก่อน');
  });

  it('routes the employee to the existing device enrollment page without bypassing server authority', () => {
    expect(page).toContain('onOpenAttendanceDevice?: () => void');
    expect(page).toContain('onOpenAttendanceDevice?.()');
    expect(main).toContain("onOpenAttendanceDevice={() => selectPwaPage('attendanceDevice')}");
    expect(page).toContain('Attendance ต้องมีอุปกรณ์สถานะ ACTIVE ที่ผูกกับพนักงาน');
    const verificationStart = page.indexOf('const started = await attendanceVerificationStart(token');
    const deviceProofFlow = page.indexOf('await performAttendanceDeviceProof({');
    const activeDeviceRefresh = deviceProof.indexOf('await dependencies.readDeviceState(token)');
    const keyRead = deviceProof.indexOf('await dependencies.readKeyInventory(currentDeviceState.employeeId)');
    const signature = deviceProof.indexOf('dependencies.signChallenge(verification.deviceEnrollmentId');
    const proofPost = deviceProof.indexOf('dependencies.postDeviceProof(token, verification.sessionId');
    expect(verificationStart).toBeGreaterThan(-1);
    expect(deviceProofFlow).toBeGreaterThan(verificationStart);
    expect(keyRead).toBeGreaterThan(activeDeviceRefresh);
    expect(signature).toBeGreaterThan(keyRead);
    expect(proofPost).toBeGreaterThan(signature);
  });

  it('surfaces a server readiness 200 that contains a blocking state instead of silently returning to Ready', () => {
    expect(page).toMatch(/setReadiness\(started\.data\.readiness\)[\s\S]*?READY_TO_START_VERIFICATION[\s\S]*?const blockedCopy = fallbackCopy\(started\.data\.readiness\)[\s\S]*?setError\(blockedCopy\.detail\)/);
    expect(page).toContain("VERIFICATION_RESTART_REQUIRED");
    expect(page).toContain("readiness?.state === 'DEVICE_SETUP_REQUIRED'");
    expect(page).toContain("readiness?.state === 'DEVICE_REVIEW_REQUIRED'");
    expect(page).toContain('const nonRetryableReadinessBlocked = Boolean(readiness?.blocking');
  });
  it('surfaces unusable Reference Photo as a blocked Admin replacement action instead of Face Match retry', () => {
    expect(page).toContain("REFERENCE_PHOTO_REPLACEMENT_REQUIRED");
    expect(page).toMatch(/REFERENCE_PHOTO_REPLACEMENT_REQUIRED:[\s\S]*?tone: 'blocked'/);
    expect(page).toMatch(/REFERENCE_PHOTO_REPLACEMENT_REQUIRED:[\s\S]*?Reference Photo[\s\S]*?Admin/);
    expect(page).not.toMatch(/REFERENCE_PHOTO_REPLACEMENT_REQUIRED:[\s\S]{0,500}?RETRY_FACE_VERIFICATION/);
  });
});
