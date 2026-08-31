import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8').replace(/\r\n/g, '\n');

describe('CFG-08 Attendance Device Administration', () => {
  it('uses the governed Attendance authenticated client for Admin overview and revoke', () => {
    const client = read('./pages/attendance/attendance-client.ts');
    expect(client).toContain('attendanceDeviceAdminOverview');
    expect(client).toContain('/attendance/devices/admin/overview');
    expect(client).toContain('revokeAttendanceDeviceCurrent');
    expect(client).toContain('/attendance/devices/admin/employees/');
    expect(client).toContain('attendanceAuthenticatedRequest');
  });

  it('keeps Admin revoke reason-required and renders history and audit context', () => {
    const page = read('./pages/attendance-device/AttendanceDevicePage.tsx');
    expect(page).toContain('CFG-08 · ADMIN');
    expect(page).toContain('Device History');
    expect(page).toContain('Recent Audit');
    expect(page).toContain('Device Proof');
    expect(page).toContain("revokeReason.trim().length < 3");
    expect(page).toContain('revokeAttendanceDeviceCurrent');
    expect(page).toContain('stale approval');
  });

  it('keeps display and platform metadata informational instead of trusted identity', () => {
    const page = read('./pages/attendance-device/AttendanceDevicePage.tsx');
    expect(page).toContain('Trusted Identity');
    const service = read('../../src/services/attendance-device.service.js');
    expect(service).toContain("SUPPORTED_KEY_ALGORITHMS = new Set(['ECDSA_P256_SHA256'])");
    expect(service).toContain('credentialFingerprint');
    expect(service).not.toMatch(/platformHint\s*===.*ACTIVE/);
    expect(service).not.toMatch(/displayName\s*===.*ACTIVE/);
  });
});
