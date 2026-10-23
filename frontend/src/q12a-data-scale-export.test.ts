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
    expect(personnel).toContain('nextMeta.totalPages');
    expect(personnel).toContain('nextMeta.departments');
    expect(personnel).toContain('nextMeta.summary');
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
    // The deep-linked target is selected only after its exact id and actionable status are verified; this guards against selecting an unrelated queue row.
    expect(employeeChange).toContain("requested?.id === initialRequestId && requested.status === 'PENDING_APPROVAL'");
    // A failed exact-target lookup must leave the selection empty rather than falling back to the first queue item.
    expect(employeeChange).toContain("initialRequestId ? '' : data.some((row) => row.id === current) ? current : data[0]?.id || ''");
    // The target-load failure remains observable to assistive technology through the modal error alert.
    expect(employeeChange).toContain('<div role="alert" className="employee-governed-alert employee-governed-alert--error">');
  });

  it('makes current-page CSV scope explicit instead of implying a full result export', () => {
    expect(auditHeader).toContain('CSV หน้านี้');
    expect(auditHeader).toContain('ส่งออกเฉพาะ');
    expect(auditPage).toContain('pageCount={rows.length}');
    expect(main).toContain('CSV หน้านี้');
    expect(main).toContain('page-${currentPage}');
    expect(main).toContain('audit-events-page-${operationResponse.meta?.page || operationPage}');
  });

  it('neutralizes formula-leading string cells while preserving typed numeric negatives', () => {
    const csvValueBody = main.match(/const csvValue = \(value: unknown\) => \{([\s\S]*?)\n\};/)?.[1];
    expect(csvValueBody).toBeTruthy();
    // Evaluate the production function body itself so this regression exercises CSV serialization behavior, not a copied test helper.
    const csvValue = new Function('text', `return (value) => {${csvValueBody}}`)(
      (value: unknown) => value == null || value === '' ? '-' : String(value),
    ) as (value: unknown) => string;
    for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(1)', `${String.fromCharCode(9)}=1+1`, `${String.fromCharCode(13)}=1+1`]) {
      expect(csvValue(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
    }
    expect(csvValue('normal')).toBe('"normal"');
    expect(csvValue('say "hello"')).toBe('"say ""hello"""');
    expect(csvValue(null)).toBe('"-"');
    expect(csvValue(undefined)).toBe('"-"');
    expect(csvValue('')).toBe('"-"');
    expect(csvValue({ key: '=1+1' })).toBe('"{""key"":""=1+1""}"');
    expect(csvValue(-1)).toBe('"-1"');
  });

  it('retains CSV BOM and CRLF record separators in the existing serializer', () => {
    expect(main).toContain('\\uFEFF${headers.map(csvValue).join(\',\')}');
    expect(main).toContain("].join('\\r\\n');");
  });
});
