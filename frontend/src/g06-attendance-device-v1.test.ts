import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const api = read('./api.ts');
const page = read('./pages/attendance-device/AttendanceDevicePage.tsx');
const attendancePage = read('./pages/attendance/AttendancePage.tsx');
const attendanceDeviceProof = read('./pages/attendance/attendance-device-proof.ts');
const keys = read('./lib/attendance-device-key.ts');
const css = read('./styles/attendance-device.css');

describe('G06 Personal Device Enrollment V1 Phase 2 UI contract', () => {
  it('exposes a dedicated Attendance device page without reusing the Passkey panel as device authority', () => {
    expect(main).toContain("'attendanceDevice'");
    expect(main).toContain("{ id: 'attendanceDevice', icon: 'key', label: 'อุปกรณ์ลงเวลา' }");
    expect(main).toContain('<AttendanceDevicePage token={auth.token}');
    expect(main).toContain("'attendanceDevice' | 'profile' | 'reportCenter'");
    expect(page).toContain('บัญชีหรือรหัสผ่านยืนยันตัวตนเพียงอย่างเดียวไม่ยืนยันว่าอุปกรณ์นี้เป็นเครื่องที่ใช้ลงเวลา');
  });

  it('wires self enrollment, proof, cancellation, and Admin-only review API calls', () => {
    expect(api).toContain("call('/attendance/devices/me'");
    expect(api).toContain("call('/attendance/devices/requests', { method: 'POST'");
    expect(api).toContain('/proof/options');
    expect(api).toContain('/proof/verify');
    expect(api).toContain('/return-for-correction');
    expect(api).toContain('/approve');
    expect(api).toContain('/reject');
    expect(page).toContain("role === 'ADMIN'");
    expect(main).toContain("readOnly={auth.isViewingAs}");
  });

  it('generates a non-exportable P-256 private key and persists CryptoKey in IndexedDB only', () => {
    expect(keys).toContain("generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])");
    expect(keys).toContain("exportKey('spki', pair.publicKey)");
    expect(keys).toContain("crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }");
    expect(keys).toContain("indexedDB.open(DB_NAME, DB_VERSION)");
    expect(keys).toContain('inspectAttendanceDeviceKey');
    expect(keys).toContain('listAttendanceDeviceKeyIds');
    expect(keys).toContain('correlateAttendanceDeviceKeyIds');
    expect(keys).toContain('privateKey: CryptoKey');
    expect(keys).toContain('employeeId: string');
    expect(keys).not.toContain('localStorage');
    expect(keys).not.toContain('sessionStorage');
    expect(keys).not.toContain("exportKey('pkcs8'");
  });

  it('fails closed when secure Web Crypto or local device-key storage is unavailable', () => {
    expect(keys).toContain('!window.isSecureContext');
    expect(keys).toContain('!globalThis.crypto?.subtle');
    expect(keys).toContain('!globalThis.indexedDB');
    expect(page).toContain('LOCAL_KEY_STORAGE_FAILED');
    expect(page).toContain('ระบบระบุว่าอุปกรณ์ใช้งานอยู่ แต่ยังไม่พบคีย์ในอุปกรณ์นี้');
    expect(page).not.toContain('ACTIVE_REQUEST_CANDIDATE_ID');
    expect(page).not.toContain('bearer device token');
  });

  it('requires replacement reason in the UX and keeps first/replacement activation behind Admin approval', () => {
    expect(page).toContain("if (selfState?.activeDevice && !reason.trim())");
    expect(page).toContain('การลงทะเบียนครั้งแรกและการเปลี่ยนเครื่องต้องได้รับอนุมัติจากผู้ดูแลระบบ');
    expect(page).toContain("disabled={busy || readOnly || !row.candidateDevice?.proofVerifiedAt}");
    expect(page).not.toContain('possession');
    expect(page).not.toContain('cryptographic proof');
    expect(page).not.toContain('P-256');
    expect(page).not.toContain('non-exportable');
  });

  it('prunes only stale keys for the same Employee and preserves active/pending enrollment keys', () => {
    expect(keys).toContain('row.employeeId === employeeId');
    expect(keys).toContain('!allowed.has(row.candidateDeviceEnrollmentId)');
    expect(page).toContain('next.activeDevice?.id');
    expect(page).toContain('next.activeRequest?.candidateDeviceEnrollmentId');
    expect(page).toContain('pruneAttendanceDeviceKeys(next.employeeId, allowedIds)');
    expect(page).toContain('hasPotentialIdMismatch');
    expect(page).toContain('activeKeyInspection');
    expect(page).toContain('candidateKeyInspection');
  });

  it('checks the verification device ID chain and local key before signing or posting device proof', () => {
    const currentStateCheck = attendanceDeviceProof.indexOf('await dependencies.readDeviceState(token)');
    const mismatchGate = attendanceDeviceProof.indexOf("if (currentDeviceState.activeDevice?.status !== 'ACTIVE' || chain.verificationMatchesActive !== true)");
    const missingKeyGate = attendanceDeviceProof.indexOf("if (verificationKey.status === 'MISSING')");
    const signing = attendanceDeviceProof.indexOf('dependencies.signChallenge(verification.deviceEnrollmentId');
    const proofPost = attendanceDeviceProof.indexOf('dependencies.postDeviceProof(token, verification.sessionId');
    expect(currentStateCheck).toBeGreaterThan(-1);
    expect(mismatchGate).toBeGreaterThan(currentStateCheck);
    expect(missingKeyGate).toBeGreaterThan(mismatchGate);
    expect(signing).toBeGreaterThan(missingKeyGate);
    expect(proofPost).toBeGreaterThan(signing);
    expect(attendancePage).toContain('performAttendanceDeviceProof({');
    expect(attendanceDeviceProof).toContain("'ATTENDANCE_DEVICE_VERIFICATION_ID_MISMATCH'");
    expect(attendanceDeviceProof).toContain("'ATTENDANCE_DEVICE_LOCAL_KEY_MISSING'");
    expect(attendanceDeviceProof).toContain("'ATTENDANCE_DEVICE_KEY_STORAGE_UNAVAILABLE'");
    expect(attendanceDeviceProof).toContain("'ATTENDANCE_DEVICE_KEY_RUNTIME_UNAVAILABLE'");
    expect(attendanceDeviceProof).toContain("verification.verificationMode === 'GEOFENCE_ONLY_UAT' || Boolean(verification.activeChallenge)");
    expect(attendancePage).toContain('isCompleteAttendanceVerification(verification)');
  });

  it('has responsive review and enrollment layouts for mobile use', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.attendance-device-grid { grid-template-columns: 1fr; }');
    expect(css).toContain('.attendance-device-review-modal-backdrop');
    expect(css).toContain('.attendance-device-cancel { grid-template-columns: 1fr; }');
  });
});
