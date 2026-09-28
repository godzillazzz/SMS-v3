import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const access = read('./pages/access-management/AccessManagementPage.tsx');
const accessUtils = read('./components/access-management/access-management-utils.ts');
const main = read('./main.tsx');
const device = read('./pages/attendance-device/AttendanceDevicePage.tsx');
const photo = read('./components/personnel/EmployeeReferencePhotoPanel.tsx');
const license = read('./components/LicenseDocuments.tsx');
const employeeChange = read('./components/personnel/EmployeeGovernedEditModal.tsx');
const adjustment = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');

describe('approval human identity UX contract', () => {
  it('shows the human approver on account and schedule approval surfaces', () => {
    expect(accessUtils).toContain('approvedByDisplayName?: string | null');
    expect(access).toContain('<dt>ผู้อนุมัติ</dt><dd>{account.approvedByDisplayName');
    expect(main).toContain('approval.approvedByDisplayName');
  });

  it('shows the human approver on governed device, photo, license, employee-change and attendance-adjustment history', () => {
    expect(device).toContain('approvedBy?: { id: string; displayName?: string | null; role?: string | null }');
    expect(device).toContain('<dt>ผู้อนุมัติ</dt><dd>{activeDevice.approvedBy?.displayName');
    expect(photo).toContain("active.reviewedBy?.displayName || 'ไม่พบชื่อผู้อนุมัติ'");
    expect(license).toContain("document.status === 'APPROVED' ? 'ผู้อนุมัติ' : 'ผู้ตรวจ'");
    expect(employeeChange).toContain("event.action === 'APPROVE'");
    expect(employeeChange).toContain('ผู้อนุมัติ: <b>{approvalEventFor(request)?.actor?.displayName');
    expect(adjustment).toContain('<b>ผู้อนุมัติ</b> {request.approverDisplayName}');
  });

  it('keeps Leave as the reference implementation with approver display name and role', () => {
    expect(main).toContain('row.approvedByDisplayName');
    expect(main).toContain('row.approvedByRole');
  });
});