import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const api = read('api.ts');
const main = read('main.tsx');
const personnel = read('pages/personnel/PersonnelDirectoryPage.tsx');
const registration = read('pages/access-management/RegistrationReviewPanel.tsx');
const employeeChange = read('components/personnel/EmployeeChangeReviewModal.tsx');
const auditHeader = read('components/audit/AuditPageHeader.tsx');
const auditPage = read('pages/audit/AuditCompliancePage.tsx');

describe('Q12-A data scale and export correctness contracts', () => {
  it('uses server-authoritative Employee Directory paging, search, status, department and summary metadata', () => {
    expect(api).toContain("employees: (token: string, options:");
    for (const marker of ["params.set('search'", "params.set('isActive'", "params.set('department'", "params.set('directoryMeta', 'true')"]) expect(api).toContain(marker);
    expect(personnel).toContain('api.employees(token, {');
    expect(personnel).toContain('pageSize,');
    expect(personnel).toContain('directoryMeta: true');
    expect(personnel).toContain('meta.totalPages');
    expect(personnel).toContain('meta.departments');
    expect(personnel).toContain('meta.summary');
    expect(personnel).not.toContain('filtered.slice(');
    expect(personnel).not.toContain('employees.filter((employee) =>');
    expect(main).not.toContain("['employees', 'licenses', 'schedule', 'leave', 'leavePending', 'leaveHistory', 'quota'].includes(activePage)");
  });

  it('paginates Registration Review through the existing server contract', () => {
    expect(api).toContain("registrationRequests: (token: string, options:");
    expect(registration).toContain("api.registrationRequests(token, { page, pageSize: 20");
    expect(registration).toContain('pageMeta.totalPages');
    expect(registration).toContain('DataTablePagination');
    expect(registration).toContain('แบ่งหน้าคำขอลงทะเบียน');
    expect(registration).toContain('statusFilter');
  });

  it('paginates the actionable Employee Change queue and preserves request-id deep links', () => {
    expect(api).toContain("employeeChangeRequestQueue: (token: string, options:");
    expect(employeeChange).toContain("api.employeeChangeRequestQueue(token, { page, pageSize: 20, status: 'PENDING_APPROVAL' })");
    expect(employeeChange).toContain('pageMeta.totalPages');
    expect(employeeChange).toContain('DataTablePagination');
    expect(employeeChange).toContain('api.employeeChangeRequest(token, initialRequestId)');
    expect(employeeChange).toContain("requested?.status === 'PENDING_APPROVAL'");
  });

  it('makes current-page CSV scope explicit instead of implying a full result export', () => {
    expect(auditHeader).toContain('CSV หน้านี้');
    expect(auditHeader).toContain('ส่งออกเฉพาะ');
    expect(auditPage).toContain('pageCount={rows.length}');
    expect(main).toContain('CSV หน้านี้');
    expect(main).toContain('page-${currentPage}');
    expect(main).toContain('audit-events-page-${operationResponse.meta?.page || operationPage}');
  });
});
