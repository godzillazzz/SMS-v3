import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const api = read('./api.ts');
const page = read('./pages/attendance-device/AttendanceDevicePage.tsx');
const keys = read('./lib/attendance-device-key.ts');
const css = read('./styles/attendance-device.css');

describe('G06 Personal Device Enrollment V1 Phase 2 UI contract', () => {
  it('exposes a dedicated Attendance device page without reusing the Passkey panel as device authority', () => {
    expect(main).toContain("'attendanceDevice'");
    expect(main).toContain("{ id: 'attendanceDevice', icon: 'key', label: 'อุปกรณ์ลงเวลา' }");
    expect(main).toContain('<AttendanceDevicePage token={auth.token}');
    expect(main).toContain("'attendanceDevice' | 'reportCenter'");
    expect(page).toContain('บัญชี/Passkey ไม่ถือเป็นหลักฐานว่าเครื่องนี้เป็น Attendance device');
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
    expect(page).toContain('ไม่พบ private key ของ candidate นี้ใน browser ปัจจุบัน');
    expect(page).not.toContain('bearer device token');
  });

  it('requires replacement reason in the UX and keeps first/replacement activation behind Admin approval', () => {
    expect(page).toContain("if (selfState?.activeDevice && !reason.trim())");
    expect(page).toContain('เครื่องแรกและการเปลี่ยนเครื่องต้อง Admin อนุมัติ');
    expect(page).toContain("disabled={busy || readOnly || !row.candidateDevice?.proofVerifiedAt}");
    expect(page).toContain('อนุมัติได้เฉพาะ candidate ที่พิสูจน์ possession ของ private key ผ่านแล้ว');
  });

  it('prunes only stale keys for the same Employee and preserves active/pending enrollment keys', () => {
    expect(keys).toContain("row.employeeId === employeeId && !allowed.has(row.candidateDeviceEnrollmentId)");
    expect(page).toContain('next.activeDevice?.id');
    expect(page).toContain('next.activeRequest?.candidateDeviceEnrollmentId');
    expect(page).toContain('pruneAttendanceDeviceKeys(next.employeeId, allowedIds)');
  });

  it('has responsive review and enrollment layouts for mobile use', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.attendance-device-grid { grid-template-columns: 1fr; }');
    expect(css).toContain('.attendance-device-review-modal-backdrop');
    expect(css).toContain('.attendance-device-cancel { grid-template-columns: 1fr; }');
  });
});
